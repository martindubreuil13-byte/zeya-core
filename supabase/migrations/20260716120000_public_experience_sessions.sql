BEGIN;

CREATE TABLE public.public_experience_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  business_representation_id UUID NOT NULL,
  canonical_version_id UUID NOT NULL,
  zeya_voice_context_id UUID NOT NULL UNIQUE
    REFERENCES public.voice_representation_lineage(voice_context_id) ON DELETE CASCADE,
  zeya_conversation_output_id UUID UNIQUE
    REFERENCES public.voice_conversation_outputs(id) ON DELETE CASCADE,
  veya_voice_context_id UUID UNIQUE
    REFERENCES public.voice_representation_lineage(voice_context_id) ON DELETE CASCADE,
  veya_conversation_output_id UUID UNIQUE
    REFERENCES public.voice_conversation_outputs(id) ON DELETE CASCADE,
  dispatch_id TEXT UNIQUE,
  phone_hash TEXT CHECK (phone_hash IS NULL OR phone_hash ~ '^[0-9a-f]{64}$'),
  provider_conversation_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'zeya_active', 'zeya_finalized', 'call_requested', 'call_dispatched',
    'call_active', 'reflection_ready', 'failed', 'expired'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  zeya_finalized_at TIMESTAMPTZ,
  call_requested_at TIMESTAMPTZ,
  call_dispatched_at TIMESTAMPTZ,
  call_completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT public_experience_business_tenant_fk
    FOREIGN KEY (business_id, tenant_user_id)
    REFERENCES public.businesses(id, user_id),
  CONSTRAINT public_experience_business_representation_fk
    FOREIGN KEY (business_representation_id, business_id)
    REFERENCES public.business_representations(id, business_id),
  CONSTRAINT public_experience_version_representation_fk
    FOREIGN KEY (canonical_version_id, business_representation_id)
    REFERENCES public.representation_versions(id, business_representation_id),
  CONSTRAINT public_experience_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX public_experience_sessions_representation_idx
  ON public.public_experience_sessions(business_representation_id);
CREATE INDEX public_experience_sessions_expiry_idx
  ON public.public_experience_sessions(expires_at);

ALTER TABLE public.public_experience_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_experience_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_experience_sessions TO service_role;

CREATE FUNCTION public.zeya_enforce_public_experience_session_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user <> 'postgres'
     OR (current_setting('zeya.public_experience_session_write', true) <> 'on'
         AND current_setting('zeya.controlled_purge', true) <> 'on') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'public experience sessions are server controlled';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER zeya_public_experience_session_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.public_experience_sessions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_public_experience_session_writes();

CREATE FUNCTION public.zeya_create_public_experience_session(
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_voice_context_id UUID,
  p_worker_brief_id TEXT,
  p_conversation_id TEXT,
  p_tenant_user_id UUID,
  p_business_id UUID,
  p_business_representation_id UUID,
  p_canonical_version_id UUID,
  p_context_generated_at TIMESTAMPTZ,
  p_authorized_element_keys TEXT[],
  p_agent_id TEXT,
  p_context_schema_version TEXT,
  p_prompt_assembly_version TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'public experience creation not authorized';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid public experience session';
  END IF;

  PERFORM public.zeya_create_voice_representation_lineage(
    p_voice_context_id, p_worker_brief_id, 'public_experience_zeya', p_conversation_id,
    p_tenant_user_id, p_business_id, p_business_representation_id,
    p_canonical_version_id, p_context_generated_at, p_authorized_element_keys,
    false, p_agent_id, 'ZEYA', 'public_discovery',
    p_context_schema_version, p_prompt_assembly_version
  );

  PERFORM set_config('zeya.public_experience_session_write', 'on', true);
  INSERT INTO public.public_experience_sessions (
    token_hash, tenant_user_id, business_id, business_representation_id,
    canonical_version_id, zeya_voice_context_id, state, expires_at
  ) VALUES (
    p_token_hash, p_tenant_user_id, p_business_id, p_business_representation_id,
    p_canonical_version_id, p_voice_context_id, 'zeya_active', p_expires_at
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.zeya_finalize_public_experience_zeya(
  p_token_hash TEXT,
  p_conversation_output_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_session public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v_session FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v_session.id IS NULL OR v_session.expires_at <= now() THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable'; END IF;
  IF v_session.zeya_conversation_output_id = p_conversation_output_id AND v_session.state IN ('zeya_finalized','call_requested','call_dispatched','call_active','reflection_ready') THEN RETURN v_session.state; END IF;
  IF v_session.state <> 'zeya_active' OR v_session.zeya_conversation_output_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='session finalization conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voice_conversation_outputs o WHERE o.id=p_conversation_output_id AND o.voice_context_id=v_session.zeya_voice_context_id AND o.transcript_trust_level='authenticated_client_relay' AND o.provider_attested=false AND o.transcript_status='finalized') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid Zeya conversation output';
  END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET zeya_conversation_output_id=p_conversation_output_id, state='zeya_finalized', zeya_finalized_at=now(), updated_at=now() WHERE id=v_session.id;
  RETURN 'zeya_finalized';
END;
$$;

CREATE FUNCTION public.zeya_request_public_experience_call(p_token_hash TEXT, p_dispatch_id TEXT, p_phone_hash TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL OR v.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable'; END IF;
  IF v.dispatch_id=p_dispatch_id AND v.phone_hash=p_phone_hash AND v.state IN ('call_requested','call_dispatched','call_active','reflection_ready') THEN RETURN v.state; END IF;
  IF v.state<>'zeya_finalized' OR v.dispatch_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='call request conflict'; END IF;
  IF p_phone_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid phone identity'; END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET dispatch_id=p_dispatch_id,phone_hash=p_phone_hash,state='call_requested',call_requested_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'call_requested';
END; $$;

CREATE FUNCTION public.zeya_record_public_experience_dispatch(
  p_token_hash TEXT, p_dispatch_id TEXT, p_veya_voice_context_id UUID, p_provider_conversation_id TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL OR v.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='session unavailable'; END IF;
  IF v.dispatch_id<>p_dispatch_id THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='dispatch mismatch'; END IF;
  IF v.veya_voice_context_id=p_veya_voice_context_id AND v.state IN ('call_dispatched','call_active','reflection_ready') THEN RETURN v.state; END IF;
  IF v.state<>'call_requested' OR v.veya_voice_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='dispatch correlation conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voice_representation_lineage l WHERE l.voice_context_id=p_veya_voice_context_id AND l.business_id=v.business_id AND l.business_representation_id=v.business_representation_id AND l.canonical_version_id=v.canonical_version_id AND l.voice_context_id<>v.zeya_voice_context_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid Veya lineage';
  END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET veya_voice_context_id=p_veya_voice_context_id,provider_conversation_id=p_provider_conversation_id,state='call_dispatched',call_dispatched_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'call_dispatched';
END; $$;

CREATE FUNCTION public.zeya_complete_public_experience_call(p_veya_voice_context_id UUID, p_conversation_output_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE veya_voice_context_id=p_veya_voice_context_id FOR UPDATE;
  IF v.id IS NULL THEN RETURN 'untracked'; END IF;
  IF v.veya_conversation_output_id=p_conversation_output_id AND v.state='reflection_ready' THEN RETURN v.state; END IF;
  IF v.state NOT IN ('call_dispatched','call_active') OR v.veya_conversation_output_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='completion conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voice_conversation_outputs o WHERE o.id=p_conversation_output_id AND o.voice_context_id=p_veya_voice_context_id AND o.provider_attested=true AND o.transcript_status='finalized') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid Veya output'; END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET veya_conversation_output_id=p_conversation_output_id,state='reflection_ready',call_completed_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'reflection_ready';
END; $$;

CREATE FUNCTION public.zeya_fail_public_experience_session(p_token_hash TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v FROM public.public_experience_sessions WHERE token_hash=p_token_hash FOR UPDATE;
  IF v.id IS NULL THEN RETURN 'untracked'; END IF;
  IF v.state='failed' THEN RETURN 'failed'; END IF;
  IF v.state<>'zeya_active' THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='failure transition conflict'; END IF;
  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions SET state='failed',failed_at=now(),updated_at=now() WHERE id=v.id;
  RETURN 'failed';
END; $$;

REVOKE ALL ON FUNCTION public.zeya_enforce_public_experience_session_writes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_create_public_experience_session(TEXT,TIMESTAMPTZ,UUID,TEXT,TEXT,UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT[],TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_finalize_public_experience_zeya(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_request_public_experience_call(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_record_public_experience_dispatch(TEXT,TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_fail_public_experience_session(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_create_public_experience_session(TEXT,TIMESTAMPTZ,UUID,TEXT,TEXT,UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT[],TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_public_experience_zeya(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_request_public_experience_call(TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_public_experience_dispatch(TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_fail_public_experience_session(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
