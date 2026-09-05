-- One-time Martin QA application-data reset.
--
-- Purpose:
--   Remove only the abandoned Direct Hire / Preparation / Formation QA graph for
--   Martin's current QA owner while preserving the Supabase Auth user.
--
-- Hard boundary:
--   This migration does not alter Formation uniqueness, does not mutate
--   auth.users, and does not change runtime lifecycle contracts. The delete
--   bypass is gated to postgres plus the transaction-local
--   zeya.qa_app_data_reset setting inside the pinned reset function below.

BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_prevent_direct_hire_formation_handoff_snapshot_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND current_setting('zeya.qa_app_data_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Direct Hire Formation handoff snapshot is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND current_setting('zeya.qa_app_data_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Formation conversation history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_prevent_first_working_session_preparation_recovery_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND current_setting('zeya.qa_app_data_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'preparation recovery records are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND current_setting('zeya.qa_app_data_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'preparation regeneration records are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_prevent_formation_prepared_context_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.qa_app_data_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'formation_prepared_context_immutable: direct DELETE not permitted';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id constant uuid := '332d2299-0657-4d90-b43b-bda03bff6175'::uuid;
  v_business_id constant uuid := '049d1a9c-c0dc-4113-ab31-44633e5a4141'::uuid;
  v_representation_id constant uuid := '886b773d-5c26-42e1-8089-17ae3c28fa96'::uuid;
  v_expected_email constant text := 'martin@mindrasolutions.com';
  v_email text;
  v_onboarding_id uuid;
  v_working_session_id uuid;
  v_formation_id uuid;
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
  v_leaf_count integer;
  v_hypothesis_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QA reset authorization required';
  END IF;

  SELECT owner.email
  INTO v_email
  FROM auth.users AS owner
  WHERE owner.id = v_owner_id
  FOR UPDATE;

  IF v_email IS DISTINCT FROM v_expected_email THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'QA reset auth identity mismatch';
  END IF;

  SELECT onboarding.id
  INTO v_onboarding_id
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.owner_id = v_owner_id
    AND onboarding.business_id = v_business_id
    AND onboarding.business_representation_id = v_representation_id
  FOR UPDATE;

  SELECT working_session.id
  INTO v_working_session_id
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.owner_id = v_owner_id
    AND working_session.business_id = v_business_id
    AND working_session.business_representation_id = v_representation_id
    AND working_session.direct_hire_onboarding_session_id = v_onboarding_id
  FOR UPDATE;

  SELECT formation.id
  INTO v_formation_id
  FROM public.representation_formation_sessions AS formation
  WHERE formation.owner_id = v_owner_id
    AND formation.business_id = v_business_id
    AND formation.business_representation_id = v_representation_id
  FOR UPDATE;

  IF v_onboarding_id IS NULL
     OR v_working_session_id IS NULL
     OR v_formation_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.businesses AS business
       WHERE business.id = v_business_id
         AND business.user_id = v_owner_id
       FOR UPDATE
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.business_representations AS representation
       WHERE representation.id = v_representation_id
         AND representation.business_id = v_business_id
         AND representation.user_id = v_owner_id
       FOR UPDATE
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'pinned QA graph not found';
  END IF;

  PERFORM pg_catalog.set_config('zeya.qa_app_data_reset', 'on', true);
  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'on', true);

  DELETE FROM public.direct_hire_formation_authority_disposition_corrections AS correction
  WHERE correction.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_authority_disposition_corrections', v_count);

  DELETE FROM public.direct_hire_formation_answer_classification_corrections AS correction
  WHERE correction.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_answer_classification_corrections', v_count);

  DELETE FROM public.direct_hire_formation_decision_supersessions AS supersession
  WHERE supersession.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_decision_supersessions', v_count);

  DELETE FROM public.direct_hire_formation_agenda_resolution_events AS event
  WHERE event.run_id IN (
    SELECT run.id
    FROM public.direct_hire_formation_conversation_runs AS run
    WHERE run.formation_session_id = v_formation_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_agenda_resolution_events', v_count);

  DELETE FROM public.direct_hire_formation_decisions AS decision
  WHERE decision.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_decisions', v_count);

  DELETE FROM public.direct_hire_formation_conversation_turns AS turn
  WHERE turn.run_id IN (
    SELECT run.id
    FROM public.direct_hire_formation_conversation_runs AS run
    WHERE run.formation_session_id = v_formation_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_conversation_turns', v_count);

  DELETE FROM public.direct_hire_formation_conversation_runs AS run
  WHERE run.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_conversation_runs', v_count);

  DELETE FROM public.direct_hire_formation_prepared_context AS prepared_context
  WHERE prepared_context.formation_session_id = v_formation_id
     OR prepared_context.business_representation_id = v_representation_id
     OR prepared_context.direct_hire_working_session_id = v_working_session_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_formation_prepared_context', v_count);

  DELETE FROM public.direct_hire_first_working_session_v6_one_attempt_recoveries AS recovery
  WHERE recovery.owner_id = v_owner_id
    AND recovery.business_id = v_business_id
    AND recovery.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_v6_one_attempt_recoveries', v_count);

  DELETE FROM public.direct_hire_first_working_session_preparation_regenerations AS regeneration
  WHERE regeneration.owner_id = v_owner_id
    AND regeneration.business_id = v_business_id
    AND regeneration.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_preparation_regenerations', v_count);

  DELETE FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
  WHERE recovery.owner_id = v_owner_id
    AND recovery.business_id = v_business_id
    AND recovery.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_preparation_recoveries', v_count);

  DELETE FROM public.direct_hire_first_working_session_formation_agenda_items AS item
  WHERE item.formation_session_id = v_formation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_formation_agenda_items', v_count);

  DELETE FROM public.direct_hire_first_working_session_formation_handoffs AS handoff
  WHERE handoff.formation_session_id = v_formation_id
    AND handoff.owner_id = v_owner_id
    AND handoff.business_id = v_business_id
    AND handoff.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_formation_handoffs', v_count);

  UPDATE public.direct_hire_working_sessions AS working_session
  SET formation_session_id = NULL
  WHERE working_session.id = v_working_session_id
    AND working_session.owner_id = v_owner_id;

  UPDATE public.direct_hire_onboarding_sessions AS onboarding
  SET formation_session_id = NULL
  WHERE onboarding.id = v_onboarding_id
    AND onboarding.owner_id = v_owner_id;

  DELETE FROM public.representation_formation_sessions AS formation
  WHERE formation.id = v_formation_id
    AND formation.owner_id = v_owner_id
    AND formation.business_id = v_business_id
    AND formation.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('representation_formation_sessions', v_count);

  DELETE FROM public.direct_hire_first_working_session_briefs AS brief
  WHERE brief.owner_id = v_owner_id
    AND brief.business_id = v_business_id
    AND brief.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_first_working_session_briefs', v_count);

  DELETE FROM public.hypothesis_owner_operations AS owner_operation
  WHERE owner_operation.owner_id = v_owner_id
    AND owner_operation.business_id = v_business_id
    AND owner_operation.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('hypothesis_owner_operations', v_count);

  DELETE FROM public.hypothesis_verifications AS verification
  WHERE EXISTS (
    SELECT 1
    FROM public.hypotheses AS hypothesis
    WHERE hypothesis.id = verification.hypothesis_id
      AND hypothesis.owner_id = v_owner_id
      AND hypothesis.business_id = v_business_id
      AND hypothesis.business_representation_id = v_representation_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('hypothesis_verifications', v_count);

  LOOP
    DELETE FROM public.hypotheses AS hypothesis
    WHERE hypothesis.owner_id = v_owner_id
      AND hypothesis.business_id = v_business_id
      AND hypothesis.business_representation_id = v_representation_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.hypotheses AS child
        WHERE child.previous_hypothesis_id = hypothesis.id
      );
    GET DIAGNOSTICS v_leaf_count = ROW_COUNT;
    v_hypothesis_count := v_hypothesis_count + v_leaf_count;
    EXIT WHEN v_leaf_count = 0;
  END LOOP;
  v_deleted := v_deleted || jsonb_build_object('hypotheses', v_hypothesis_count);

  IF EXISTS (
    SELECT 1
    FROM public.hypotheses AS hypothesis
    WHERE hypothesis.owner_id = v_owner_id
      AND hypothesis.business_id = v_business_id
      AND hypothesis.business_representation_id = v_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'hypothesis reset lineage invalid';
  END IF;

  DELETE FROM public.direct_hire_public_sources AS source
  WHERE source.business_id = v_business_id
    AND source.business_representation_id = v_representation_id
    AND source.direct_hire_onboarding_session_id = v_onboarding_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_public_sources', v_count);

  DELETE FROM public.observations AS observation
  WHERE observation.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('observations', v_count);

  DELETE FROM public.evidence AS evidence_row
  WHERE evidence_row.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('evidence', v_count);

  DELETE FROM public.audit_events AS audit_event
  WHERE audit_event.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('audit_events', v_count);

  DELETE FROM public.representation_versions AS version
  WHERE version.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('representation_versions', v_count);

  DELETE FROM public.approval_decisions AS approval
  WHERE approval.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('approval_decisions', v_count);

  DELETE FROM public.proposal_elements AS proposal_element
  WHERE proposal_element.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('proposal_elements', v_count);

  DELETE FROM public.proposal_evidence AS proposal_evidence_row
  WHERE proposal_evidence_row.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('proposal_evidence', v_count);

  DELETE FROM public.proposal_observations AS proposal_observation
  WHERE proposal_observation.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('proposal_observations', v_count);

  DELETE FROM public.representation_proposals AS proposal
  WHERE proposal.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('representation_proposals', v_count);

  DELETE FROM public.representation_elements AS element
  WHERE element.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('representation_elements', v_count);

  DELETE FROM public.representation_domains AS domain
  WHERE domain.business_representation_id = v_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('representation_domains', v_count);

  DELETE FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = v_working_session_id
    AND working_session.owner_id = v_owner_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_working_sessions', v_count);

  DELETE FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.id = v_onboarding_id
    AND onboarding.owner_id = v_owner_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('direct_hire_onboarding_sessions', v_count);

  DELETE FROM public.business_representations AS representation
  WHERE representation.id = v_representation_id
    AND representation.business_id = v_business_id
    AND representation.user_id = v_owner_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('business_representations', v_count);

  DELETE FROM public.businesses AS business
  WHERE business.id = v_business_id
    AND business.user_id = v_owner_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('businesses', v_count);

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);
  PERFORM pg_catalog.set_config('zeya.qa_app_data_reset', 'off', true);

  RETURN jsonb_build_object(
    'operation', 'zeya_one_time_reset_martin_direct_hire_v6_qa_20260905',
    'ownerId', v_owner_id,
    'authEmailPreserved', v_expected_email,
    'businessId', v_business_id,
    'businessRepresentationId', v_representation_id,
    'deleted', v_deleted
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);
    PERFORM pg_catalog.set_config('zeya.qa_app_data_reset', 'off', true);
    RAISE;
END;
$$;

ALTER FUNCTION public.zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_one_time_reset_martin_direct_hire_v6_qa_20260905()
  TO service_role;

REVOKE ALL ON FUNCTION public.zeya_prevent_direct_hire_formation_handoff_snapshot_modification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_prevent_first_working_session_preparation_recovery_modification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_prevent_formation_prepared_context_delete()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
