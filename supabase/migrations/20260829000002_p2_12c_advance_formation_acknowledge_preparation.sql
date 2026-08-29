BEGIN;

-- P2.12C Update zeya_advance_formation_status to set preparation_opening_acknowledged
-- when transitioning from 'initiated' to 'getting_familiar' (i.e., when owner clicks
-- "Got it, let's dig deeper" after viewing Prepared Opening).

CREATE OR REPLACE FUNCTION public.zeya_advance_formation_status(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_expected_current_status public.formation_session_status,
  p_new_status public.formation_session_status,
  p_transition_details JSONB
)
RETURNS TABLE (
  session_id UUID,
  business_representation_id UUID,
  status public.formation_session_status,
  transitioned_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
  v_transitioned_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL
     OR p_business_representation_id IS NULL
     OR p_expected_current_status IS NULL
     OR p_new_status IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid session transition parameters';
  END IF;

  SELECT formation_session.*
  INTO v_session
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'formation session not found';
  END IF;

  -- A retry of a transition that already completed is safe and returns the
  -- deployed representation-aware result contract without mutating the row.
  IF v_session.status = p_new_status THEN
    RETURN QUERY
    SELECT
      v_session.id,
      v_session.business_representation_id,
      v_session.status,
      v_session.updated_at;

    RETURN;
  END IF;

  IF v_session.status <> p_expected_current_status THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'formation session state changed';
  END IF;

  -- Enforce the RF-A transition graph.
  IF NOT (
    (
      p_expected_current_status =
        'initiated'::public.formation_session_status
      AND
      p_new_status =
        'getting_familiar'::public.formation_session_status
    )
    OR
    (
      p_expected_current_status =
        'getting_familiar'::public.formation_session_status
      AND
      p_new_status =
        'working_conversation_pending'::public.formation_session_status
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid formation state transition';
  END IF;

  v_transitioned_at := pg_catalog.clock_timestamp();

  -- P2.12C: Set preparation_opening_acknowledged when owner advances from 'initiated'
  -- (i.e., after seeing and acknowledging the Prepared Opening).
  UPDATE public.representation_formation_sessions AS formation_session
  SET
    status = p_new_status,
    preparation_opening_acknowledged = CASE
      WHEN p_expected_current_status = 'initiated'::public.formation_session_status THEN true
      ELSE preparation_opening_acknowledged
    END,
    updated_at = v_transitioned_at
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id =
      p_business_representation_id
  RETURNING formation_session.*
  INTO v_session;

  RETURN QUERY
  SELECT
    v_session.id,
    v_session.business_representation_id,
    v_session.status,
    v_transitioned_at;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
