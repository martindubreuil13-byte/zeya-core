-- Preview-only pre-canonical voice contract inspection (STRICTLY READ-ONLY).
-- Confirm project hdjojgvvlojbhgidirht before use. No application rows are read.

-- Exact ordinary-function definitions, signatures, return types and security settings.
WITH selected_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.prosecdef,
    procedure.proconfig,procedure.proacl,procedure.prosrc
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname IN (
      'zeya_create_pre_canonical_voice_representation_lineage',
      'zeya_create_voice_representation_lineage',
      'zeya_capture_voice_conversation_output',
      'zeya_link_formation_conversation'
    )
)
SELECT function_row.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(function_row.oid) AS result_type,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS function_settings,
  owner_role.rolname AS owner_role,
  function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])' AS credential_shaped_literal_detected,
  CASE WHEN function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
    THEN '[REDACTED: credential-shaped literal detected]'
    ELSE pg_catalog.pg_get_functiondef(function_row.oid)
  END AS function_definition
FROM selected_functions AS function_row
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=function_row.proowner
ORDER BY function_row.proname,identity_arguments;

-- Effective EXECUTE privileges. PUBLIC is inspected directly from the ACL.
WITH selected_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.proacl
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname IN ('zeya_create_pre_canonical_voice_representation_lineage','zeya_create_voice_representation_lineage','zeya_capture_voice_conversation_output','zeya_link_formation_conversation')
)
SELECT function_row.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
  has_function_privilege('service_role',function_row.oid,'EXECUTE') AS service_role_execute,
  has_function_privilege('authenticated',function_row.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon',function_row.oid,'EXECUTE') AS anon_execute,
  EXISTS (SELECT 1 FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
FROM selected_functions AS function_row
ORDER BY function_row.proname,identity_arguments;

-- Catalog-recorded dependencies in both directions. PL/pgSQL calls may not create pg_depend rows.
WITH selected_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname IN ('zeya_create_pre_canonical_voice_representation_lineage','zeya_create_voice_representation_lineage','zeya_capture_voice_conversation_output','zeya_link_formation_conversation')
)
SELECT function_row.proname AS inspected_function,'depends_on'::text AS dependency_direction,
  pg_catalog.pg_describe_object(dependency.refclassid,dependency.refobjid,dependency.refobjsubid) AS related_object
FROM selected_functions AS function_row JOIN pg_catalog.pg_depend AS dependency ON dependency.classid='pg_proc'::regclass AND dependency.objid=function_row.oid
UNION ALL
SELECT function_row.proname,'depended_on_by',pg_catalog.pg_describe_object(dependency.classid,dependency.objid,dependency.objsubid)
FROM selected_functions AS function_row JOIN pg_catalog.pg_depend AS dependency ON dependency.refclassid='pg_proc'::regclass AND dependency.refobjid=function_row.oid
ORDER BY inspected_function,dependency_direction,related_object;

-- Column types, nullability and defaults for the deployed lineage contract.
SELECT column_info.table_name,column_info.ordinal_position,column_info.column_name,
  column_info.data_type,column_info.udt_name,column_info.is_nullable,column_info.column_default
FROM information_schema.columns AS column_info
WHERE column_info.table_schema='public' AND column_info.table_name IN (
  'voice_representation_lineage','voice_conversation_outputs',
  'business_representations','representation_versions'
)
ORDER BY column_info.table_name,column_info.ordinal_position;

-- Constraints, foreign keys, checks and indexes.
SELECT table_row.relname AS table_name,constraint_row.conname AS object_name,
  constraint_row.contype::text AS object_type,
  pg_catalog.pg_get_constraintdef(constraint_row.oid,true) AS definition
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS table_row ON table_row.oid=constraint_row.conrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
WHERE namespace.nspname='public' AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs','business_representations','representation_versions')
UNION ALL
SELECT index_row.tablename,index_row.indexname,'index',index_row.indexdef
FROM pg_catalog.pg_indexes AS index_row
WHERE index_row.schemaname='public' AND index_row.tablename IN ('voice_representation_lineage','voice_conversation_outputs','business_representations','representation_versions')
ORDER BY table_name,object_type,object_name;

-- Triggers and RLS policies; definitions only, never row content.
SELECT table_row.relname AS table_name,trigger_row.tgname AS object_name,'trigger'::text AS object_type,
  pg_catalog.pg_get_triggerdef(trigger_row.oid,true) AS definition
FROM pg_catalog.pg_trigger AS trigger_row
JOIN pg_catalog.pg_class AS table_row ON table_row.oid=trigger_row.tgrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
WHERE namespace.nspname='public' AND NOT trigger_row.tgisinternal
  AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs','business_representations','representation_versions')
UNION ALL
SELECT policy.tablename,policy.policyname,'rls_policy',concat('roles=',policy.roles::text,'; command=',policy.cmd,'; using=',coalesce(policy.qual,''),'; check=',coalesce(policy.with_check,''))
FROM pg_catalog.pg_policies AS policy
WHERE policy.schemaname='public' AND policy.tablename IN ('voice_representation_lineage','voice_conversation_outputs','business_representations','representation_versions')
ORDER BY table_name,object_type,object_name;

-- Repository comparison metadata established by local source inspection.
SELECT true AS repository_migration_missing,
  true AS runtime_precanonical_rpc_reference_present,
  true AS static_test_expected_migration_missing,
  false AS generated_supabase_contract_found,
  'supabase/migrations/20260730100000_pre_canonical_public_experience.sql'::text AS expected_missing_migration,
  'zeya_create_pre_canonical_voice_representation_lineage'::text AS runtime_expected_rpc;
