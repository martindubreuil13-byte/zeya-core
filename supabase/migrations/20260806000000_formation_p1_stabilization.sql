BEGIN;

-- Formation summaries and owner corrections need explicit, queryable lineage.
-- This migration is additive and does not create canonical state.
ALTER TABLE public.representation_proposals
  ADD COLUMN formation_session_id uuid
    REFERENCES public.representation_formation_sessions(id) ON DELETE CASCADE;

UPDATE public.representation_proposals AS proposal
SET formation_session_id =
  (proposal.proposed_changes->'_metadata'->>'formationSessionId')::uuid
WHERE proposal.proposed_changes->'_metadata'->>'formationSessionId' IS NOT NULL
  AND proposal.proposed_changes->'_metadata'->>'formationSessionId'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND proposal.formation_session_id IS NULL;

CREATE UNIQUE INDEX representation_proposals_one_draft_formation_idx
  ON public.representation_proposals (formation_session_id)
  WHERE formation_session_id IS NOT NULL AND status = 'draft';

ALTER TABLE public.evidence
  ADD COLUMN source_formation_session_id uuid
    REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN source_formation_proposal_id uuid
    REFERENCES public.representation_proposals(id) ON DELETE RESTRICT,
  ADD COLUMN source_correction_request_key uuid,
  ADD CONSTRAINT evidence_formation_correction_lineage_complete CHECK (
    (source_formation_session_id IS NULL
      AND source_formation_proposal_id IS NULL
      AND source_correction_request_key IS NULL)
    OR
    (source_formation_session_id IS NOT NULL
      AND source_formation_proposal_id IS NOT NULL
      AND source_correction_request_key IS NOT NULL)
  );

CREATE UNIQUE INDEX evidence_formation_correction_request_idx
  ON public.evidence (source_formation_session_id, source_correction_request_key)
  WHERE source_formation_session_id IS NOT NULL
    AND source_correction_request_key IS NOT NULL;

-- The deployed baseline returns status as text. PostgreSQL cannot change an
-- OUT-parameter row type with CREATE OR REPLACE, so replace the function
-- explicitly inside this transaction before installing the governed contract.
REVOKE ALL ON FUNCTION public.zeya_link_formation_conversation(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.zeya_link_formation_conversation(
  uuid, uuid, uuid, text
);

CREATE FUNCTION public.zeya_link_formation_conversation(
  p_session_id uuid,
  p_business_representation_id uuid,
  p_conversation_id uuid,
  p_conversation_type text
)
RETURNS TABLE (
  session_id uuid,
  business_representation_id uuid,
  status public.formation_session_status,
  linked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
  v_linked_at timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;
  IF p_session_id IS NULL OR p_business_representation_id IS NULL
    OR p_conversation_id IS NULL
    OR p_conversation_type IS DISTINCT FROM 'voice_conversation_output' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid conversation-link parameters';
  END IF;

  SELECT formation.* INTO v_session
  FROM public.representation_formation_sessions AS formation
  WHERE formation.id = p_session_id
    AND formation.business_representation_id = p_business_representation_id
  FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  IF v_session.status = 'working_conversation_linked'
    AND v_session.first_working_conversation_id = p_conversation_id THEN
    RETURN QUERY SELECT v_session.id, v_session.business_representation_id,
      v_session.status, v_session.updated_at;
    RETURN;
  END IF;
  IF v_session.status <> 'working_conversation_pending' THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409',
      MESSAGE = 'formation session not ready for conversation linking';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voice_conversation_outputs AS output
    WHERE output.id = p_conversation_id
      AND output.tenant_user_id = v_session.owner_id
      AND output.business_id = v_session.business_id
      AND output.business_representation_id = v_session.business_representation_id
      AND output.transcript_status = 'finalized'
      AND output.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'conversation not found or not eligible for formation';
  END IF;

  v_linked_at := pg_catalog.clock_timestamp();
  UPDATE public.representation_formation_sessions AS formation
  SET status = 'working_conversation_linked',
      first_working_conversation_id = p_conversation_id,
      updated_at = v_linked_at
  WHERE formation.id = p_session_id
    AND formation.business_representation_id = p_business_representation_id
  RETURNING formation.* INTO v_session;

  RETURN QUERY SELECT v_session.id, v_session.business_representation_id,
    v_session.status, v_linked_at;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_link_formation_conversation(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_link_formation_conversation(
  uuid, uuid, uuid, text
) TO service_role;

CREATE FUNCTION public.zeya_record_formation_owner_correction(
  p_session_id uuid,
  p_proposal_id uuid,
  p_owner_id uuid,
  p_request_key uuid,
  p_raw_statement text
)
RETURNS TABLE (evidence_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
  v_existing_id uuid;
  v_evidence_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL OR p_proposal_id IS NULL OR p_owner_id IS NULL
    OR p_request_key IS NULL OR p_raw_statement IS NULL
    OR char_length(btrim(p_raw_statement)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid correction parameters';
  END IF;

  SELECT formation.* INTO v_session
  FROM public.representation_formation_sessions AS formation
  WHERE formation.id = p_session_id
    AND formation.owner_id = p_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  SELECT evidence.id INTO v_existing_id
  FROM public.evidence AS evidence
  WHERE evidence.source_formation_session_id = p_session_id
    AND evidence.source_correction_request_key = p_request_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    WHERE proposal.id = p_proposal_id
      AND proposal.formation_session_id = p_session_id
      AND proposal.business_representation_id = v_session.business_representation_id
      AND proposal.status = 'draft'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'formation summary is not current';
  END IF;

  INSERT INTO public.evidence (
    business_representation_id,
    source_type,
    source_description,
    raw_statement,
    affected_domains,
    captured_by_actor,
    source_formation_session_id,
    source_formation_proposal_id,
    source_correction_request_key
  ) VALUES (
    v_session.business_representation_id,
    'conversation'::public.evidence_source_type,
    'Owner correction during Formation review',
    btrim(p_raw_statement),
    ARRAY[]::text[],
    'owner:' || p_owner_id::text,
    p_session_id,
    p_proposal_id,
    p_request_key
  )
  RETURNING id INTO v_evidence_id;

  UPDATE public.representation_proposals AS proposal
  SET status = 'superseded', status_updated_at = pg_catalog.now()
  WHERE proposal.id = p_proposal_id
    AND proposal.status = 'draft';

  INSERT INTO public.audit_events (
    business_representation_id,
    event_type,
    evidence_id,
    actor_user_id,
    details
  ) VALUES (
    v_session.business_representation_id,
    'evidence_created',
    v_evidence_id,
    p_owner_id,
    pg_catalog.jsonb_build_object(
      'source', 'formation_owner_correction',
      'formationSessionId', p_session_id,
      'proposalId', p_proposal_id
    )
  );

  RETURN QUERY SELECT v_evidence_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
) TO service_role;

COMMIT;
