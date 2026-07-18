BEGIN;
DO $$ BEGIN
 IF to_regclass('public.voice_provider_webhook_receipts') IS NULL
    OR to_regprocedure('public.zeya_begin_voice_webhook_receipt(text,text,text,text,uuid)') IS NULL
    OR to_regprocedure('public.zeya_finish_voice_webhook_receipt(text,integer,boolean)') IS NULL
    OR to_regprocedure('public.zeya_repair_public_experience_dispatch(uuid,text,text)') IS NULL
    OR to_regprocedure('public.zeya_record_public_experience_call_failure(uuid,text,text,text)') IS NULL THEN
  RAISE EXCEPTION 'Rollback refused: Phase 4B.3 object drift detected';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN(
       'zeya_enforce_voice_webhook_receipt_writes','zeya_begin_voice_webhook_receipt',
       'zeya_finish_voice_webhook_receipt','zeya_repair_public_experience_dispatch',
       'zeya_record_public_experience_call_failure'))<>5 THEN
  RAISE EXCEPTION 'Rollback refused: Phase 4B.3 function overload drift detected';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=to_regprocedure('public.zeya_complete_public_experience_call(uuid,uuid)')
     AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""']::text[]
     AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%l.created_at<=s.expires_at%'
 ) THEN
  RAISE EXCEPTION 'Rollback refused: completion RPC drift detected';
 END IF;
 IF (SELECT array_agg(state ORDER BY state) FROM (
       SELECT DISTINCT match.value[1]::text AS state
       FROM pg_catalog.pg_constraint c
       CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(c.oid,true),'''([^'']+)''::text','g') match(value)
       WHERE c.conrelid=to_regclass('public.public_experience_sessions') AND c.conname='public_experience_sessions_state_check'
     ) states) IS DISTINCT FROM ARRAY['call_active','call_completed_without_transcript','call_correlation_pending','call_dispatched','call_failed','call_rejected','call_requested','call_unanswered','completion_processing_failed','dispatch_resolution_pending','expired','failed','reflection_ready','zeya_active','zeya_finalized']::text[] THEN
  RAISE EXCEPTION 'Rollback refused: Phase 4B.3 state drift detected';
 END IF;
 IF EXISTS(SELECT 1 FROM public.voice_provider_webhook_receipts)
    OR EXISTS(SELECT 1 FROM public.public_experience_sessions WHERE state IN('call_failed','call_unanswered','call_rejected','call_completed_without_transcript','completion_processing_failed'))
    OR EXISTS(SELECT 1 FROM public.public_experience_sessions WHERE veya_conversation_output_id IS NOT NULL AND state='reflection_ready') THEN
  RAISE EXCEPTION 'Rollback refused: durable completion state exists';
 END IF;
END $$;
DROP FUNCTION public.zeya_record_public_experience_call_failure(UUID,TEXT,TEXT,TEXT);
DROP FUNCTION public.zeya_repair_public_experience_dispatch(UUID,TEXT,TEXT);
DROP FUNCTION public.zeya_finish_voice_webhook_receipt(TEXT,INTEGER,BOOLEAN);
DROP FUNCTION public.zeya_begin_voice_webhook_receipt(TEXT,TEXT,TEXT,TEXT,UUID);
DROP TRIGGER zeya_voice_webhook_receipt_writes ON public.voice_provider_webhook_receipts;
DROP FUNCTION public.zeya_enforce_voice_webhook_receipt_writes();
DROP TABLE public.voice_provider_webhook_receipts;
ALTER TABLE public.public_experience_sessions DROP CONSTRAINT public_experience_sessions_state_check;
ALTER TABLE public.public_experience_sessions ADD CONSTRAINT public_experience_sessions_state_check CHECK(state IN('zeya_active','zeya_finalized','call_requested','call_correlation_pending','dispatch_resolution_pending','call_dispatched','call_active','reflection_ready','failed','expired'));
CREATE OR REPLACE FUNCTION public.zeya_complete_public_experience_call(p_veya_voice_context_id UUID,p_conversation_output_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
 SELECT * INTO v FROM public.public_experience_sessions WHERE veya_voice_context_id=p_veya_voice_context_id FOR UPDATE;
 IF v.id IS NULL THEN RETURN 'untracked'; END IF;
 IF v.veya_conversation_output_id=p_conversation_output_id AND v.state='reflection_ready' THEN RETURN v.state; END IF;
 IF v.state NOT IN('call_dispatched','call_active') OR v.veya_conversation_output_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='completion conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.voice_conversation_outputs o WHERE o.id=p_conversation_output_id AND o.voice_context_id=p_veya_voice_context_id AND o.provider_attested=true AND o.transcript_status='finalized') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid Veya output'; END IF;
 PERFORM set_config('zeya.public_experience_session_write','on',true);
 UPDATE public.public_experience_sessions SET veya_conversation_output_id=p_conversation_output_id,state='reflection_ready',call_completed_at=now(),updated_at=now() WHERE id=v.id;
 RETURN 'reflection_ready';
END $$;
ALTER FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_complete_public_experience_call(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
