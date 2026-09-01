BEGIN;

ALTER TABLE public.observations
  ADD COLUMN supporting_evidence_ids uuid[],
  ADD COLUMN observation_category text,
  ADD COLUMN executive_observation_key text,
  ADD COLUMN synthesis_method_version text;

UPDATE public.observations SET supporting_evidence_ids=ARRAY[evidence_id]
WHERE supporting_evidence_ids IS NULL;

ALTER TABLE public.observations
  ALTER COLUMN supporting_evidence_ids SET NOT NULL,
  ADD CONSTRAINT observations_supporting_evidence_nonempty CHECK (cardinality(supporting_evidence_ids)>0),
  ADD CONSTRAINT observations_anchor_is_supporting_evidence CHECK (evidence_id=ANY(supporting_evidence_ids)),
  ADD CONSTRAINT observations_category_check CHECK (observation_category IS NULL OR observation_category IN (
    'confirmation','pattern','segmentation','tension','contradiction','implication','gap','differentiation_signal'
  ));

CREATE UNIQUE INDEX observations_executive_key_unique
  ON public.observations(business_representation_id,executive_observation_key)
  WHERE executive_observation_key IS NOT NULL;

CREATE FUNCTION public.zeya_validate_observation_evidence_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.supporting_evidence_ids IS NULL THEN
    NEW.supporting_evidence_ids:=ARRAY[NEW.evidence_id];
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.supporting_evidence_ids) AS source(evidence_id)
    LEFT JOIN public.evidence e ON e.id=source.evidence_id
      AND e.business_representation_id=NEW.business_representation_id
    WHERE e.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='observation supporting Evidence outside Representation scope';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER observations_supporting_evidence_scope
  BEFORE INSERT OR UPDATE ON public.observations FOR EACH ROW
  EXECUTE FUNCTION public.zeya_validate_observation_evidence_scope();

REVOKE ALL ON FUNCTION public.zeya_validate_observation_evidence_scope() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.zeya_persist_first_working_session_executive_observations(
  p_working_session_id uuid,p_lease_id uuid,p_observations jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s public.direct_hire_working_sessions%ROWTYPE; item jsonb; ids uuid[]; anchor uuid; inserted integer:=0; observation_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='worker authorization required'; END IF;
  IF jsonb_typeof(coalesce(p_observations,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_observations,'[]'::jsonb))>6
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid executive observations'; END IF;
  SELECT * INTO s FROM public.direct_hire_working_sessions WHERE id=p_working_session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='working session not found'; END IF;
  IF s.status<>'scheduled' OR s.preparation_status<>'running' OR s.preparation_contract_version<>'first-working-session-preparation-v6'
    OR s.preparation_lease_id<>p_lease_id OR s.preparation_lease_expires_at<=now()
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='preparation lease conflict'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) LOOP
    IF item->>'observationKey' IS NULL OR item->>'interpretedMeaning' IS NULL
      OR item->>'category' NOT IN ('confirmation','pattern','segmentation','tension','contradiction','implication','gap','differentiation_signal')
      OR jsonb_typeof(item->'evidenceIds')<>'array' OR jsonb_array_length(item->'evidenceIds')<2
      OR (item->>'confidence')::integer NOT BETWEEN 0 AND 100
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid executive observation'; END IF;
    SELECT array_agg(value::uuid ORDER BY value::uuid) INTO ids FROM jsonb_array_elements_text(item->'evidenceIds');
    IF cardinality(ids)<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(item->'evidenceIds')) OR EXISTS (
      SELECT 1 FROM unnest(ids) evidence_id LEFT JOIN public.evidence e ON e.id=evidence_id
      WHERE e.id IS NULL OR e.business_representation_id<>s.business_representation_id
        OR e.direct_hire_onboarding_session_id<>s.direct_hire_onboarding_session_id
    ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='executive observation Evidence scope invalid'; END IF;
    anchor:=ids[1]; observation_id:=NULL;
    INSERT INTO public.observations(business_representation_id,evidence_id,supporting_evidence_ids,interpreted_meaning,
      confidence_in_interpretation,affected_domains,affected_elements,created_by_actor,observation_category,
      executive_observation_key,synthesis_method_version)
    VALUES(s.business_representation_id,anchor,ids,item->>'interpretedMeaning',(item->>'confidence')::smallint,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'affectedDomains','[]'::jsonb))),ARRAY[]::text[],NULL,
      item->>'category',item->>'observationKey','executive-observation-synthesis-v1')
    ON CONFLICT(business_representation_id,executive_observation_key) WHERE executive_observation_key IS NOT NULL DO NOTHING
    RETURNING id INTO observation_id;
    IF observation_id IS NOT NULL THEN
      inserted:=inserted+1;
      INSERT INTO public.audit_events(business_representation_id,event_type,observation_id,actor_system,details)
      VALUES(s.business_representation_id,'observation_created',observation_id,'zeya_executive_observation_synthesis',
        jsonb_build_object('workingSessionId',s.id,'onboardingSessionId',s.direct_hire_onboarding_session_id,
          'category',item->>'category','supportingEvidenceIds',to_jsonb(ids),'synthesisMethodVersion','executive-observation-synthesis-v1'));
    END IF;
  END LOOP;
  RETURN inserted;
END; $$;

REVOKE ALL ON FUNCTION public.zeya_persist_first_working_session_executive_observations(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_first_working_session_executive_observations(uuid,uuid,jsonb) TO service_role;

ALTER TABLE public.direct_hire_first_working_session_formation_handoffs
  DROP CONSTRAINT IF EXISTS direct_hire_first_working_session_formation_handoffs_preparation_contract_version_check;
ALTER TABLE public.direct_hire_first_working_session_formation_handoffs
  ADD CONSTRAINT direct_hire_first_working_session_formation_handoffs_preparation_contract_version_check
  CHECK(preparation_contract_version IN('first-working-session-preparation-v4','first-working-session-preparation-v5','first-working-session-preparation-v6'));

NOTIFY pgrst,'reload schema';
COMMIT;
