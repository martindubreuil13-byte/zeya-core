BEGIN;

ALTER TABLE public.public_experience_sessions
  ADD COLUMN provider_call_id TEXT;

CREATE UNIQUE INDEX public_experience_sessions_provider_call_idx
  ON public.public_experience_sessions(provider_call_id)
  WHERE provider_call_id IS NOT NULL;

ALTER TABLE public.public_experience_sessions
  DROP CONSTRAINT public_experience_sessions_state_check,
  ADD CONSTRAINT public_experience_sessions_state_check CHECK (state IN (
    'zeya_active', 'zeya_finalized', 'call_requested',
    'call_correlation_pending', 'dispatch_resolution_pending',
    'call_dispatched', 'call_active',
    'reflection_ready', 'failed', 'expired'
  ));

CREATE FUNCTION public.zeya_reset_public_experience_call_request(
  p_token_hash TEXT,
  p_dispatch_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized';
  END IF;
  SELECT * INTO v FROM public.public_experience_sessions
    WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL OR v.expires_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable';
  END IF;
  IF v.state='zeya_finalized' AND v.dispatch_id IS NULL THEN RETURN v.state; END IF;
  IF v.state<>'call_requested' OR v.dispatch_id<>p_dispatch_id
     OR v.veya_voice_context_id IS NOT NULL OR v.provider_call_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='call reset conflict';
  END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions
    SET dispatch_id=NULL,state='zeya_finalized',updated_at=now()
    WHERE id=v.id;
  RETURN 'zeya_finalized';
END;
$$;

CREATE FUNCTION public.zeya_record_public_experience_provider_acceptance(
  p_token_hash TEXT,
  p_dispatch_id TEXT,
  p_veya_voice_context_id UUID,
  p_provider_conversation_id TEXT,
  p_provider_call_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized';
  END IF;
  IF p_provider_call_id IS NULL OR btrim(p_provider_call_id)=''
     OR p_provider_conversation_id IS NULL OR btrim(p_provider_conversation_id)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid provider acceptance';
  END IF;
  SELECT * INTO v FROM public.public_experience_sessions
    WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable';
  END IF;
  IF v.dispatch_id<>p_dispatch_id THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='dispatch mismatch';
  END IF;
  IF v.state IN ('call_correlation_pending','call_dispatched','call_active','reflection_ready')
     AND v.veya_voice_context_id=p_veya_voice_context_id
     AND v.provider_call_id=p_provider_call_id
     AND v.provider_conversation_id=p_provider_conversation_id THEN
    RETURN v.state;
  END IF;
  IF v.state<>'call_requested' OR v.veya_voice_context_id IS NOT NULL
     OR v.provider_call_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='provider acceptance conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.voice_representation_lineage l
    WHERE l.voice_context_id=p_veya_voice_context_id
      AND l.mission_id=p_dispatch_id
      AND l.business_id=v.business_id
      AND l.business_representation_id=v.business_representation_id
      AND l.canonical_version_id=v.canonical_version_id
      AND l.voice_context_id<>v.zeya_voice_context_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid Veya lineage';
  END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions
    SET veya_voice_context_id=p_veya_voice_context_id,
        provider_conversation_id=p_provider_conversation_id,
        provider_call_id=p_provider_call_id,
        state='call_correlation_pending',updated_at=now()
    WHERE id=v.id;
  RETURN 'call_correlation_pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_request_public_experience_call(
  p_token_hash TEXT, p_dispatch_id TEXT, p_phone_hash TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL OR v.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable'; END IF;
  IF v.dispatch_id=p_dispatch_id AND v.phone_hash=p_phone_hash AND v.state IN ('call_requested','call_correlation_pending','call_dispatched','call_active','reflection_ready') THEN RETURN v.state; END IF;
  IF v.state<>'zeya_finalized' OR v.dispatch_id IS NOT NULL OR (v.phone_hash IS NOT NULL AND v.phone_hash<>p_phone_hash) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='call request conflict'; END IF;
  IF p_phone_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid phone identity'; END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET dispatch_id=p_dispatch_id,phone_hash=p_phone_hash,state='call_requested',call_requested_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'call_requested';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_record_public_experience_dispatch(
  p_token_hash TEXT, p_dispatch_id TEXT, p_veya_voice_context_id UUID, p_provider_conversation_id TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable'; END IF;
  IF v.dispatch_id<>p_dispatch_id THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='dispatch mismatch'; END IF;
  IF v.state IN ('call_dispatched','call_active','reflection_ready') THEN
    IF v.veya_voice_context_id=p_veya_voice_context_id
       AND v.provider_call_id IS NOT NULL AND btrim(v.provider_call_id)<>''
       AND v.provider_conversation_id IS NOT NULL AND btrim(v.provider_conversation_id)<>''
       AND v.provider_conversation_id=p_provider_conversation_id
       AND EXISTS (
         SELECT 1 FROM public.voice_representation_lineage l
         WHERE l.voice_context_id=v.veya_voice_context_id
           AND l.provider_call_id=v.provider_call_id
           AND l.conversation_id=v.provider_conversation_id
       ) THEN RETURN v.state; END IF;
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='dispatch correlation conflict';
  END IF;
  IF v.state<>'call_correlation_pending' OR v.veya_voice_context_id<>p_veya_voice_context_id
     OR v.provider_call_id IS NULL OR btrim(v.provider_call_id)=''
     OR v.provider_conversation_id IS NULL OR btrim(v.provider_conversation_id)=''
     OR v.provider_conversation_id<>p_provider_conversation_id THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='dispatch correlation conflict'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.voice_representation_lineage l
    WHERE l.voice_context_id=p_veya_voice_context_id
      AND l.business_id=v.business_id
      AND l.business_representation_id=v.business_representation_id
      AND l.canonical_version_id=v.canonical_version_id
      AND l.provider_call_id IS NOT NULL AND btrim(l.provider_call_id)<>''
      AND l.conversation_id IS NOT NULL AND btrim(l.conversation_id)<>''
      AND l.provider_call_id=v.provider_call_id
      AND l.conversation_id=v.provider_conversation_id
  ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider identifiers are not attached'; END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET state='call_dispatched',call_dispatched_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'call_dispatched';
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_request_public_experience_call(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_record_public_experience_dispatch(TEXT,TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_reset_public_experience_call_request(TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_record_public_experience_provider_acceptance(TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_request_public_experience_call(TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_public_experience_dispatch(TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_reset_public_experience_call_request(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_public_experience_provider_acceptance(TEXT,TEXT,UUID,TEXT,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
