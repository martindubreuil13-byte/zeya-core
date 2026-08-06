-- Direct Hire to Formation Handoff
-- Adds formation lineage and RPC with explicit ACL
-- Safe: depends on enum value committed in 20260807000000_direct_hire_formation_source.sql
-- Durable lineage: formation_session_id, formation_initiated_at, initiated_from, initiated_from_id

-- Extend direct_hire_onboarding_sessions with formation lineage
ALTER TABLE public.direct_hire_onboarding_sessions
ADD COLUMN IF NOT EXISTS formation_session_id UUID REFERENCES public.representation_formation_sessions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS formation_initiated_at TIMESTAMP WITH TIME ZONE;

-- Index for efficient formation lookup
CREATE INDEX IF NOT EXISTS direct_hire_formation_session_idx
  ON public.direct_hire_onboarding_sessions(formation_session_id)
  WHERE formation_session_id IS NOT NULL;

-- Atomic RPC: zeya_initiate_direct_hire_formation
-- Idempotent: duplicate calls return the same Formation session
-- Validates all preconditions before creation
CREATE OR REPLACE FUNCTION public.zeya_initiate_direct_hire_formation(
  p_authenticated_user_id UUID,
  p_partial_acknowledged BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  formation_session_id UUID,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_onboarding_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_business public.business_representations%ROWTYPE;
  v_website_evidence public.evidence%ROWTYPE;
  v_formation_id UUID;
BEGIN
  -- Validate authenticated user
  IF p_authenticated_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_authenticated';
  END IF;

  -- Load Direct Hire onboarding session for this owner
  SELECT * INTO v_onboarding_session
  FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = p_authenticated_user_id
  LIMIT 1;

  IF v_onboarding_session IS NULL THEN
    RAISE EXCEPTION 'no_direct_hire_session';
  END IF;

  -- Check: onboarding_state must allow handoff
  IF v_onboarding_session.onboarding_state NOT IN ('preparation', 'employment_accepted') THEN
    RAISE EXCEPTION 'invalid_onboarding_state';
  END IF;

  -- Load business representation
  SELECT * INTO v_business
  FROM public.business_representations
  WHERE id = v_onboarding_session.business_representation_id
  LIMIT 1;

  IF v_business IS NULL THEN
    RAISE EXCEPTION 'representation_not_found';
  END IF;

  -- Validate tenant isolation
  IF v_business.user_id != p_authenticated_user_id THEN
    RAISE EXCEPTION 'ownership_mismatch';
  END IF;

  -- Check: no active Formation lease exists
  IF EXISTS (
    SELECT 1 FROM public.representation_formation_sessions
    WHERE business_representation_id = v_onboarding_session.business_representation_id
    AND owner_id = p_authenticated_user_id
    AND status IN ('initiated', 'getting_familiar', 'working_conversation_pending', 'working_conversation_linked')
  ) THEN
    RAISE EXCEPTION 'active_formation_exists';
  END IF;

  -- Check: no canonical Version exists
  IF v_business.current_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'canonical_version_exists';
  END IF;

  -- Check: website Evidence exists (source_type='public_website')
  SELECT * INTO v_website_evidence
  FROM public.evidence
  WHERE business_representation_id = v_onboarding_session.business_representation_id
  AND source_type = 'public_website'
  AND direct_hire_onboarding_session_id = v_onboarding_session.id
  LIMIT 1;

  IF v_website_evidence IS NULL THEN
    RAISE EXCEPTION 'no_website_evidence';
  END IF;

  -- Check: preparation_status is ready or partial
  IF v_onboarding_session.preparation_status NOT IN ('ready', 'partial') THEN
    RAISE EXCEPTION 'preparation_not_ready';
  END IF;

  -- Check: no active preparation (queued/running)
  IF v_onboarding_session.preparation_status IN ('queued', 'running') THEN
    RAISE EXCEPTION 'preparation_in_progress';
  END IF;

  -- Check: if partial, must be explicitly acknowledged
  IF v_onboarding_session.preparation_status = 'partial' AND NOT p_partial_acknowledged THEN
    RAISE EXCEPTION 'partial_not_acknowledged';
  END IF;

  -- Idempotency: if formation_session_id already set, return it
  IF v_onboarding_session.formation_session_id IS NOT NULL THEN
    RETURN QUERY SELECT v_onboarding_session.formation_session_id, FALSE;
    RETURN;
  END IF;

  -- Create Formation session
  INSERT INTO public.representation_formation_sessions (
    business_id,
    business_representation_id,
    owner_id,
    initiated_from,
    initiated_from_id,
    status,
    formation_started_at
  ) VALUES (
    v_onboarding_session.business_id,
    v_onboarding_session.business_representation_id,
    p_authenticated_user_id,
    'direct_hire_onboarding'::public.formation_initiation_source,
    v_onboarding_session.id,
    'initiated'::public.formation_session_status,
    NOW()
  )
  RETURNING id INTO v_formation_id;

  -- Link Formation back to Direct Hire onboarding session
  UPDATE public.direct_hire_onboarding_sessions
  SET
    formation_session_id = v_formation_id,
    formation_initiated_at = NOW(),
    updated_at = NOW()
  WHERE id = v_onboarding_session.id;

  RETURN QUERY SELECT v_formation_id, TRUE;
END;
$$;

-- RPC ACL: Explicit grant to service_role only
-- Deny PUBLIC, anon, authenticated
REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM service_role;
GRANT EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) TO service_role;