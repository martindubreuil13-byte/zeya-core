BEGIN;

CREATE TABLE public.direct_hire_working_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  direct_hire_onboarding_session_id uuid NOT NULL REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE CASCADE,
  formation_session_id uuid REFERENCES public.representation_formation_sessions(id) ON DELETE SET NULL,
  session_kind text NOT NULL DEFAULT 'first_working_session' CHECK (
    session_kind = 'first_working_session'
  ),
  scheduled_at timestamptz NOT NULL,
  scheduling_timezone text NOT NULL CHECK (length(scheduling_timezone) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'cancelled', 'completed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX direct_hire_working_sessions_one_active_idx
  ON public.direct_hire_working_sessions (direct_hire_onboarding_session_id)
  WHERE status = 'scheduled';

CREATE INDEX direct_hire_working_sessions_owner_idx
  ON public.direct_hire_working_sessions (owner_id, direct_hire_onboarding_session_id, created_at DESC);

CREATE FUNCTION public.zeya_validate_direct_hire_working_session_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_hire_onboarding_sessions AS onboarding
    JOIN public.businesses AS business
      ON business.id = onboarding.business_id
     AND business.user_id = onboarding.owner_id
    JOIN public.business_representations AS representation
      ON representation.id = onboarding.business_representation_id
     AND representation.business_id = onboarding.business_id
     AND representation.user_id = onboarding.owner_id
    WHERE onboarding.id = NEW.direct_hire_onboarding_session_id
      AND onboarding.owner_id = NEW.owner_id
      AND onboarding.business_id = NEW.business_id
      AND onboarding.business_representation_id = NEW.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'working session lineage invalid';
  END IF;

  IF NEW.formation_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.representation_formation_sessions AS formation
    WHERE formation.id = NEW.formation_session_id
      AND formation.owner_id = NEW.owner_id
      AND formation.business_id = NEW.business_id
      AND formation.business_representation_id = NEW.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'formation lineage invalid';
  END IF;

  IF NEW.status = 'scheduled'
     AND (
       TG_OP = 'INSERT'
       OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
       OR NEW.status IS DISTINCT FROM OLD.status
     )
     AND NEW.scheduled_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'scheduled time must be in the future';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names AS timezone
    WHERE timezone.name = NEW.scheduling_timezone
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid scheduling timezone';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_working_sessions_validate
  BEFORE INSERT OR UPDATE ON public.direct_hire_working_sessions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_validate_direct_hire_working_session_lineage();

ALTER TABLE public.direct_hire_working_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY direct_hire_working_sessions_owner_read
  ON public.direct_hire_working_sessions
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

REVOKE ALL ON TABLE public.direct_hire_working_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.direct_hire_working_sessions TO authenticated;
GRANT ALL ON TABLE public.direct_hire_working_sessions TO service_role;

CREATE FUNCTION public.zeya_schedule_direct_hire_working_session(
  p_scheduled_at timestamptz,
  p_scheduling_timezone text
)
RETURNS SETOF public.direct_hire_working_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_session public.direct_hire_working_sessions%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'scheduled time must be in the future';
  END IF;
  IF p_scheduling_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names AS timezone
    WHERE timezone.name = p_scheduling_timezone
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid scheduling timezone';
  END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.owner_id = v_owner_id
  ORDER BY onboarding.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_onboarding.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'onboarding not found';
  END IF;
  IF v_onboarding.onboarding_state <> 'employment_accepted'
     OR v_onboarding.induction_state <> 'preparation_pending' THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'induction not complete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses AS business
    WHERE business.id = v_onboarding.business_id AND business.user_id = v_owner_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.business_representations AS representation
    WHERE representation.id = v_onboarding.business_representation_id
      AND representation.business_id = v_onboarding.business_id
      AND representation.user_id = v_owner_id
      AND representation.current_version_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'onboarding lineage invalid';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.direct_hire_onboarding_session_id = v_onboarding.id
    AND working_session.status = 'scheduled'
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    INSERT INTO public.direct_hire_working_sessions (
      owner_id, business_id, business_representation_id,
      direct_hire_onboarding_session_id, scheduled_at, scheduling_timezone
    ) VALUES (
      v_owner_id, v_onboarding.business_id, v_onboarding.business_representation_id,
      v_onboarding.id, p_scheduled_at, p_scheduling_timezone
    ) RETURNING * INTO v_session;
  ELSE
    UPDATE public.direct_hire_working_sessions AS working_session
    SET scheduled_at = p_scheduled_at,
        scheduling_timezone = p_scheduling_timezone
    WHERE working_session.id = v_session.id
      AND working_session.owner_id = v_owner_id
    RETURNING working_session.* INTO v_session;
  END IF;

  RETURN NEXT v_session;
END;
$$;

CREATE FUNCTION public.zeya_cancel_direct_hire_working_session()
RETURNS SETOF public.direct_hire_working_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_session public.direct_hire_working_sessions%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.owner_id = v_owner_id
  ORDER BY onboarding.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_onboarding.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'onboarding not found';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.direct_hire_onboarding_session_id = v_onboarding.id
  ORDER BY (working_session.status = 'scheduled') DESC, working_session.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'working session not found';
  END IF;
  IF v_session.status = 'cancelled' THEN
    RETURN NEXT v_session;
    RETURN;
  END IF;
  IF v_session.status = 'completed' THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'completed working session cannot be cancelled';
  END IF;

  UPDATE public.direct_hire_working_sessions AS working_session
  SET status = 'cancelled'
  WHERE working_session.id = v_session.id
    AND working_session.owner_id = v_owner_id
    AND working_session.status = 'scheduled'
  RETURNING working_session.* INTO v_session;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'working session cancellation conflict';
  END IF;
  RETURN NEXT v_session;
END;
$$;

-- Employment acceptance now precedes research and induction.
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

  -- P2.1 intentionally removes only the predecessor's preparation-status gate.

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

ALTER FUNCTION public.zeya_validate_direct_hire_working_session_lineage() OWNER TO postgres;
ALTER FUNCTION public.zeya_schedule_direct_hire_working_session(timestamptz, text) OWNER TO postgres;
ALTER FUNCTION public.zeya_cancel_direct_hire_working_session() OWNER TO postgres;
ALTER FUNCTION public.zeya_accept_direct_hire_employment() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_validate_direct_hire_working_session_lineage() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_schedule_direct_hire_working_session(timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_cancel_direct_hire_working_session() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_accept_direct_hire_employment() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_schedule_direct_hire_working_session(timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_cancel_direct_hire_working_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_accept_direct_hire_employment() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
