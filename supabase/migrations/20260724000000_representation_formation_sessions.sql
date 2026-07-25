BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ZEYA REPRESENTATION FORMATION SESSION FOUNDATION (RF-A)
-- Date: 2026-07-24
-- Purpose: Implement core Formation Session model for Representation Formation RF-A
-- Safety: Idempotent, safe for multiple runs, does not alter canonical Representation
-- Scope: Owner-scoped formation lifecycle orchestration
-- ═══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- ENUM TYPES
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TYPE formation_session_status AS ENUM (
  'initiated',
  'getting_familiar',
  'working_conversation_pending',
  'working_conversation_linked'
);

CREATE TYPE formation_initiation_source AS ENUM (
  'public_experience_session',
  'representation_brief',
  'callback',
  'owner_request'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- CORE ENTITY: Representation Formation Session
-- Orchestrates the Formation lifecycle for one Representation
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS representation_formation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Ownership and tenant isolation
  owner_id UUID NOT NULL,  -- Cached from business_representations.user_id for RLS efficiency

  -- Formation status
  status formation_session_status NOT NULL DEFAULT 'initiated',

  -- Lineage: where did this Formation originate?
  initiated_from formation_initiation_source,
  initiated_from_id UUID,  -- ID of the source entity (session, brief, etc.)

  -- Context references (by-reference, not copied)
  public_experience_session_id UUID REFERENCES public_experience_sessions(id) ON DELETE SET NULL,
  representation_brief_id UUID REFERENCES public_experience_representation_briefs(id) ON DELETE SET NULL,
  first_working_conversation_id UUID REFERENCES voice_conversation_outputs(id) ON DELETE SET NULL,

  -- Lifecycle timestamps
  formation_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  formation_completed_at TIMESTAMP WITH TIME ZONE,

  -- Audit timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Constraint: one active Formation session per representation
  UNIQUE(business_representation_id)
);

CREATE INDEX IF NOT EXISTS idx_formation_sessions_business_id ON representation_formation_sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_formation_sessions_business_representation_id ON representation_formation_sessions(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_formation_sessions_owner_id ON representation_formation_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_formation_sessions_status ON representation_formation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_formation_sessions_created_at ON representation_formation_sessions(created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE representation_formation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners_can_view_own_formation_sessions" ON representation_formation_sessions;
CREATE POLICY "owners_can_view_own_formation_sessions"
  ON representation_formation_sessions FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owners_can_insert_own_formation_sessions" ON representation_formation_sessions;
CREATE POLICY "owners_can_insert_own_formation_sessions"
  ON representation_formation_sessions FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owners_can_update_own_formation_sessions" ON representation_formation_sessions;
CREATE POLICY "owners_can_update_own_formation_sessions"
  ON representation_formation_sessions FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- AUTO-UPDATE TRIGGER
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_formation_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS formation_sessions_updated_at ON representation_formation_sessions;
CREATE TRIGGER formation_sessions_updated_at
  BEFORE UPDATE ON representation_formation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_formation_sessions_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- AUDIT INTEGRATION
-- ──────────────────────────────────────────────────────────────────────────────

-- Formation audit removed: RF-A does not create canonical audit events

-- ──────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENT FORMATION INITIATION (SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION zeya_initiate_formation_session(
  p_business_id UUID,
  p_business_representation_id UUID,
  p_owner_id UUID,
  p_initiated_from formation_initiation_source,
  p_initiated_from_id UUID
)
RETURNS TABLE (
  session_id UUID,
  business_representation_id UUID,
  status formation_session_status,
  initiated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id UUID;
  v_existing public.representation_formation_sessions%rowtype;
  v_representation public.business_representations%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  -- Verify representation exists and belongs to business
  SELECT *
  INTO v_representation
  FROM public.business_representations
  WHERE id = p_business_representation_id AND business_id = p_business_id
  FOR UPDATE;

  IF v_representation.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  -- Check if active Formation session already exists
  SELECT *
  INTO v_existing
  FROM public.representation_formation_sessions
  WHERE business_representation_id = p_business_representation_id
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    -- Idempotent: return existing session
    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.business_representation_id,
      v_existing.status,
      v_existing.formation_started_at;
    RETURN;
  END IF;

  -- Create new Formation session
  INSERT INTO public.representation_formation_sessions (
    business_id,
    business_representation_id,
    owner_id,
    status,
    initiated_from,
    initiated_from_id,
    formation_started_at
  ) VALUES (
    p_business_id,
    p_business_representation_id,
    p_owner_id,
    'initiated'::public.formation_session_status,
    p_initiated_from,
    p_initiated_from_id,
    now()
  ) RETURNING id INTO v_session_id;

  RETURN QUERY
  SELECT
    v_session_id,
    p_business_representation_id,
    'initiated'::public.formation_session_status,
    now();
END;
$$;

REVOKE ALL ON FUNCTION zeya_initiate_formation_session(UUID, UUID, UUID, formation_initiation_source, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_initiate_formation_session(UUID, UUID, UUID, formation_initiation_source, UUID)
  TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- FORMATION STATE TRANSITION HELPERS (SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION zeya_advance_formation_status(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_expected_current_status formation_session_status,
  p_new_status formation_session_status,
  p_transition_details JSONB
)
RETURNS TABLE (
  session_id UUID,
  status formation_session_status,
  updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL OR p_business_representation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session identity';
  END IF;

  -- Fetch and lock session
  SELECT *
  INTO v_session
  FROM public.representation_formation_sessions
  WHERE id = p_session_id AND business_representation_id = p_business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  -- Validate state transition
  IF v_session.status <> p_expected_current_status THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'formation session status conflict';
  END IF;


  -- Perform transition
  UPDATE public.representation_formation_sessions
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY
  SELECT v_session.id, v_session.business_representation_id, v_session.status, v_session.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION zeya_advance_formation_status(UUID, UUID, formation_session_status, formation_session_status, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_advance_formation_status(UUID, UUID, formation_session_status, formation_session_status, JSONB)
  TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- LINK CONVERSATION TO FORMATION (SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION zeya_link_formation_conversation(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_conversation_id UUID,
  p_conversation_type TEXT
)
RETURNS TABLE (
  session_id UUID,
  status formation_session_status,
  conversation_linked_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%rowtype;
  v_conversation_exists BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  -- Verify session
  SELECT *
  INTO v_session
  FROM public.representation_formation_sessions
  WHERE id = p_session_id AND business_representation_id = p_business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  -- Verify session state allows conversation linking
  IF v_session.status NOT IN ('working_conversation_pending') THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'formation session not in valid state for conversation linking';
  END IF;

  -- Verify conversation belongs to this representation
  SELECT EXISTS (
    SELECT 1
    FROM public.voice_conversation_outputs
    WHERE id = p_conversation_id
      AND business_representation_id = p_business_representation_id
  ) INTO v_conversation_exists;

  IF NOT v_conversation_exists THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'conversation not found or does not belong to representation';
  END IF;

  -- Link conversation and transition to linked state
  UPDATE public.representation_formation_sessions
  SET status = 'working_conversation_linked'::public.formation_session_status,
      first_working_conversation_id = p_conversation_id,
      updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN QUERY
  SELECT v_session.id, v_session.business_representation_id, v_session.status, now();
END;
$$;

REVOKE ALL ON FUNCTION zeya_link_formation_conversation(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_link_formation_conversation(UUID, UUID, UUID, TEXT)
  TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- PURGE INTEGRATION
-- ──────────────────────────────────────────────────────────────────────────────

-- Extend existing zeya_purge_business_representation to handle Formation sessions
CREATE OR REPLACE FUNCTION zeya_purge_business_representation(
  p_business_representation_id UUID,
  p_expected_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_counts JSONB := '{}'::jsonb;
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'purge not authorized';
  END IF;

  SELECT business_id INTO v_business_id
  FROM business_representations
  WHERE id = p_business_representation_id
  FOR UPDATE;

  IF v_business_id IS NULL OR v_business_id <> p_expected_business_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  PERFORM set_config('zeya.controlled_purge', 'on', true);

  -- Formation sessions first (new in RF-A)
  DELETE FROM representation_formation_sessions WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_formation_sessions', v_count);

  -- Existing cascades
  DELETE FROM audit_events WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('audit_events', v_count);
  DELETE FROM confidence_assessments WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('confidence_assessments', v_count);
  UPDATE business_representations SET current_version_id = NULL WHERE id = p_business_representation_id;
  DELETE FROM representation_versions WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_versions', v_count);
  DELETE FROM approval_decisions WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('approval_decisions', v_count);
  DELETE FROM proposal_elements WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_elements', v_count);
  DELETE FROM proposal_evidence WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_evidence', v_count);
  DELETE FROM proposal_observations WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_observations', v_count);
  DELETE FROM representation_proposals WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_proposals', v_count);
  DELETE FROM observations WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('observations', v_count);
  DELETE FROM evidence WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('evidence', v_count);
  DELETE FROM representation_elements WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_elements', v_count);
  DELETE FROM representation_domains WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_domains', v_count);
  DELETE FROM business_representations WHERE id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('business_representations', v_count);

  RETURN jsonb_build_object(
    'businessRepresentationId', p_business_representation_id,
    'businessId', p_expected_business_id,
    'deleted', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION zeya_purge_business_representation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_purge_business_representation(UUID, UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTIFY PGRST
-- ═══════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

COMMIT;
