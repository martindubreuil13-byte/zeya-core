BEGIN;

CREATE TABLE public.voice_provider_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('elevenlabs')),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 600),
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  provider_conversation_id TEXT NOT NULL CHECK (length(provider_conversation_id) BETWEEN 1 AND 255),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  public_experience_session_id UUID NOT NULL REFERENCES public.public_experience_sessions(id) ON DELETE CASCADE,
  processing_state TEXT NOT NULL CHECK (processing_state IN ('processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(provider,event_key)
);

CREATE INDEX voice_provider_webhook_receipts_conversation_idx
  ON public.voice_provider_webhook_receipts(provider, provider_conversation_id);

ALTER TABLE public.voice_provider_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_provider_webhook_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.voice_provider_webhook_receipts TO service_role;

CREATE FUNCTION public.zeya_enforce_voice_webhook_receipt_writes()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user<>'postgres' OR (current_setting('zeya.voice_webhook_write',true)<>'on' AND current_setting('zeya.controlled_purge',true)<>'on') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='voice webhook receipts are server controlled';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER zeya_voice_webhook_receipt_writes BEFORE INSERT OR UPDATE OR DELETE ON public.voice_provider_webhook_receipts FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_voice_webhook_receipt_writes();

ALTER TABLE public.public_experience_sessions DROP CONSTRAINT public_experience_sessions_state_check;
ALTER TABLE public.public_experience_sessions ADD CONSTRAINT public_experience_sessions_state_check CHECK (state IN (
 'zeya_active','zeya_finalized','call_requested','call_correlation_pending','dispatch_resolution_pending',
 'call_dispatched','call_active','reflection_ready','call_failed','call_unanswered','call_rejected',
 'call_completed_without_transcript','completion_processing_failed','failed','expired'
));

CREATE FUNCTION public.zeya_begin_voice_webhook_receipt(p_event_key TEXT,p_event_type TEXT,p_provider_conversation_id TEXT,p_payload_hash TEXT,p_public_experience_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.voice_provider_webhook_receipts%ROWTYPE; inserted INTEGER;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 IF p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 1 AND 600
    OR p_event_type IS NULL OR length(p_event_type) NOT BETWEEN 1 AND 100
    OR p_provider_conversation_id IS NULL OR length(p_provider_conversation_id) NOT BETWEEN 1 AND 255
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR p_public_experience_session_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid webhook receipt';
 END IF;
 PERFORM set_config('zeya.voice_webhook_write','on',true);
 INSERT INTO public.voice_provider_webhook_receipts(provider,event_key,event_type,provider_conversation_id,payload_hash,public_experience_session_id,processing_state)
 VALUES('elevenlabs',p_event_key,p_event_type,p_provider_conversation_id,p_payload_hash,p_public_experience_session_id,'processing')
 ON CONFLICT(provider,event_key) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO r FROM public.voice_provider_webhook_receipts WHERE provider='elevenlabs' AND event_key=p_event_key FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='webhook receipt unavailable'; END IF;
 IF r.event_type IS DISTINCT FROM p_event_type
    OR r.public_experience_session_id IS DISTINCT FROM p_public_experience_session_id
    OR r.provider_conversation_id IS DISTINCT FROM p_provider_conversation_id
    OR r.payload_hash IS DISTINCT FROM p_payload_hash THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='webhook identity conflict';
 END IF;
 IF r.processing_state='completed' THEN RETURN jsonb_build_object('status','completed','attempt',r.attempt_count); END IF;
 IF r.processing_state='processing' AND inserted=0 THEN
   IF r.last_attempt_at < now() - interval '15 minutes' THEN
     UPDATE public.voice_provider_webhook_receipts
       SET attempt_count=attempt_count+1,last_attempt_at=now()
       WHERE id=r.id RETURNING * INTO r;
     RETURN jsonb_build_object('status','acquired','attempt',r.attempt_count);
   END IF;
   RETURN jsonb_build_object('status','in_progress','attempt',r.attempt_count);
 END IF;
 IF r.processing_state='failed' THEN
   UPDATE public.voice_provider_webhook_receipts
     SET processing_state='processing',attempt_count=attempt_count+1,last_attempt_at=now(),completed_at=NULL
     WHERE id=r.id RETURNING * INTO r;
   RETURN jsonb_build_object('status','acquired','attempt',r.attempt_count);
 END IF;
 RETURN jsonb_build_object('status','acquired','attempt',r.attempt_count);
END; $$;

CREATE FUNCTION public.zeya_finish_voice_webhook_receipt(p_event_key TEXT,p_expected_attempt INTEGER,p_succeeded BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.voice_provider_webhook_receipts%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 IF p_event_key IS NULL OR length(p_event_key) NOT BETWEEN 1 AND 600
    OR p_expected_attempt IS NULL OR p_expected_attempt<1 OR p_succeeded IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid webhook finish';
 END IF;
 SELECT * INTO r FROM public.voice_provider_webhook_receipts WHERE provider='elevenlabs' AND event_key=p_event_key FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='webhook receipt unavailable'; END IF;
 IF r.attempt_count IS DISTINCT FROM p_expected_attempt THEN RETURN 'stale_attempt'; END IF;
 IF r.processing_state='completed' THEN RETURN 'completed'; END IF;
 IF r.processing_state IS DISTINCT FROM 'processing' THEN RETURN 'stale_attempt'; END IF;
 PERFORM set_config('zeya.voice_webhook_write','on',true);
 UPDATE public.voice_provider_webhook_receipts
   SET processing_state=CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END,
       last_attempt_at=now(),completed_at=CASE WHEN p_succeeded THEN now() ELSE NULL END
   WHERE id=r.id AND processing_state='processing' AND attempt_count=p_expected_attempt;
 IF NOT FOUND THEN RETURN 'stale_attempt'; END IF;
 RETURN CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END;
END; $$;

CREATE FUNCTION public.zeya_repair_public_experience_dispatch(p_veya_voice_context_id UUID,p_provider_conversation_id TEXT,p_provider_call_id TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.public_experience_sessions%ROWTYPE; mission TEXT; lineage_created_at TIMESTAMPTZ; matching_ids UUID[];
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 IF p_veya_voice_context_id IS NULL OR p_provider_conversation_id IS NULL OR btrim(p_provider_conversation_id)=''
    OR p_provider_call_id IS NULL OR btrim(p_provider_call_id)='' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid provider identity';
 END IF;
 SELECT l.mission_id,l.created_at INTO mission,lineage_created_at FROM public.voice_representation_lineage l WHERE l.voice_context_id=p_veya_voice_context_id AND l.conversation_id=p_provider_conversation_id AND l.provider_call_id=p_provider_call_id;
 IF mission IS NULL OR btrim(mission)='' THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='provider lineage unavailable'; END IF;
 SELECT array_agg(candidate.id ORDER BY candidate.id) INTO matching_ids
 FROM public.public_experience_sessions candidate
 WHERE (
   candidate.veya_voice_context_id=p_veya_voice_context_id
   OR candidate.dispatch_id=mission
   OR (candidate.provider_conversation_id=p_provider_conversation_id AND candidate.provider_call_id=p_provider_call_id)
 ) AND (candidate.dispatch_id IS NULL OR candidate.dispatch_id IS NOT DISTINCT FROM mission)
   AND (candidate.veya_voice_context_id IS NULL OR candidate.veya_voice_context_id IS NOT DISTINCT FROM p_veya_voice_context_id)
   AND (candidate.provider_conversation_id IS NULL OR candidate.provider_conversation_id IS NOT DISTINCT FROM p_provider_conversation_id)
   AND (candidate.provider_call_id IS NULL OR candidate.provider_call_id IS NOT DISTINCT FROM p_provider_call_id);
 IF cardinality(matching_ids) IS DISTINCT FROM 1 THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='session unavailable'; END IF;
 SELECT * INTO s FROM public.public_experience_sessions WHERE id=matching_ids[1] FOR UPDATE;
 IF lineage_created_at>s.expires_at THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='dispatch occurred after expiry'; END IF;
 IF s.dispatch_id IS DISTINCT FROM mission
    OR (s.veya_voice_context_id IS NOT NULL AND s.veya_voice_context_id IS DISTINCT FROM p_veya_voice_context_id)
    OR (s.provider_conversation_id IS NOT NULL AND s.provider_conversation_id IS DISTINCT FROM p_provider_conversation_id)
    OR (s.provider_call_id IS NOT NULL AND s.provider_call_id IS DISTINCT FROM p_provider_call_id) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='provider identity conflict';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.voice_representation_lineage l WHERE l.voice_context_id=p_veya_voice_context_id AND l.conversation_id=p_provider_conversation_id AND l.provider_call_id=p_provider_call_id AND l.business_id=s.business_id AND l.business_representation_id=s.business_representation_id AND l.canonical_version_id=s.canonical_version_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid provider lineage'; END IF;
 IF s.state='expired' THEN
   PERFORM set_config('zeya.public_experience_session_write','on',true);
   UPDATE public.public_experience_sessions SET veya_voice_context_id=p_veya_voice_context_id,provider_conversation_id=p_provider_conversation_id,provider_call_id=p_provider_call_id,call_dispatched_at=coalesce(call_dispatched_at,lineage_created_at),updated_at=now() WHERE id=s.id;
   RETURN 'expired';
 END IF;
 IF s.state IN ('call_dispatched','call_active','reflection_ready','call_failed','call_unanswered','call_rejected','call_completed_without_transcript','completion_processing_failed') THEN RETURN s.state; END IF;
 IF s.state NOT IN ('call_requested','call_correlation_pending','dispatch_resolution_pending') THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='repair conflict'; END IF;
 PERFORM set_config('zeya.public_experience_session_write','on',true);
 UPDATE public.public_experience_sessions SET veya_voice_context_id=p_veya_voice_context_id,provider_conversation_id=p_provider_conversation_id,provider_call_id=p_provider_call_id,state='call_dispatched',call_dispatched_at=coalesce(call_dispatched_at,lineage_created_at),updated_at=now() WHERE id=s.id;
 RETURN 'call_dispatched';
END; $$;

CREATE FUNCTION public.zeya_record_public_experience_call_failure(p_veya_voice_context_id UUID,p_provider_conversation_id TEXT,p_provider_call_id TEXT,p_outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.public_experience_sessions%ROWTYPE; target TEXT;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 IF p_veya_voice_context_id IS NULL OR p_provider_conversation_id IS NULL OR btrim(p_provider_conversation_id)=''
    OR p_provider_call_id IS NULL OR btrim(p_provider_call_id)='' OR p_outcome IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid call outcome identity';
 END IF;
 target:=CASE p_outcome WHEN 'failed' THEN 'call_failed' WHEN 'unanswered' THEN 'call_unanswered' WHEN 'rejected' THEN 'call_rejected' WHEN 'completed_without_transcript' THEN 'call_completed_without_transcript' WHEN 'completion_processing_failed' THEN 'completion_processing_failed' ELSE NULL END;
 IF target IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid call outcome'; END IF;
 SELECT * INTO s FROM public.public_experience_sessions WHERE veya_voice_context_id=p_veya_voice_context_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN 'untracked'; END IF;
 IF s.provider_conversation_id IS DISTINCT FROM p_provider_conversation_id OR s.provider_call_id IS DISTINCT FROM p_provider_call_id THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='provider identity mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.voice_representation_lineage l WHERE l.voice_context_id=p_veya_voice_context_id AND l.conversation_id=p_provider_conversation_id AND l.provider_call_id=p_provider_call_id AND l.business_id=s.business_id AND l.business_representation_id=s.business_representation_id AND l.canonical_version_id=s.canonical_version_id AND l.mission_id=s.dispatch_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid provider lineage'; END IF;
 IF s.state='reflection_ready' THEN RETURN s.state; END IF;
 IF s.state=target THEN RETURN target; END IF;
 IF s.state NOT IN ('call_dispatched','call_active','completion_processing_failed') THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='call outcome conflict'; END IF;
 PERFORM set_config('zeya.public_experience_session_write','on',true);
 UPDATE public.public_experience_sessions SET state=target,failed_at=now(),updated_at=now() WHERE id=s.id;
 RETURN target;
END; $$;

CREATE OR REPLACE FUNCTION public.zeya_complete_public_experience_call(p_veya_voice_context_id UUID,p_conversation_output_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.public_experience_sessions%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 IF p_veya_voice_context_id IS NULL OR p_conversation_output_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid completion identity'; END IF;
 SELECT * INTO s FROM public.public_experience_sessions WHERE veya_voice_context_id=p_veya_voice_context_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN 'untracked'; END IF;
 IF s.veya_conversation_output_id=p_conversation_output_id AND s.state='reflection_ready' THEN RETURN s.state; END IF;
 IF s.state NOT IN ('call_dispatched','call_active','completion_processing_failed','expired') OR s.veya_conversation_output_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='completion conflict'; END IF;
 IF s.provider_conversation_id IS NULL OR s.provider_call_id IS NULL OR s.dispatch_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='completion conflict';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.voice_conversation_outputs o
   JOIN public.voice_representation_lineage l ON l.voice_context_id=o.voice_context_id
   WHERE o.id=p_conversation_output_id AND o.voice_context_id=p_veya_voice_context_id
     AND o.conversation_id IS NOT DISTINCT FROM s.provider_conversation_id
     AND o.provider_call_id IS NOT DISTINCT FROM s.provider_call_id
     AND o.business_id=s.business_id AND o.business_representation_id=s.business_representation_id
     AND o.canonical_version_id=s.canonical_version_id AND o.provider_attested=true AND o.transcript_status='finalized'
     AND l.conversation_id IS NOT DISTINCT FROM s.provider_conversation_id
     AND l.provider_call_id IS NOT DISTINCT FROM s.provider_call_id
     AND l.business_id=s.business_id AND l.business_representation_id=s.business_representation_id
     AND l.canonical_version_id=s.canonical_version_id AND l.mission_id=s.dispatch_id
     AND l.created_at<=s.expires_at
 ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid Veya output'; END IF;
 PERFORM set_config('zeya.public_experience_session_write','on',true);
 UPDATE public.public_experience_sessions SET veya_conversation_output_id=p_conversation_output_id,state='reflection_ready',call_completed_at=now(),updated_at=now() WHERE id=s.id;
 RETURN 'reflection_ready';
END; $$;

REVOKE ALL ON FUNCTION public.zeya_enforce_voice_webhook_receipt_writes() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_begin_voice_webhook_receipt(TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_finish_voice_webhook_receipt(TEXT,INTEGER,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_repair_public_experience_dispatch(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_record_public_experience_call_failure(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_begin_voice_webhook_receipt(TEXT,TEXT,TEXT,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_finish_voice_webhook_receipt(TEXT,INTEGER,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_repair_public_experience_dispatch(UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_public_experience_call_failure(UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
