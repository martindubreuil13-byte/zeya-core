BEGIN;

ALTER TABLE public.direct_hire_working_sessions
  ADD COLUMN preparation_status text NOT NULL DEFAULT 'pending' CHECK (
    preparation_status IN ('pending', 'running', 'ready', 'failed')
  ),
  ADD COLUMN preparation_started_at timestamptz,
  ADD COLUMN preparation_completed_at timestamptz,
  ADD COLUMN preparation_failure_code text,
  ADD COLUMN preparation_lease_id uuid,
  ADD COLUMN preparation_lease_expires_at timestamptz,
  ADD COLUMN preparation_attempt_count smallint NOT NULL DEFAULT 0 CHECK (
    preparation_attempt_count BETWEEN 0 AND 3
  ),
  ADD COLUMN preparation_snapshot_fingerprint text,
  ADD COLUMN preparation_contract_version text,
  ADD COLUMN preparation_website_persisted_at timestamptz;

CREATE INDEX direct_hire_working_sessions_preparation_claim_idx
  ON public.direct_hire_working_sessions (
    preparation_status, preparation_lease_expires_at, scheduled_at
  )
  WHERE status = 'scheduled' AND preparation_status IN ('pending', 'running', 'failed');

CREATE FUNCTION public.zeya_mark_first_working_session_preparation_stale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.induction_state = 'material_received'
     AND (OLD.induction_state IS DISTINCT FROM NEW.induction_state
       OR OLD.induction_materials_count IS DISTINCT FROM NEW.induction_materials_count) THEN
    UPDATE public.direct_hire_working_sessions AS working_session
    SET preparation_status='pending', preparation_completed_at=NULL,
        preparation_failure_code=NULL, preparation_lease_id=NULL,
        preparation_lease_expires_at=NULL, preparation_snapshot_fingerprint=NULL,
        preparation_website_persisted_at=NULL
    WHERE working_session.direct_hire_onboarding_session_id=NEW.id
      AND working_session.status='scheduled'
      AND working_session.preparation_status IN ('ready','failed');
    UPDATE public.direct_hire_first_working_session_briefs AS brief
    SET current=false
    WHERE brief.direct_hire_onboarding_session_id=NEW.id AND brief.current;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_induction_marks_working_session_preparation_stale
  AFTER UPDATE OF induction_state, induction_materials_count
  ON public.direct_hire_onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_mark_first_working_session_preparation_stale();

CREATE TABLE public.direct_hire_first_working_session_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  direct_hire_onboarding_session_id uuid NOT NULL REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE CASCADE,
  direct_hire_working_session_id uuid NOT NULL REFERENCES public.direct_hire_working_sessions(id) ON DELETE CASCADE,
  source_snapshot_fingerprint text NOT NULL,
  hypothesis_trace_fingerprint text NOT NULL,
  preparation_contract_version text NOT NULL,
  brief jsonb NOT NULL CHECK (jsonb_typeof(brief) = 'object'),
  source_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  source_hypothesis_ids uuid[] NOT NULL DEFAULT '{}',
  current boolean NOT NULL DEFAULT true,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (direct_hire_working_session_id, source_snapshot_fingerprint, preparation_contract_version)
);

CREATE UNIQUE INDEX direct_hire_first_working_session_briefs_current_idx
  ON public.direct_hire_first_working_session_briefs (direct_hire_working_session_id)
  WHERE current;

CREATE INDEX direct_hire_first_working_session_briefs_scope_idx
  ON public.direct_hire_first_working_session_briefs (
    owner_id, business_id, business_representation_id, direct_hire_working_session_id
  );

CREATE FUNCTION public.zeya_validate_direct_hire_first_working_session_brief_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_hire_working_sessions AS working_session
    WHERE working_session.id = NEW.direct_hire_working_session_id
      AND working_session.owner_id = NEW.owner_id
      AND working_session.business_id = NEW.business_id
      AND working_session.business_representation_id = NEW.business_representation_id
      AND working_session.direct_hire_onboarding_session_id = NEW.direct_hire_onboarding_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'preparation brief lineage invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_first_working_session_brief_lineage
  BEFORE INSERT OR UPDATE ON public.direct_hire_first_working_session_briefs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_validate_direct_hire_first_working_session_brief_lineage();

ALTER TABLE public.direct_hire_first_working_session_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_first_working_session_briefs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.direct_hire_first_working_session_briefs TO service_role;

CREATE FUNCTION public.zeya_claim_first_working_session_preparation(
  p_contract_version text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  working_session_id uuid, onboarding_session_id uuid, owner_id uuid,
  business_id uuid, business_representation_id uuid, website_url text,
  lease_id uuid, attempt_count smallint, website_persisted boolean, claimed boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_lease_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_contract_version IS NULL OR btrim(p_contract_version) = ''
     OR p_lease_seconds NOT BETWEEN 60 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation claim';
  END IF;

  SELECT candidate.* INTO v_session
  FROM public.direct_hire_working_sessions AS candidate
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = candidate.direct_hire_onboarding_session_id
   AND onboarding.owner_id = candidate.owner_id
   AND onboarding.business_id = candidate.business_id
   AND onboarding.business_representation_id = candidate.business_representation_id
  WHERE candidate.status = 'scheduled'
    AND onboarding.onboarding_state = 'employment_accepted'
    AND onboarding.induction_state = 'preparation_pending'
    AND candidate.preparation_attempt_count < 3
    AND (
      candidate.preparation_status IN ('pending', 'failed')
      OR (candidate.preparation_status = 'running' AND candidate.preparation_lease_expires_at <= now())
      OR (candidate.preparation_status = 'ready' AND candidate.preparation_contract_version IS DISTINCT FROM p_contract_version)
    )
  ORDER BY candidate.scheduled_at, candidate.created_at
  LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED;

  IF v_session.id IS NULL THEN RETURN; END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
  FOR UPDATE;

  v_lease_id := gen_random_uuid();
  IF v_session.preparation_status='ready'
    AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version THEN
    UPDATE public.direct_hire_first_working_session_briefs AS brief
    SET current=false
    WHERE brief.direct_hire_working_session_id=v_session.id AND brief.current;
  END IF;
  UPDATE public.direct_hire_working_sessions AS working_session
  SET preparation_status = 'running',
      preparation_started_at = now(), preparation_completed_at = NULL,
      preparation_failure_code = NULL, preparation_lease_id = v_lease_id,
      preparation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      preparation_contract_version = p_contract_version,
      preparation_website_persisted_at = CASE
        WHEN v_session.preparation_status='ready'
          AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version
        THEN NULL ELSE v_session.preparation_website_persisted_at END
  WHERE working_session.id = v_session.id;

  RETURN QUERY SELECT v_session.id, v_onboarding.id, v_session.owner_id,
    v_session.business_id, v_session.business_representation_id, v_onboarding.website_url,
    v_lease_id, v_session.preparation_attempt_count,
    v_session.preparation_website_persisted_at IS NOT NULL
      AND NOT (v_session.preparation_status='ready'
        AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version),
    true;
END;
$$;

-- Persist a P1 research result under the appointment's lease without mutating
-- the historical onboarding Preparation lifecycle. Artifact identity and
-- provenance intentionally match the P1 finalizer.
CREATE FUNCTION public.zeya_persist_first_working_session_website_research(
  p_working_session_id uuid, p_lease_id uuid,
  p_final_status text, p_failure_code text,
  p_successful_page_count smallint, p_failed_page_count smallint,
  p_evidence jsonb, p_observations jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_item jsonb;
  v_evidence_id uuid;
  v_evidence_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='worker authorization required';
  END IF;
  IF p_final_status NOT IN ('ready','partial','failed')
    OR jsonb_typeof(coalesce(p_evidence,'[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_observations,'[]'::jsonb)) <> 'array'
    OR jsonb_array_length(coalesce(p_observations,'[]'::jsonb)) > 3
    OR p_successful_page_count NOT BETWEEN 0 AND 10
    OR p_failed_page_count NOT BETWEEN 0 AND 10
    OR (p_final_status='ready' AND p_failed_page_count <> 0)
    OR (p_final_status='partial' AND p_failed_page_count = 0)
    OR (p_final_status='failed' AND p_failure_code IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid preparation result';
  END IF;

  SELECT * INTO v_session FROM public.direct_hire_working_sessions
  WHERE id=p_working_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='working session not found';
  END IF;
  IF v_session.status <> 'scheduled' OR v_session.preparation_status <> 'running'
    OR v_session.preparation_lease_id <> p_lease_id
    OR v_session.preparation_lease_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='preparation lease conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_hire_onboarding_sessions AS onboarding
    JOIN public.businesses AS business ON business.id=onboarding.business_id
    JOIN public.business_representations AS representation
      ON representation.id=onboarding.business_representation_id
    WHERE onboarding.id=v_session.direct_hire_onboarding_session_id
      AND onboarding.owner_id=v_session.owner_id
      AND onboarding.business_id=v_session.business_id
      AND onboarding.business_representation_id=v_session.business_representation_id
      AND onboarding.onboarding_state='employment_accepted'
      AND onboarding.induction_state='preparation_pending'
      AND business.user_id=v_session.owner_id
      AND representation.business_id=v_session.business_id
      AND representation.user_id=v_session.owner_id
      AND representation.current_version_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.representation_formation_sessions AS formation
    WHERE formation.business_representation_id=v_session.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='owner journey conflict';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_evidence,'[]'::jsonb)) LOOP
    IF v_item->>'sourceKey' IS NULL OR v_item->>'rawStatement' IS NULL
      OR v_item->>'requestedUrl' IS NULL OR v_item->>'finalUrl' IS NULL
      OR v_item->>'retrievedAt' IS NULL OR v_item->>'documentContentHash' IS NULL
      OR v_item->>'pageType' NOT IN ('homepage','about','products_services','pricing','customers','case_studies','testimonials','industries','methodology','team','faq','contact','resources')
      OR v_item->>'kind' NOT IN ('title','meta_description','primary_heading','main_excerpt','about_excerpt','products_services_excerpt','explicit_absence','section_text','section_list','pricing_block','testimonial','quantitative_claim') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid website evidence';
    END IF;
    INSERT INTO public.evidence (
      business_representation_id,source_type,source_description,raw_statement,
      affected_domains,captured_by_actor,direct_hire_onboarding_session_id,
      website_source_key,requested_source_url,canonical_source_url,source_retrieved_at,
      source_content_hash,source_page_type,source_evidence_kind,source_selector,
      extraction_method_version
    ) VALUES (
      v_session.business_representation_id,'public_website',
      'Bounded Direct Hire public website review',v_item->>'rawStatement',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains','[]'::jsonb))),
      'zeya_direct_hire_website_research',v_session.direct_hire_onboarding_session_id,
      v_item->>'sourceKey',v_item->>'requestedUrl',v_item->>'finalUrl',
      (v_item->>'retrievedAt')::timestamptz,v_item->>'documentContentHash',
      v_item->>'pageType',v_item->>'kind',v_item->>'selector',v_item->>'extractionVersion'
    ) ON CONFLICT (direct_hire_onboarding_session_id,website_source_key)
      WHERE direct_hire_onboarding_session_id IS NOT NULL AND website_source_key IS NOT NULL
      DO NOTHING RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NULL THEN
      SELECT evidence.id INTO v_evidence_id FROM public.evidence AS evidence
      WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
        AND evidence.business_representation_id=v_session.business_representation_id
        AND evidence.website_source_key=v_item->>'sourceKey';
    ELSE
      INSERT INTO public.audit_events (business_representation_id,event_type,evidence_id,actor_system,details)
      VALUES (v_session.business_representation_id,'evidence_created',v_evidence_id,
        'zeya_direct_hire_website_research',jsonb_build_object(
          'onboardingSessionId',v_session.direct_hire_onboarding_session_id,
          'workingSessionId',v_session.id,'sourceKey',v_item->>'sourceKey'));
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) LOOP
    IF v_item->>'observationKey' IS NULL OR v_item->>'evidenceSourceKey' IS NULL
      OR v_item->>'interpretedMeaning' IS NULL
      OR (v_item->>'confidence')::integer NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid website observation';
    END IF;
    SELECT evidence.id INTO v_evidence_id FROM public.evidence AS evidence
    WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
      AND evidence.business_representation_id=v_session.business_representation_id
      AND evidence.website_source_key=v_item->>'evidenceSourceKey';
    IF v_evidence_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='observation evidence missing';
    END IF;
    INSERT INTO public.observations (
      business_representation_id,evidence_id,interpreted_meaning,
      confidence_in_interpretation,affected_domains,affected_elements,
      created_by_actor,website_observation_key
    ) VALUES (
      v_session.business_representation_id,v_evidence_id,v_item->>'interpretedMeaning',
      (v_item->>'confidence')::smallint,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains','[]'::jsonb))),
      ARRAY[]::text[],'zeya_direct_hire_website_research',v_item->>'observationKey'
    ) ON CONFLICT (business_representation_id,website_observation_key)
      WHERE website_observation_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NOT NULL THEN
      INSERT INTO public.audit_events (business_representation_id,event_type,observation_id,actor_system,details)
      VALUES (v_session.business_representation_id,'observation_created',v_evidence_id,
        'zeya_direct_hire_website_research',jsonb_build_object(
          'onboardingSessionId',v_session.direct_hire_onboarding_session_id,
          'workingSessionId',v_session.id,'observationKey',v_item->>'observationKey'));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_evidence_count FROM public.evidence AS evidence
  WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
    AND evidence.business_representation_id=v_session.business_representation_id
    AND evidence.source_type='public_website';
  IF p_final_status='failed' AND v_evidence_count > 0 THEN p_final_status := 'partial'; END IF;
  IF p_final_status IN ('ready','partial') AND v_evidence_count=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='preparation result inconsistent';
  END IF;
  UPDATE public.direct_hire_working_sessions
  SET preparation_website_persisted_at=now()
  WHERE id=v_session.id;
  RETURN p_final_status;
END;
$$;

CREATE FUNCTION public.zeya_finalize_first_working_session_preparation(
  p_working_session_id uuid, p_lease_id uuid, p_snapshot_fingerprint text,
  p_hypothesis_trace_fingerprint text, p_contract_version text,
  p_brief jsonb, p_source_evidence_ids uuid[], p_source_hypothesis_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.direct_hire_working_sessions%ROWTYPE; v_brief_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  SELECT * INTO v_session FROM public.direct_hire_working_sessions
  WHERE id = p_working_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='working session not found'; END IF;
  IF v_session.preparation_status = 'ready'
     AND v_session.preparation_snapshot_fingerprint = p_snapshot_fingerprint
     AND v_session.preparation_contract_version = p_contract_version THEN
    SELECT id INTO v_brief_id FROM public.direct_hire_first_working_session_briefs
    WHERE direct_hire_working_session_id = v_session.id AND current;
    RETURN v_brief_id;
  END IF;
  IF v_session.preparation_status <> 'running' OR v_session.preparation_lease_id <> p_lease_id
     OR v_session.preparation_lease_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='preparation lease conflict';
  END IF;
  IF p_snapshot_fingerprint IS NULL OR p_hypothesis_trace_fingerprint IS NULL
     OR p_contract_version IS NULL OR jsonb_typeof(p_brief) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid preparation brief';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_source_evidence_ids,'{}'::uuid[])) AS supplied(evidence_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.evidence AS evidence
      WHERE evidence.id = supplied.evidence_id
        AND evidence.business_representation_id = v_session.business_representation_id
        AND evidence.direct_hire_onboarding_session_id = v_session.direct_hire_onboarding_session_id
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='preparation brief Evidence lineage invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_source_hypothesis_ids,'{}'::uuid[])) AS supplied(hypothesis_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.hypotheses AS hypothesis
      WHERE hypothesis.id=supplied.hypothesis_id
        AND hypothesis.owner_id=v_session.owner_id
        AND hypothesis.business_id=v_session.business_id
        AND hypothesis.business_representation_id=v_session.business_representation_id
        AND hypothesis.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
        AND NOT EXISTS (
          SELECT 1 FROM public.hypotheses AS successor
          WHERE successor.previous_hypothesis_id=hypothesis.id
        )
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='preparation brief hypothesis lineage invalid';
  END IF;
  UPDATE public.direct_hire_first_working_session_briefs SET current=false
  WHERE direct_hire_working_session_id=v_session.id AND current;
  INSERT INTO public.direct_hire_first_working_session_briefs (
    owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,
    direct_hire_working_session_id,source_snapshot_fingerprint,hypothesis_trace_fingerprint,
    preparation_contract_version,brief,source_evidence_ids,source_hypothesis_ids
  ) VALUES (
    v_session.owner_id,v_session.business_id,v_session.business_representation_id,
    v_session.direct_hire_onboarding_session_id,v_session.id,p_snapshot_fingerprint,
    p_hypothesis_trace_fingerprint,p_contract_version,p_brief,
    coalesce(p_source_evidence_ids,'{}'),coalesce(p_source_hypothesis_ids,'{}')
  ) ON CONFLICT (direct_hire_working_session_id,source_snapshot_fingerprint,preparation_contract_version)
    DO UPDATE SET current=true, brief=EXCLUDED.brief,
      hypothesis_trace_fingerprint=EXCLUDED.hypothesis_trace_fingerprint,
      source_evidence_ids=EXCLUDED.source_evidence_ids,
      source_hypothesis_ids=EXCLUDED.source_hypothesis_ids, generated_at=now()
  RETURNING id INTO v_brief_id;
  UPDATE public.direct_hire_working_sessions SET preparation_status='ready',
    preparation_completed_at=now(), preparation_failure_code=NULL,
    preparation_lease_id=NULL, preparation_lease_expires_at=NULL,
    preparation_snapshot_fingerprint=p_snapshot_fingerprint,
    preparation_contract_version=p_contract_version
  WHERE id=v_session.id;
  RETURN v_brief_id;
END;
$$;

CREATE FUNCTION public.zeya_fail_first_working_session_preparation(
  p_working_session_id uuid, p_lease_id uuid, p_failure_code text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.direct_hire_working_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='worker authorization required';
  END IF;
  SELECT * INTO v_session FROM public.direct_hire_working_sessions
  WHERE id=p_working_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='working session not found'; END IF;
  IF v_session.preparation_status = 'failed' AND v_session.preparation_lease_id IS NULL THEN RETURN true; END IF;
  IF v_session.preparation_status <> 'running' OR v_session.preparation_lease_id <> p_lease_id THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='preparation lease conflict';
  END IF;
  UPDATE public.direct_hire_working_sessions SET preparation_status='failed',
    preparation_failure_code=left(coalesce(p_failure_code,'preparation_failed'),120),
    preparation_lease_id=NULL, preparation_lease_expires_at=NULL,
    preparation_attempt_count=least(preparation_attempt_count + 1,3)
  WHERE id=v_session.id;
  RETURN true;
END;
$$;

ALTER FUNCTION public.zeya_validate_direct_hire_first_working_session_brief_lineage() OWNER TO postgres;
ALTER FUNCTION public.zeya_mark_first_working_session_preparation_stale() OWNER TO postgres;
ALTER FUNCTION public.zeya_claim_first_working_session_preparation(text,integer) OWNER TO postgres;
ALTER FUNCTION public.zeya_persist_first_working_session_website_research(uuid,uuid,text,text,smallint,smallint,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION public.zeya_finalize_first_working_session_preparation(uuid,uuid,text,text,text,jsonb,uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.zeya_fail_first_working_session_preparation(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_validate_direct_hire_first_working_session_brief_lineage() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_mark_first_working_session_preparation_stale() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_claim_first_working_session_preparation(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_persist_first_working_session_website_research(uuid,uuid,text,text,smallint,smallint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_finalize_first_working_session_preparation(uuid,uuid,text,text,text,jsonb,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_fail_first_working_session_preparation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_claim_first_working_session_preparation(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_persist_first_working_session_website_research(uuid,uuid,text,text,smallint,smallint,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_first_working_session_preparation(uuid,uuid,text,text,text,jsonb,uuid[],uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_fail_first_working_session_preparation(uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
