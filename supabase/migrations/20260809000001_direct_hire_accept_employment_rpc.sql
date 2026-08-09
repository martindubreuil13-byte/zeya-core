BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_accept_direct_hire_employment()
RETURNS TABLE (
  onboarding_session_id uuid,
  onboarding_state text,
  preparation_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication required';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.direct_hire_onboarding_sessions AS session
  WHERE session.owner_id = v_owner_id
  ORDER BY session.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'onboarding not found';
  END IF;

  IF v_session.preparation_status NOT IN ('ready', 'partial') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'preparation not complete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = v_session.business_id
      AND business.user_id = v_owner_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM public.business_representations AS representation
    WHERE representation.id = v_session.business_representation_id
      AND representation.business_id = v_session.business_id
      AND representation.user_id = v_owner_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'onboarding lineage invalid';
  END IF;

  -- Idempotent replay.
  IF v_session.onboarding_state = 'employment_accepted' THEN
    RETURN QUERY
    SELECT
      v_session.id,
      v_session.onboarding_state,
      v_session.preparation_status;
    RETURN;
  END IF;

  IF v_session.onboarding_state <> 'preparation' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'invalid onboarding state';
  END IF;

  UPDATE public.direct_hire_onboarding_sessions AS session
  SET onboarding_state = 'employment_accepted'
  WHERE session.id = v_session.id
    AND session.owner_id = v_owner_id
  RETURNING session.*
  INTO v_session;

  RETURN QUERY
  SELECT
    v_session.id,
    v_session.onboarding_state,
    v_session.preparation_status;
END;
$$;

ALTER FUNCTION public.zeya_accept_direct_hire_employment()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_accept_direct_hire_employment()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.zeya_accept_direct_hire_employment()
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
