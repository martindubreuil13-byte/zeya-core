-- Read-only verification for the conversation review actor UUID repair.
WITH target_function AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type)'::regprocedure
)
SELECT oid::regprocedure AS exact_signature, pg_get_userbyid(proowner) AS function_owner,
  prosecdef AS security_definer, proconfig AS function_configuration,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_execute,
  definition LIKE '%actor uuid;%' AS actor_declared_uuid,
  definition LIKE '%actor:=auth.uid();%' AS actor_assigned_uuid,
  definition NOT LIKE '%actor text;%' AS actor_text_removed,
  definition NOT LIKE '%auth.uid()::text%' AS actor_text_cast_removed,
  md5(definition) AS definition_md5
FROM target_function;

SELECT table_name, column_name, data_type, udt_schema, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('evidence', 'captured_by_actor'),
    ('observations', 'created_by_actor'),
    ('representation_proposals', 'proposed_by_actor')
  )
ORDER BY table_name, column_name;
