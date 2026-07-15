SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('voice_conversation_outputs','voice_conversation_candidates')
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.voice_conversation_outputs'::regclass, 'public.voice_conversation_candidates'::regclass)
ORDER BY table_name::text, conname;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('voice_conversation_outputs','voice_conversation_candidates');

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('voice_conversation_outputs','voice_conversation_candidates')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('voice_conversation_outputs','voice_conversation_candidates')
ORDER BY table_name, grantee, privilege_type;

SELECT role_name, table_name,
       has_table_privilege(role_name, 'public.' || table_name, 'SELECT') AS can_select,
       has_table_privilege(role_name, 'public.' || table_name, 'INSERT') AS can_insert,
       has_table_privilege(role_name, 'public.' || table_name, 'UPDATE') AS can_update,
       has_table_privilege(role_name, 'public.' || table_name, 'DELETE') AS can_delete,
       has_table_privilege(role_name, 'public.' || table_name, 'TRUNCATE') AS can_truncate,
       has_table_privilege(role_name, 'public.' || table_name, 'REFERENCES') AS can_reference,
       has_table_privilege(role_name, 'public.' || table_name, 'TRIGGER') AS can_trigger
FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
CROSS JOIN (VALUES ('voice_conversation_outputs'),('voice_conversation_candidates')) tables(table_name)
ORDER BY table_name, role_name;

SELECT p.oid::regprocedure AS signature, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer, p.proconfig AS fixed_configuration, p.proacl AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'zeya_capture_voice_conversation_output',
    'zeya_finalize_voice_conversation_transcript',
    'zeya_set_voice_conversation_processing_status',
    'zeya_store_voice_conversation_candidates',
    'zeya_enforce_voice_output_immutability',
    'zeya_purge_business_representation'
  ) ORDER BY signature::text;

WITH target AS (
  SELECT p.oid, p.oid::regprocedure AS signature,
         COALESCE(p.proacl, acldefault('f', p.proowner)) AS effective_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_enforce_voice_output_immutability'
), expanded AS (
  SELECT target.signature, acl.grantee, acl.privilege_type
  FROM target CROSS JOIN LATERAL aclexplode(target.effective_acl) acl
)
SELECT signature,
       COALESCE(bool_or(grantee = 0 AND privilege_type = 'EXECUTE'), FALSE) AS public_can_execute,
       has_function_privilege('anon', signature, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', signature, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', signature, 'EXECUTE') AS service_role_can_execute
FROM expanded
GROUP BY signature;

SELECT p.oid::regprocedure AS signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'zeya_capture_voice_conversation_output',
    'zeya_finalize_voice_conversation_transcript',
    'zeya_set_voice_conversation_processing_status',
    'zeya_store_voice_conversation_candidates'
  ) ORDER BY signature::text;

SELECT c.relname AS table_name, t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
  AND c.relname IN ('voice_conversation_outputs','voice_conversation_candidates');

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (tablename IN ('voice_conversation_outputs','voice_conversation_candidates')
       OR indexname = 'voice_lineage_identity_idx')
ORDER BY tablename, indexname;

SELECT
  strpos(pg_get_functiondef(p.oid), 'DELETE FROM public.voice_conversation_candidates') AS candidate_delete_position,
  strpos(pg_get_functiondef(p.oid), 'DELETE FROM public.voice_conversation_outputs') AS output_delete_position,
  strpos(pg_get_functiondef(p.oid), 'DELETE FROM public.voice_representation_lineage') AS lineage_delete_position,
  strpos(pg_get_functiondef(p.oid), '''voice_conversation_candidates''') > 0 AS reports_candidate_count,
  strpos(pg_get_functiondef(p.oid), '''voice_conversation_outputs''') > 0 AS reports_output_count,
  strpos(pg_get_functiondef(p.oid), '''voice_representation_lineage''') > 0 AS reports_lineage_count
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'zeya_purge_business_representation';

WITH definitions AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'zeya_enforce_voice_output_immutability',
      'zeya_store_voice_conversation_candidates'
    )
)
SELECT proname,
       strpos(definition, 'completed_extraction_schema_version') > 0 AS has_completed_schema_marker,
       strpos(definition, 'extraction_result_hash') > 0 AS has_result_hash,
       strpos(definition, 'extracted_candidate_count') > 0 AS has_candidate_count,
       strpos(definition, 'md5(p_candidates::text)') > 0 AS hashes_normalized_jsonb,
       strpos(definition, 'authorized_element_keys') > 0 AS checks_authorized_elements,
       strpos(definition, 'agent statement cannot create candidate Evidence') > 0 AS rejects_agent_evidence,
       strpos(definition, 'transcript state is immutable') > 0 AS protects_transcript_state,
       strpos(definition, 'conversation completion is immutable') > 0 AS protects_completion_metadata,
       strpos(definition, 'extraction result identity is immutable') > 0 AS protects_extraction_identity,
       strpos(definition, 'invalid conversation processing transition') > 0 AS protects_processing_state
FROM definitions
ORDER BY proname;
