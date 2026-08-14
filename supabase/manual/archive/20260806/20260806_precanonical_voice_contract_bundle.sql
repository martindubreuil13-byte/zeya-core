-- Complete deployed pre-canonical voice contract bundle (STRICTLY READ-ONLY).
-- Returns exactly one row. No application data is inspected.
WITH target_function AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.prosecdef,
    procedure.proconfig,procedure.proacl,procedure.prosrc
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.prokind='f'
    AND procedure.proname='zeya_create_pre_canonical_voice_representation_lineage'
), function_payload AS (
  SELECT jsonb_agg(jsonb_build_object(
    'function_name',function_row.proname,
    'identity_arguments',pg_catalog.pg_get_function_identity_arguments(function_row.oid),
    'result_type',pg_catalog.pg_get_function_result(function_row.oid),
    'owner_role',owner_role.rolname,
    'security_definer',function_row.prosecdef,
    'function_settings',function_row.proconfig,
    'credential_shaped_literal_detected',
      function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])',
    'function_definition',CASE
      WHEN function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
        THEN '[REDACTED: credential-shaped literal detected]'
      ELSE pg_catalog.pg_get_functiondef(function_row.oid)
    END
  ) ORDER BY function_row.oid) AS value
  FROM target_function AS function_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=function_row.proowner
), relevant_columns AS (
  SELECT column_info.table_name,column_info.ordinal_position,column_info.column_name,
    column_info.data_type,column_info.udt_schema,column_info.udt_name,
    column_info.is_nullable,column_info.column_default,column_info.is_generated,
    column_info.generation_expression
  FROM information_schema.columns AS column_info
  WHERE column_info.table_schema='public'
    AND column_info.table_name IN ('voice_representation_lineage','voice_conversation_outputs')
    AND column_info.column_name IN ('canonical_version_id','representation_context_mode')
), columns_payload AS (
  SELECT jsonb_agg(to_jsonb(column_row) ORDER BY column_row.table_name,column_row.ordinal_position) AS value
  FROM relevant_columns AS column_row
), relevant_constraints AS MATERIALIZED (
  SELECT table_row.relname AS table_name,constraint_row.conname AS constraint_name,
    constraint_row.contype,pg_catalog.pg_get_constraintdef(constraint_row.oid,true) AS definition
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid=constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
  WHERE namespace.nspname='public'
    AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs')
    AND constraint_row.contype IN ('c','f')
    AND (
      pg_catalog.pg_get_constraintdef(constraint_row.oid,true) ILIKE '%canonical_version_id%'
      OR pg_catalog.pg_get_constraintdef(constraint_row.oid,true) ILIKE '%representation_context_mode%'
      OR pg_catalog.pg_get_constraintdef(constraint_row.oid,true) ILIKE '%pre_canonical%'
    )
), checks_payload AS (
  SELECT jsonb_agg(jsonb_build_object(
    'table_name',constraint_row.table_name,
    'constraint_name',constraint_row.constraint_name,
    'definition',constraint_row.definition
  ) ORDER BY constraint_row.table_name,constraint_row.constraint_name) AS value
  FROM relevant_constraints AS constraint_row
  WHERE constraint_row.contype='c'
), foreign_keys_payload AS (
  SELECT jsonb_agg(jsonb_build_object(
    'table_name',constraint_row.table_name,
    'constraint_name',constraint_row.constraint_name,
    'definition',constraint_row.definition
  ) ORDER BY constraint_row.table_name,constraint_row.constraint_name) AS value
  FROM relevant_constraints AS constraint_row
  WHERE constraint_row.contype='f'
), relevant_indexes AS (
  SELECT index_row.tablename AS table_name,index_row.indexname,
    index_row.indexdef AS definition
  FROM pg_catalog.pg_indexes AS index_row
  WHERE index_row.schemaname='public'
    AND index_row.tablename IN ('voice_representation_lineage','voice_conversation_outputs')
    AND (
      index_row.indexdef ILIKE '%canonical_version_id%'
      OR index_row.indexdef ILIKE '%representation_context_mode%'
      OR index_row.indexdef ILIKE '%pre_canonical%'
    )
), indexes_payload AS (
  SELECT jsonb_agg(to_jsonb(index_row) ORDER BY index_row.table_name,index_row.indexname) AS value
  FROM relevant_indexes AS index_row
), trigger_objects AS MATERIALIZED (
  SELECT trigger_row.oid AS trigger_oid,trigger_row.tgfoid,
    table_row.relname AS table_name,trigger_row.tgname AS trigger_name
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid=trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid=trigger_row.tgfoid
  WHERE namespace.nspname='public'
    AND NOT trigger_row.tgisinternal
    AND procedure.prokind='f'
    AND table_row.relname IN ('voice_representation_lineage','voice_conversation_outputs')
), triggers_payload AS (
  SELECT jsonb_agg(jsonb_build_object(
    'table_name',trigger_row.table_name,
    'trigger_name',trigger_row.trigger_name,
    'trigger_function_identity_arguments',pg_catalog.pg_get_function_identity_arguments(trigger_row.tgfoid),
    'definition',pg_catalog.pg_get_triggerdef(trigger_row.trigger_oid,true)
  ) ORDER BY trigger_row.table_name,trigger_row.trigger_name) AS value
  FROM trigger_objects AS trigger_row
), trigger_function_rows AS MATERIALIZED (
  SELECT DISTINCT procedure.oid,procedure.proname,procedure.proowner,
    procedure.prosecdef,procedure.proconfig,procedure.prosrc
  FROM trigger_objects AS trigger_row
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid=trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public' AND procedure.prokind='f'
), trigger_functions_payload AS (
  SELECT jsonb_agg(jsonb_build_object(
    'function_name',function_row.proname,
    'identity_arguments',pg_catalog.pg_get_function_identity_arguments(function_row.oid),
    'result_type',pg_catalog.pg_get_function_result(function_row.oid),
    'owner_role',owner_role.rolname,
    'security_definer',function_row.prosecdef,
    'function_settings',function_row.proconfig,
    'credential_shaped_literal_detected',
      function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])',
    'function_definition',CASE
      WHEN function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
        THEN '[REDACTED: credential-shaped literal detected]'
      ELSE pg_catalog.pg_get_functiondef(function_row.oid)
    END
  ) ORDER BY function_row.proname,pg_catalog.pg_get_function_identity_arguments(function_row.oid)) AS value
  FROM trigger_function_rows AS function_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=function_row.proowner
), acl_entries AS (
  SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
    grantor_role.rolname AS grantor,acl.privilege_type,acl.is_grantable
  FROM target_function AS function_row
  CROSS JOIN LATERAL aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid=acl.grantee
  LEFT JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid=acl.grantor
), acl_payload AS (
  SELECT jsonb_build_object(
    'entries',coalesce((
      SELECT jsonb_agg(to_jsonb(acl_row) ORDER BY acl_row.grantee,acl_row.privilege_type)
      FROM acl_entries AS acl_row
    ),'[]'::jsonb),
    'service_role_execute',coalesce((
      SELECT has_function_privilege('service_role',function_row.oid,'EXECUTE')
      FROM target_function AS function_row
    ),false),
    'authenticated_execute',coalesce((
      SELECT has_function_privilege('authenticated',function_row.oid,'EXECUTE')
      FROM target_function AS function_row
    ),false),
    'anon_execute',coalesce((
      SELECT has_function_privilege('anon',function_row.oid,'EXECUTE')
      FROM target_function AS function_row
    ),false),
    'public_execute',coalesce((
      SELECT EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl
        WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
      )
      FROM target_function AS function_row
    ),false)
  ) AS value
), dependency_rows AS (
  SELECT 'depends_on'::text AS direction,
    pg_catalog.pg_describe_object(dependency.refclassid,dependency.refobjid,dependency.refobjsubid) AS related_object,
    dependency.deptype
  FROM target_function AS function_row
  JOIN pg_catalog.pg_depend AS dependency
    ON dependency.classid='pg_proc'::regclass AND dependency.objid=function_row.oid
  UNION ALL
  SELECT 'depended_on_by'::text,
    pg_catalog.pg_describe_object(dependency.classid,dependency.objid,dependency.objsubid),
    dependency.deptype
  FROM target_function AS function_row
  JOIN pg_catalog.pg_depend AS dependency
    ON dependency.refclassid='pg_proc'::regclass AND dependency.refobjid=function_row.oid
), dependencies_payload AS (
  SELECT jsonb_agg(to_jsonb(dependency_row) ORDER BY dependency_row.direction,dependency_row.related_object) AS value
  FROM dependency_rows AS dependency_row
), bundle AS (
  SELECT jsonb_build_object(
    'function',coalesce(function_payload.value->0,'null'::jsonb),
    'columns',coalesce(columns_payload.value,'[]'::jsonb),
    'check_constraints',coalesce(checks_payload.value,'[]'::jsonb),
    'foreign_keys',coalesce(foreign_keys_payload.value,'[]'::jsonb),
    'indexes',coalesce(indexes_payload.value,'[]'::jsonb),
    'triggers',coalesce(triggers_payload.value,'[]'::jsonb),
    'trigger_functions',coalesce(trigger_functions_payload.value,'[]'::jsonb),
    'acl',acl_payload.value,
    'dependencies',coalesce(dependencies_payload.value,'[]'::jsonb)
  ) AS contract_bundle,
  (SELECT count(*)=1 FROM target_function)
    AND (SELECT count(*)=4 FROM relevant_columns)
    AND EXISTS (
      SELECT 1
      FROM target_function AS function_row
      WHERE function_row.prosecdef
        AND coalesce(function_row.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
        AND has_function_privilege('service_role',function_row.oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',function_row.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',function_row.oid,'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl
          WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM target_function AS function_row
      WHERE function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM trigger_function_rows AS function_row
      WHERE function_row.prosrc ~* '(sk_live_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}|api[_-]?key[[:space:]]*[:=])'
    ) AS bundle_complete
  FROM function_payload
  CROSS JOIN columns_payload
  CROSS JOIN checks_payload
  CROSS JOIN foreign_keys_payload
  CROSS JOIN indexes_payload
  CROSS JOIN triggers_payload
  CROSS JOIN trigger_functions_payload
  CROSS JOIN acl_payload
  CROSS JOIN dependencies_payload
)
SELECT bundle.contract_bundle,bundle.bundle_complete
FROM bundle;
