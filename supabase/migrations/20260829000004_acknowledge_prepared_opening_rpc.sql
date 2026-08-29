BEGIN;

-- P2.12C Authoritative Acknowledgement RPC
--
-- Single atomic transaction that:
-- 1. Validates Formation session ownership
-- 2. Detects idempotency (acknowledgement event already exists)
-- 3. Inserts authoritative formation_events record
-- 4. Sets denormalized cache (preparation_opening_acknowledged = true)
-- 5. Advances Formation status if still in 'initiated' state
--
-- All mutations are in one transaction for consistency.
-- Replay is safe: returns existing event state without duplicate insert.

CREATE OR REPLACE FUNCTION public.zeya_acknowledge_prepared_opening(
  p_session_id UUID,
  p_business_representation_id UUID,
  p_owner_id UUID
)
RETURNS TABLE (
  session_id UUID,
  business_representation_id UUID,
  status public.formation_session_status,
  preparation_opening_acknowledged BOOLEAN,
  acknowledged_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
  v_existing_event public.formation_events%ROWTYPE;
  v_acknowledged_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL
     OR p_business_representation_id IS NULL
     OR p_owner_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid acknowledgement parameters';
  END IF;

  -- Validate Formation session ownership
  SELECT formation_session.*
  INTO v_session
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id
    AND formation_session.owner_id = p_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'formation session not found';
  END IF;

  -- Detect idempotency: if acknowledgement event already exists, return safely
  -- This makes replay safe without duplicate inserts
  SELECT event.*
  INTO v_existing_event
  FROM public.formation_events AS event
  WHERE event.formation_session_id = p_session_id
    AND event.event_type = 'owner_acknowledged_prepared_opening'::public.formation_event_type
  LIMIT 1;

  IF v_existing_event.id IS NOT NULL THEN
    -- Event already exists; return current state without mutation
    RETURN QUERY
    SELECT
      v_session.id,
      v_session.business_representation_id,
      v_session.status,
      v_session.preparation_opening_acknowledged,
      v_existing_event.created_at;
    RETURN;
  END IF;

  -- Authoritative: insert formation event
  v_acknowledged_at := pg_catalog.clock_timestamp();

  INSERT INTO public.formation_events (
    formation_session_id,
    owner_id,
    event_type,
    created_at
  )
  VALUES (
    p_session_id,
    p_owner_id,
    'owner_acknowledged_prepared_opening'::public.formation_event_type,
    v_acknowledged_at
  )
  ON CONFLICT DO NOTHING;  -- Handles race condition: another txn inserted same event

  -- Denormalized cache: set boolean
  UPDATE public.representation_formation_sessions AS formation_session
  SET preparation_opening_acknowledged = true
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id;

  -- Lifecycle: advance status if still in 'initiated'
  -- (If already past initiated, just acknowledge without advancing)
  IF v_session.status = 'initiated'::public.formation_session_status THEN
    UPDATE public.representation_formation_sessions AS formation_session
    SET
      status = 'getting_familiar'::public.formation_session_status,
      updated_at = v_acknowledged_at
    WHERE formation_session.id = p_session_id
      AND formation_session.business_representation_id = p_business_representation_id;
  ELSE
    -- Just update timestamp for the cache mutation
    UPDATE public.representation_formation_sessions AS formation_session
    SET updated_at = v_acknowledged_at
    WHERE formation_session.id = p_session_id
      AND formation_session.business_representation_id = p_business_representation_id;
  END IF;

  -- Fetch updated session
  SELECT formation_session.*
  INTO v_session
  FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.id = p_session_id
    AND formation_session.business_representation_id = p_business_representation_id;

  RETURN QUERY
  SELECT
    v_session.id,
    v_session.business_representation_id,
    v_session.status,
    v_session.preparation_opening_acknowledged,
    v_acknowledged_at;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_acknowledge_prepared_opening(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.zeya_acknowledge_prepared_opening(
  UUID, UUID, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
