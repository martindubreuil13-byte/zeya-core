-- Hosted transaction layers retry SQLSTATE 40001, obscuring the required deterministic
-- stale-baseline response. Preserve the guard/message with non-retryable invalid-input state.
BEGIN;
DO $correction$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) INTO definition;
  definition := replace(definition,
    'ERRCODE=''40001'', MESSAGE=''canonical baseline changed''',
    'ERRCODE=''22023'', MESSAGE=''canonical baseline changed''');
  EXECUTE definition;
END;
$correction$;
ALTER FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
