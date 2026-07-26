BEGIN;

-- Formation rows are owner-readable but are never directly writable. All
-- lifecycle mutation remains behind service-role-only SECURITY DEFINER RPCs.
ALTER TABLE public.representation_formation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.representation_formation_sessions
  DROP COLUMN IF EXISTS formation_completed_at;
REVOKE ALL ON TABLE public.representation_formation_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.representation_formation_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.update_formation_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_formation_sessions_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.zeya_initiate_formation_session(
  p_business_id UUID,
  p_business_representation_id UUID,
  p_owner_id UUID,
  p_initiated_from public.formation_initiation_source,
  p_initiated_from_id UUID
)
RETURNS TABLE (
  session_id UUID,
  business_representation_id UUID,
  status public.formation_session_status,
  initiated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.representation_formation_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_business_id IS NULL
     OR p_business_representation_id IS NULL
     OR p_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid formation initiation parameters';
  END IF;

  PERFORM 1
  FROM public.business_representations AS br
  JOIN public.businesses AS b
    ON b.id = br.business_id
   AND b.user_id = br.user_id
  WHERE br.id = p_business_representation_id
    AND br.business_id = p_business_id
    AND br.user_id = p_owner_id
    AND b.user_id = p_owner_id
  FOR UPDATE OF br;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.business_representation_id = p_business_representation_id;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.business_representation_id,
      v_existing.status,
      v_existing.formation_started_at;
    RETURN;
  END IF;

  IF p_initiated_from IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid formation initiation parameters';
  END IF;

  INSERT INTO public.representation_formation_sessions (
    business_id,
    business_representation_id,
    owner_id,
    status,
    initiated_from,
    initiated_from_id,
    formation_started_at
  )
  VALUES (
    p_business_id,
    p_business_representation_id,
    p_owner_id,
    'initiated'::public.formation_session_status,
    p_initiated_from,
    p_initiated_from_id,
    pg_catalog.now()
  )
  ON CONFLICT ON CONSTRAINT formation_session_representation_uniq
  DO NOTHING;

  SELECT *
  INTO v_existing
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.business_representation_id = p_business_representation_id;

  IF v_existing.owner_id IS DISTINCT FROM p_owner_id
     OR v_existing.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  RETURN QUERY
  SELECT
    v_existing.id,
    v_existing.business_representation_id,
    v_existing.status,
    v_existing.formation_started_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_advance_formation_status(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_expected_current_status public.formation_session_status,
  p_new_status public.formation_session_status,
  p_transition_details JSONB
)
RETURNS TABLE (
  session_id UUID,
  status public.formation_session_status,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL
     OR p_business_representation_id IS NULL
     OR p_expected_current_status IS NULL
     OR p_new_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session transition';
  END IF;

  SELECT *
  INTO v_session
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  IF v_session.status <> p_expected_current_status THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'formation session status conflict';
  END IF;

  IF NOT (
    (p_expected_current_status = 'initiated'::public.formation_session_status
      AND p_new_status = 'getting_familiar'::public.formation_session_status)
    OR
    (p_expected_current_status = 'getting_familiar'::public.formation_session_status
      AND p_new_status = 'working_conversation_pending'::public.formation_session_status)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid formation status transition';
  END IF;

  UPDATE public.representation_formation_sessions
  SET status = p_new_status,
      updated_at = pg_catalog.now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY
  SELECT v_session.id, v_session.status, v_session.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_link_formation_conversation(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_conversation_id UUID,
  p_conversation_type TEXT
)
RETURNS TABLE (
  session_id UUID,
  business_representation_id UUID,
  status TEXT,
  linked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_conversation_type <> 'voice_conversation_output' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported conversation type';
  END IF;

  SELECT *
  INTO v_session
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  IF v_session.status = 'working_conversation_linked'::public.formation_session_status THEN
    IF v_session.first_working_conversation_id IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'formation conversation already linked';
    END IF;

    RETURN QUERY
    SELECT
      v_session.id,
      v_session.business_representation_id,
      v_session.status::TEXT,
      v_session.updated_at;
    RETURN;
  END IF;

  IF v_session.status <> 'working_conversation_pending'::public.formation_session_status THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'formation session not in valid state for conversation linking';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voice_conversation_outputs AS output
    WHERE output.id = p_conversation_id
      AND output.business_representation_id = p_business_representation_id
      AND output.business_id = v_session.business_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'conversation not found or does not belong to representation';
  END IF;

  UPDATE public.representation_formation_sessions
  SET status = 'working_conversation_linked'::public.formation_session_status,
      first_working_conversation_id = p_conversation_id,
      updated_at = pg_catalog.now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY
  SELECT
    v_session.id,
    v_session.business_representation_id,
    v_session.status::TEXT,
    v_session.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_initiate_formation_session(
  UUID, UUID, UUID, public.formation_initiation_source, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_initiate_formation_session(
  UUID, UUID, UUID, public.formation_initiation_source, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.zeya_advance_formation_status(
  UUID, UUID, public.formation_session_status, public.formation_session_status, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_advance_formation_status(
  UUID, UUID, public.formation_session_status, public.formation_session_status, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.zeya_link_formation_conversation(
  UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_link_formation_conversation(
  UUID, UUID, UUID, TEXT
) TO service_role;

-- Reconcile the controlled-purge inventory after RF-A added Formation sessions.
-- Preserve every governed voice/review/canonical deletion path introduced before
-- RF-A and add representation_formation_sessions without weakening immutability.
CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation(
  p_business_representation_id UUID,
  p_expected_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actual_business_id UUID;
  v_deleted JSONB := '{}'::JSONB;
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'purge not authorized';
  END IF;

  SELECT br.business_id
  INTO v_actual_business_id
  FROM public.business_representations AS br
  WHERE br.id = p_business_representation_id
  FOR UPDATE;

  IF v_actual_business_id IS NULL OR v_actual_business_id <> p_expected_business_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'on', true);

  DELETE FROM public.representation_formation_sessions
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_formation_sessions', v_count);

  DELETE FROM public.conversation_candidate_canonicalizations
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_canonicalizations', v_count);

  DELETE FROM public.audit_events
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('audit_events', v_count);

  DELETE FROM public.confidence_assessments
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('confidence_assessments', v_count);

  DELETE FROM public.conversation_candidate_promotions
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_promotions', v_count);

  DELETE FROM public.conversation_candidate_review_decisions
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_review_decisions', v_count);

  DELETE FROM public.voice_conversation_candidates
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_conversation_candidates', v_count);

  DELETE FROM public.voice_conversation_outputs
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_conversation_outputs', v_count);

  DELETE FROM public.voice_representation_lineage
  WHERE business_representation_id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_representation_lineage', v_count);

  UPDATE public.business_representations
  SET current_version_id = NULL
  WHERE id = p_business_representation_id
    AND business_id = p_expected_business_id;

  UPDATE public.representation_elements
  SET current_value_version_id = NULL
  WHERE business_representation_id = p_business_representation_id;

  DELETE FROM public.representation_versions
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_versions', v_count);

  DELETE FROM public.approval_decisions
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('approval_decisions', v_count);

  DELETE FROM public.proposal_elements
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_elements', v_count);

  DELETE FROM public.proposal_evidence
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_evidence', v_count);

  DELETE FROM public.proposal_observations
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_observations', v_count);

  DELETE FROM public.representation_proposals
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_proposals', v_count);

  DELETE FROM public.observations
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('observations', v_count);

  DELETE FROM public.evidence
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('evidence', v_count);

  DELETE FROM public.representation_elements
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_elements', v_count);

  DELETE FROM public.representation_domains
  WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_domains', v_count);

  DELETE FROM public.business_representations
  WHERE id = p_business_representation_id
    AND business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('business_representations', v_count);

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);

  RETURN pg_catalog.jsonb_build_object(
    'businessRepresentationId', p_business_representation_id,
    'businessId', p_expected_business_id,
    'deleted', v_deleted
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);
    RAISE;
END;
$$;

ALTER FUNCTION public.zeya_purge_business_representation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
