-- Preview pre-canonical voice contract extraction (STRICTLY READ-ONLY).
-- Confirm project hdjojgvvlojbhgidirht before use. No application data is read.

-- Exact deployed pre-canonical RPC definition and identity.
WITH target_function AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.prosecdef,
    procedure.proconfig,procedure.proacl,procedure.prosrc
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname='zeya_create_pre_canonical_voice_representation_lineage'
)
SELECT function_row.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(function_row.oid) AS result_type,
  function_row.prosecdef AS security_definer,function_row.proconfig AS function_settings,
  owner_role.rolname AS owner_role,
  function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])' AS credential_shaped_literal_detected,
  CASE WHEN function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
    THEN '[REDACTED: credential-shaped literal detected]'
    ELSE pg_catalog.pg_get_functiondef(function_row.oid)
  END AS exact_function_definition
FROM target_function AS function_row
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=function_row.proowner;

-- Exact deployed definitions of columns altered by the pre-canonical contract.
SELECT column_info.table_name,column_info.ordinal_position,column_info.column_name,
  column_info.data_type,column_info.udt_schema,column_info.udt_name,
  column_info.is_nullable,column_info.column_default,column_info.is_generated,
  column_info.generation_expression
FROM information_schema.columns AS column_info
WHERE column_info.table_schema='public'
  AND column_info.table_name IN ('voice_representation_lineage','voice_conversation_outputs')
  AND column_info.column_name IN ('canonical_version_id','representation_context_mode')
ORDER BY column_info.table_name,column_info.ordinal_position;

-- Exact checks and foreign keys involving the altered columns.
SELECT table_row.relname AS table_name,constraint_row.conname AS constraint_name,
  CASE constraint_row.contype WHEN 'c' THEN 'check' WHEN 'f' THEN 'foreign_key' ELSE constraint_row.contype::text END AS constraint_type,
  pg_catalog.pg_get_constraintdef(constraint_row.oid,true) AS exact_definition
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS table_row ON table_row.oid=constraint_row.conrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
WHERE namespace.nspname='public'
  AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs')
  AND constraint_row.contype IN ('c','f')
  AND (pg_catalog.pg_get_constraintdef(constraint_row.oid,true) ILIKE '%canonical_version_id%'
    OR pg_catalog.pg_get_constraintdef(constraint_row.oid,true) ILIKE '%representation_context_mode%')
ORDER BY table_name,constraint_type,constraint_name;

-- Exact indexes involving the altered contract columns.
SELECT index_row.tablename AS table_name,index_row.indexname,
  index_row.indexdef AS exact_index_definition
FROM pg_catalog.pg_indexes AS index_row
WHERE index_row.schemaname='public'
  AND index_row.tablename IN ('voice_representation_lineage','voice_conversation_outputs')
  AND (index_row.indexdef ILIKE '%canonical_version_id%'
    OR index_row.indexdef ILIKE '%representation_context_mode%')
ORDER BY index_row.tablename,index_row.indexname;

-- Exact non-internal triggers on affected tables plus their ordinary trigger-function definitions.
WITH trigger_objects AS MATERIALIZED (
  SELECT trigger_row.oid AS trigger_oid,trigger_row.tgfoid,table_row.relname AS table_name,
    trigger_row.tgname,procedure.prokind
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid=trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid=trigger_row.tgfoid
  WHERE namespace.nspname='public' AND NOT trigger_row.tgisinternal
    AND procedure.prokind='f'
    AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs')
)
SELECT trigger_object.table_name,trigger_object.tgname AS trigger_name,
  pg_catalog.pg_get_triggerdef(trigger_object.trigger_oid,true) AS exact_trigger_definition,
  pg_catalog.pg_get_function_identity_arguments(trigger_object.tgfoid) AS trigger_function_identity_arguments,
  pg_catalog.pg_get_functiondef(trigger_object.tgfoid) AS exact_trigger_function_definition
FROM trigger_objects AS trigger_object
ORDER BY trigger_object.table_name,trigger_object.tgname;

-- Exact current ACL entries and reproducible current-state grant/revoke intent.
WITH target_function AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.proacl
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname='zeya_create_pre_canonical_voice_representation_lineage'
)
SELECT function_row.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
  CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  grantor_role.rolname AS grantor,acl.privilege_type,acl.is_grantable,
  has_function_privilege('service_role',function_row.oid,'EXECUTE') AS service_role_execute,
  has_function_privilege('authenticated',function_row.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon',function_row.oid,'EXECUTE') AS anon_execute,
  EXISTS (SELECT 1 FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE') AS public_execute
FROM target_function AS function_row
CROSS JOIN LATERAL aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid=acl.grantee
LEFT JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid=acl.grantor
ORDER BY grantee,acl.privilege_type;

-- Exact catalog-recorded dependencies. PL/pgSQL calls remain visible in the function definition above.
WITH target_function AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
    AND procedure.proname='zeya_create_pre_canonical_voice_representation_lineage'
)
SELECT function_row.proname AS function_name,'depends_on'::text AS direction,
  pg_catalog.pg_describe_object(dependency.refclassid,dependency.refobjid,dependency.refobjsubid) AS related_object,
  dependency.deptype
FROM target_function AS function_row
JOIN pg_catalog.pg_depend AS dependency ON dependency.classid='pg_proc'::regclass AND dependency.objid=function_row.oid
UNION ALL
SELECT function_row.proname,'depended_on_by',
  pg_catalog.pg_describe_object(dependency.classid,dependency.objid,dependency.objsubid),dependency.deptype
FROM target_function AS function_row
JOIN pg_catalog.pg_depend AS dependency ON dependency.refclassid='pg_proc'::regclass AND dependency.refobjid=function_row.oid
ORDER BY direction,related_object;
