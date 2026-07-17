BEGIN;

DO $$
DECLARE v_count bigint;
BEGIN
  IF to_regclass('public.public_experience_sessions') IS NULL THEN
    RAISE EXCEPTION 'Phase 4A table is not installed';
  END IF;
  SELECT count(*) INTO v_count FROM public.public_experience_sessions;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Rollback refused: public_experience_sessions contains % row(s). Purge or retain them explicitly first.',v_count;
  END IF;
END $$;

DROP FUNCTION public.zeya_fail_public_experience_session(TEXT);
DROP FUNCTION public.zeya_complete_public_experience_call(UUID,UUID);
DROP FUNCTION public.zeya_record_public_experience_dispatch(TEXT,TEXT,UUID,TEXT);
DROP FUNCTION public.zeya_request_public_experience_call(TEXT,TEXT,TEXT);
DROP FUNCTION public.zeya_finalize_public_experience_zeya(TEXT,UUID);
DROP FUNCTION public.zeya_create_public_experience_session(TEXT,TIMESTAMPTZ,UUID,TEXT,TEXT,UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT[],TEXT,TEXT,TEXT);
DROP TRIGGER zeya_public_experience_session_writes ON public.public_experience_sessions;
DROP FUNCTION public.zeya_enforce_public_experience_session_writes();
DROP TABLE public.public_experience_sessions;

NOTIFY pgrst, 'reload schema';
COMMIT;
