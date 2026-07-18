BEGIN;

CREATE FUNCTION public.zeya_mark_public_experience_dispatch_resolution_pending(
  p_token_hash TEXT,
  p_dispatch_id TEXT,
  p_phone_hash TEXT,
  p_expected_state TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session_row public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_dispatch_id IS NULL
     OR length(p_dispatch_id) NOT BETWEEN 1 AND 200
     OR btrim(p_dispatch_id) = ''
     OR p_phone_hash IS NULL
     OR p_phone_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_state IS DISTINCT FROM 'call_requested' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid dispatch resolution identity';
  END IF;

  SELECT *
    INTO session_row
    FROM public.public_experience_sessions
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF session_row.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'session unavailable';
  END IF;

  IF session_row.dispatch_id IS DISTINCT FROM p_dispatch_id
     OR session_row.phone_hash IS DISTINCT FROM p_phone_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'dispatch resolution identity mismatch';
  END IF;

  IF session_row.veya_voice_context_id IS NOT NULL
     OR session_row.provider_conversation_id IS NOT NULL
     OR session_row.provider_call_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'provider identity already recorded';
  END IF;

  IF session_row.state = 'dispatch_resolution_pending' THEN
    RETURN session_row.state;
  END IF;

  IF session_row.state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'dispatch resolution conflict';
  END IF;

  PERFORM set_config('zeya.public_experience_session_write', 'on', true);

  UPDATE public.public_experience_sessions
     SET state = 'dispatch_resolution_pending',
         updated_at = now()
   WHERE id = session_row.id;

  RETURN 'dispatch_resolution_pending';
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_mark_public_experience_dispatch_resolution_pending(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_mark_public_experience_dispatch_resolution_pending(TEXT, TEXT, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
