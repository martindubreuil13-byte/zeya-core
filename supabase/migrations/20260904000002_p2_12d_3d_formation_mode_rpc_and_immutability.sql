-- P2.12D.3D: persist and protect the Day-One v6 prepared-context mode.

BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_prevent_formation_prepared_context_mode_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.prepared_context_mode IS DISTINCT FROM NEW.prepared_context_mode THEN
    RAISE EXCEPTION 'formation_prepared_context_mode_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER representation_formation_sessions_prepared_context_mode_immutable
BEFORE UPDATE OF prepared_context_mode
ON public.representation_formation_sessions
FOR EACH ROW
EXECUTE FUNCTION public.zeya_prevent_formation_prepared_context_mode_update();

CREATE OR REPLACE FUNCTION public.zeya_initiate_direct_hire_first_working_session_formation(
  p_authenticated_owner_id uuid,
  p_working_session_id uuid,
  p_expected_brief_id uuid,
  p_expected_snapshot_fingerprint text,
  p_expected_hypothesis_trace_fingerprint text,
  p_agenda jsonb
)
RETURNS TABLE (formation_session_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_brief public.direct_hire_first_working_session_briefs%ROWTYPE;
  v_existing_handoff public.direct_hire_first_working_session_formation_handoffs%ROWTYPE;
  v_formation_id uuid;
  v_handoff_id uuid;
  v_hypothesis_count integer;
  v_current_hypothesis_ids uuid[];
  v_hypothesis_trace text;
  v_item jsonb;
  v_rank integer := 0;
  v_item_hypothesis_ids uuid[];
  v_item_evidence_ids uuid[];
  v_sections text[];
  v_authority_required boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Formation handoff authorization required';
  END IF;
  IF p_authenticated_owner_id IS NULL OR p_working_session_id IS NULL
     OR p_expected_brief_id IS NULL
     OR p_expected_snapshot_fingerprint IS NULL OR btrim(p_expected_snapshot_fingerprint) = ''
     OR p_expected_hypothesis_trace_fingerprint IS NULL OR btrim(p_expected_hypothesis_trace_fingerprint) = ''
     OR jsonb_typeof(p_agenda) <> 'array'
     OR jsonb_array_length(p_agenda) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Formation handoff request';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = p_working_session_id
    AND working_session.owner_id = p_authenticated_owner_id
  FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'working session not found';
  END IF;

  SELECT handoff.* INTO v_existing_handoff
  FROM public.direct_hire_first_working_session_formation_handoffs AS handoff
  WHERE handoff.direct_hire_working_session_id = v_session.id;
  IF v_existing_handoff.id IS NOT NULL THEN
    IF v_existing_handoff.owner_id IS DISTINCT FROM p_authenticated_owner_id
       OR v_existing_handoff.preparation_brief_id IS DISTINCT FROM p_expected_brief_id
       OR v_existing_handoff.preparation_snapshot_fingerprint IS DISTINCT FROM p_expected_snapshot_fingerprint
       OR v_existing_handoff.hypothesis_trace_fingerprint IS DISTINCT FROM p_expected_hypothesis_trace_fingerprint
       OR v_session.formation_session_id IS DISTINCT FROM v_existing_handoff.formation_session_id
       OR NOT EXISTS (
         SELECT 1 FROM public.direct_hire_onboarding_sessions AS onboarding
         WHERE onboarding.id = v_existing_handoff.direct_hire_onboarding_session_id
           AND onboarding.formation_session_id = v_existing_handoff.formation_session_id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'Formation handoff lineage conflict';
    END IF;
    RETURN QUERY SELECT v_existing_handoff.formation_session_id, false;
    RETURN;
  END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
    AND onboarding.owner_id = v_session.owner_id
    AND onboarding.business_id = v_session.business_id
    AND onboarding.business_representation_id = v_session.business_representation_id
  FOR UPDATE;
  SELECT brief.* INTO v_brief
  FROM public.direct_hire_first_working_session_briefs AS brief
  WHERE brief.id = p_expected_brief_id
    AND brief.direct_hire_working_session_id = v_session.id
    AND brief.owner_id = v_session.owner_id
    AND brief.business_id = v_session.business_id
    AND brief.business_representation_id = v_session.business_representation_id
    AND brief.direct_hire_onboarding_session_id = v_session.direct_hire_onboarding_session_id
    AND brief.current
    AND brief.preparation_contract_version = 'first-working-session-preparation-v6'
  FOR UPDATE;

  SELECT count(*), array_agg(hypothesis.id ORDER BY hypothesis.id),
    encode(extensions.digest(coalesce(string_agg(
      hypothesis.id::text || ':' || hypothesis.hypothesis_version::text || ':'
        || coalesce(hypothesis.request_trace_id, ''),
      '|' ORDER BY hypothesis.id::text || ':' || hypothesis.hypothesis_version::text
        || ':' || coalesce(hypothesis.request_trace_id, '')
    ), ''), 'sha256'), 'hex')
  INTO v_hypothesis_count, v_current_hypothesis_ids, v_hypothesis_trace
  FROM public.hypotheses AS hypothesis
  WHERE hypothesis.owner_id = v_session.owner_id
    AND hypothesis.business_id = v_session.business_id
    AND hypothesis.business_representation_id = v_session.business_representation_id
    AND hypothesis.direct_hire_onboarding_session_id = v_session.direct_hire_onboarding_session_id
    AND NOT EXISTS (
      SELECT 1 FROM public.hypotheses AS successor
      WHERE successor.previous_hypothesis_id = hypothesis.id
    );

  IF v_session.status <> 'scheduled'
     OR v_session.preparation_status <> 'ready'
     OR v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v6'
     OR v_session.preparation_snapshot_fingerprint IS DISTINCT FROM p_expected_snapshot_fingerprint
     OR v_brief.id IS NULL
     OR v_brief.source_snapshot_fingerprint IS DISTINCT FROM p_expected_snapshot_fingerprint
     OR v_brief.hypothesis_trace_fingerprint IS DISTINCT FROM p_expected_hypothesis_trace_fingerprint
     OR v_hypothesis_trace IS DISTINCT FROM p_expected_hypothesis_trace_fingerprint
     OR v_hypothesis_count <> 7
     OR (SELECT count(DISTINCT hypothesis.constitutional_domain)
         FROM public.hypotheses AS hypothesis
         WHERE hypothesis.id = ANY(v_current_hypothesis_ids)) <> 7
     OR v_onboarding.id IS NULL
     OR v_onboarding.onboarding_state <> 'employment_accepted'
     OR v_onboarding.induction_state <> 'preparation_pending'
     OR NOT EXISTS (
       SELECT 1 FROM public.businesses AS business
       WHERE business.id = v_session.business_id AND business.user_id = v_session.owner_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.business_representations AS representation
       WHERE representation.id = v_session.business_representation_id
         AND representation.business_id = v_session.business_id
         AND representation.user_id = v_session.owner_id
         AND representation.current_version_id IS NULL
     )
     OR v_session.formation_session_id IS NOT NULL
     OR v_onboarding.formation_session_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.representation_formation_sessions AS formation
       WHERE formation.business_representation_id = v_session.business_representation_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'working session is not eligible for Formation handoff';
  END IF;

  v_authority_required := EXISTS (
    SELECT 1 FROM public.hypotheses AS hypothesis
    WHERE hypothesis.id = ANY(v_current_hypothesis_ids)
      AND hypothesis.constitutional_domain = 'authorityBoundaries'
      AND (hypothesis.epistemic_state = 'unknown' OR hypothesis.representation_risk = 'high')
  );
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_agenda) LOOP
    v_rank := v_rank + 1;
    SELECT coalesce(array_agg(value::uuid), '{}'::uuid[]) INTO v_item_hypothesis_ids
    FROM jsonb_array_elements_text(coalesce(v_item->'sourceHypothesisIds', '[]'::jsonb));
    SELECT coalesce(array_agg(value::uuid), '{}'::uuid[]) INTO v_item_evidence_ids
    FROM jsonb_array_elements_text(coalesce(v_item->'sourceEvidenceIds', '[]'::jsonb));
    SELECT coalesce(array_agg(value), '{}'::text[]) INTO v_sections
    FROM jsonb_array_elements_text(coalesce(v_item->'sourceBriefSections', '[]'::jsonb));

    IF v_item->>'agendaItemId' !~ '^agenda_[0-9a-f]{24}$'
       OR (v_item->>'rank')::integer <> v_rank
       OR v_item->>'category' NOT IN ('authority','contradiction','commercial','formation_priority','clarification','descriptive_refinement')
       OR (v_item->>'constitutionalDomain' IS NOT NULL AND v_item->>'constitutionalDomain' NOT IN
         ('whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription','authorityBoundaries','clarificationsNeeded'))
       OR v_item->>'risk' NOT IN ('high','medium','low')
       OR jsonb_typeof(v_item->'blocking') <> 'boolean'
       OR v_item->>'resolutionStatus' <> 'unresolved'
       OR cardinality(v_sections) = 0
       OR EXISTS (SELECT 1 FROM unnest(v_sections) AS section_name
                  WHERE section_name NOT IN ('businessRead','offerRead','customerRead','problemOutcomeRead','positioningRead','commercialSignals','contradictions','unknowns','workingOpinions','formationPriorities','openingInsights','questions','authorityGaps'))
       OR btrim(coalesce(v_item->>'questionIntent','')) = ''
       OR v_item->>'createdFromSnapshotFingerprint' IS DISTINCT FROM p_expected_snapshot_fingerprint
       OR EXISTS (SELECT 1 FROM unnest(v_item_hypothesis_ids) AS supplied(id)
                  WHERE supplied.id <> ALL(v_current_hypothesis_ids))
       OR EXISTS (SELECT 1 FROM unnest(v_item_evidence_ids) AS supplied(id)
                  WHERE supplied.id <> ALL(v_brief.source_evidence_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid deterministic Formation agenda';
    END IF;
  END LOOP;
  IF v_authority_required AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_agenda) AS item
    WHERE item->>'category' = 'authority' AND (item->>'blocking')::boolean
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'blocking authority agenda item required';
  END IF;

  INSERT INTO public.representation_formation_sessions (
    business_id, business_representation_id, owner_id, status,
    initiated_from, initiated_from_id, formation_started_at, prepared_context_mode
  ) VALUES (
    v_session.business_id, v_session.business_representation_id, v_session.owner_id,
    'initiated', 'direct_hire_onboarding', v_session.direct_hire_onboarding_session_id, now(),
    'immutable_snapshot_v6'
  ) RETURNING id INTO v_formation_id;

  INSERT INTO public.direct_hire_first_working_session_formation_handoffs (
    formation_session_id, direct_hire_working_session_id, direct_hire_onboarding_session_id,
    business_representation_id, owner_id, business_id, preparation_brief_id,
    preparation_snapshot_fingerprint, hypothesis_trace_fingerprint,
    preparation_contract_version, handoff_source, handed_off_by_actor
  ) VALUES (
    v_formation_id, v_session.id, v_session.direct_hire_onboarding_session_id,
    v_session.business_representation_id, v_session.owner_id, v_session.business_id,
    v_brief.id, p_expected_snapshot_fingerprint, p_expected_hypothesis_trace_fingerprint,
    'first-working-session-preparation-v6', 'direct_hire_first_working_session', 'service_role'
  ) RETURNING id INTO v_handoff_id;

  INSERT INTO public.direct_hire_first_working_session_formation_agenda_items (
    formation_handoff_id, formation_session_id, agenda_item_id, rank, category,
    constitutional_domain, risk, blocking, resolution_status, source_brief_sections,
    source_hypothesis_ids, source_evidence_ids, question_intent, suggested_wording,
    created_from_snapshot_fingerprint
  )
  SELECT v_handoff_id, v_formation_id, item->>'agendaItemId', (item->>'rank')::smallint,
    item->>'category', nullif(item->>'constitutionalDomain',''), item->>'risk',
    (item->>'blocking')::boolean, item->>'resolutionStatus',
    ARRAY(SELECT value FROM jsonb_array_elements_text(item->'sourceBriefSections')),
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(item->'sourceHypothesisIds')),
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(item->'sourceEvidenceIds')),
    item->>'questionIntent', nullif(item->>'suggestedWording',''),
    item->>'createdFromSnapshotFingerprint'
  FROM jsonb_array_elements(p_agenda) AS item;

  UPDATE public.direct_hire_working_sessions AS working_session
  SET formation_session_id = v_formation_id
  WHERE working_session.id = v_session.id;
  UPDATE public.direct_hire_onboarding_sessions AS onboarding
  SET formation_session_id = v_formation_id,
      formation_initiated_at = now(), updated_at = now()
  WHERE onboarding.id = v_session.direct_hire_onboarding_session_id;

  RETURN QUERY SELECT v_formation_id, true;
END;
$$;

ALTER FUNCTION public.zeya_prevent_formation_prepared_context_mode_update() OWNER TO postgres;
ALTER FUNCTION public.zeya_initiate_direct_hire_first_working_session_formation(uuid,uuid,uuid,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_prevent_formation_prepared_context_mode_update()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_initiate_direct_hire_first_working_session_formation(uuid,uuid,uuid,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_first_working_session_formation(uuid,uuid,uuid,text,text,jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
