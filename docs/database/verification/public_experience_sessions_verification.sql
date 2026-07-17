-- Phase 4A read-only post-deployment verification.
-- Every returned row must have passed = true.
WITH
target_relation AS (
  SELECT
    c.oid AS relation_oid,
    c.relowner AS owner_oid,
    c.relrowsecurity,
    c.relacl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'public_experience_sessions'
    AND c.relkind::text IN ('r', 'p')
),
target_relation_summary AS (
  SELECT
    count(*)::bigint AS relation_count,
    pg_catalog.min(pg_catalog.pg_get_userbyid(owner_oid)::text) AS owner_text,
    COALESCE(pg_catalog.bool_and(relrowsecurity), false) AS rls_enabled,
    pg_catalog.min(relacl::text) AS acl_text
  FROM target_relation
),
expected_columns(
  column_name,
  typcategory,
  type_schema,
  typname,
  not_null,
  has_default,
  identity_state,
  generated_state
) AS (
  VALUES
    ('id', 'U', 'pg_catalog', 'uuid', true, true, '', ''),
    ('token_hash', 'S', 'pg_catalog', 'text', true, false, '', ''),
    ('tenant_user_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('business_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('business_representation_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('canonical_version_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('zeya_voice_context_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('zeya_conversation_output_id', 'U', 'pg_catalog', 'uuid', false, false, '', ''),
    ('veya_voice_context_id', 'U', 'pg_catalog', 'uuid', false, false, '', ''),
    ('veya_conversation_output_id', 'U', 'pg_catalog', 'uuid', false, false, '', ''),
    ('dispatch_id', 'S', 'pg_catalog', 'text', false, false, '', ''),
    ('phone_hash', 'S', 'pg_catalog', 'text', false, false, '', ''),
    ('provider_conversation_id', 'S', 'pg_catalog', 'text', false, false, '', ''),
    ('state', 'S', 'pg_catalog', 'text', true, false, '', ''),
    ('expires_at', 'D', 'pg_catalog', 'timestamptz', true, false, '', ''),
    ('created_at', 'D', 'pg_catalog', 'timestamptz', true, true, '', ''),
    ('zeya_finalized_at', 'D', 'pg_catalog', 'timestamptz', false, false, '', ''),
    ('call_requested_at', 'D', 'pg_catalog', 'timestamptz', false, false, '', ''),
    ('call_dispatched_at', 'D', 'pg_catalog', 'timestamptz', false, false, '', ''),
    ('call_completed_at', 'D', 'pg_catalog', 'timestamptz', false, false, '', ''),
    ('failed_at', 'D', 'pg_catalog', 'timestamptz', false, false, '', ''),
    ('updated_at', 'D', 'pg_catalog', 'timestamptz', true, true, '', '')
),
actual_columns AS (
  SELECT
    a.attname::text AS column_name,
    t.typcategory::text AS typcategory,
    type_namespace.nspname::text AS type_schema,
    t.typname::text AS typname,
    a.attnotnull AS not_null,
    attribute_default.oid IS NOT NULL AS has_default,
    a.attidentity::text AS identity_state,
    a.attgenerated::text AS generated_state
  FROM target_relation AS target
  JOIN pg_catalog.pg_attribute AS a
    ON a.attrelid = target.relation_oid
  JOIN pg_catalog.pg_type AS t
    ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace AS type_namespace
    ON type_namespace.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = target.relation_oid
   AND attribute_default.adnum = a.attnum
  WHERE a.attnum > 0
    AND NOT a.attisdropped
),
missing_columns AS (
  SELECT * FROM expected_columns
  EXCEPT
  SELECT * FROM actual_columns
),
unexpected_columns AS (
  SELECT * FROM actual_columns
  EXCEPT
  SELECT * FROM expected_columns
),
expected_indexes(
  index_name,
  is_unique,
  is_primary,
  index_columns,
  has_predicate
) AS (
  VALUES
    ('public_experience_sessions_pkey', true, true, ARRAY['id']::text[], false),
    ('public_experience_sessions_token_hash_key', true, false, ARRAY['token_hash']::text[], false),
    ('public_experience_sessions_zeya_voice_context_id_key', true, false, ARRAY['zeya_voice_context_id']::text[], false),
    ('public_experience_sessions_zeya_conversation_output_id_key', true, false, ARRAY['zeya_conversation_output_id']::text[], false),
    ('public_experience_sessions_veya_voice_context_id_key', true, false, ARRAY['veya_voice_context_id']::text[], false),
    ('public_experience_sessions_veya_conversation_output_id_key', true, false, ARRAY['veya_conversation_output_id']::text[], false),
    ('public_experience_sessions_dispatch_id_key', true, false, ARRAY['dispatch_id']::text[], false),
    ('public_experience_sessions_provider_conversation_id_key', true, false, ARRAY['provider_conversation_id']::text[], false),
    ('public_experience_sessions_representation_idx', false, false, ARRAY['business_representation_id']::text[], false),
    ('public_experience_sessions_expiry_idx', false, false, ARRAY['expires_at']::text[], false)
),
actual_indexes AS (
  SELECT
    index_class.relname::text AS index_name,
    index_row.indisunique AS is_unique,
    index_row.indisprimary AS is_primary,
    pg_catalog.array_agg(attribute_row.attname::text ORDER BY index_key.ordinality) AS index_columns,
    index_row.indpred IS NOT NULL AS has_predicate
  FROM target_relation AS target
  JOIN pg_catalog.pg_index AS index_row
    ON index_row.indrelid = target.relation_oid
  JOIN pg_catalog.pg_class AS index_class
    ON index_class.oid = index_row.indexrelid
  CROSS JOIN LATERAL pg_catalog.unnest(index_row.indkey::smallint[])
    WITH ORDINALITY AS index_key(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute_row
    ON attribute_row.attrelid = target.relation_oid
   AND attribute_row.attnum = index_key.attnum
  GROUP BY
    index_row.indexrelid,
    index_class.relname,
    index_row.indisunique,
    index_row.indisprimary,
    index_row.indpred
),
missing_indexes AS (
  SELECT * FROM expected_indexes
  EXCEPT
  SELECT * FROM actual_indexes
),
unexpected_indexes AS (
  SELECT * FROM actual_indexes
  EXCEPT
  SELECT * FROM expected_indexes
),
index_category_summary AS (
  SELECT
    count(*) FILTER (WHERE is_primary)::bigint AS primary_count,
    count(*) FILTER (WHERE is_unique AND NOT is_primary)::bigint AS unique_identity_count,
    count(*) FILTER (WHERE NOT is_unique AND NOT is_primary)::bigint AS explicit_index_count
  FROM actual_indexes
),
expected_fk(
  constraint_name,
  source_columns,
  target_schema,
  target_table,
  target_columns,
  delete_code
) AS (
  VALUES
    ('public_experience_sessions_tenant_user_id_fkey', ARRAY['tenant_user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c'),
    ('public_experience_sessions_zeya_voice_context_id_fkey', ARRAY['zeya_voice_context_id']::text[], 'public', 'voice_representation_lineage', ARRAY['voice_context_id']::text[], 'c'),
    ('public_experience_sessions_zeya_conversation_output_id_fkey', ARRAY['zeya_conversation_output_id']::text[], 'public', 'voice_conversation_outputs', ARRAY['id']::text[], 'c'),
    ('public_experience_sessions_veya_voice_context_id_fkey', ARRAY['veya_voice_context_id']::text[], 'public', 'voice_representation_lineage', ARRAY['voice_context_id']::text[], 'c'),
    ('public_experience_sessions_veya_conversation_output_id_fkey', ARRAY['veya_conversation_output_id']::text[], 'public', 'voice_conversation_outputs', ARRAY['id']::text[], 'c'),
    ('public_experience_business_tenant_fk', ARRAY['business_id', 'tenant_user_id']::text[], 'public', 'businesses', ARRAY['id', 'user_id']::text[], 'a'),
    ('public_experience_business_representation_fk', ARRAY['business_representation_id', 'business_id']::text[], 'public', 'business_representations', ARRAY['id', 'business_id']::text[], 'a'),
    ('public_experience_version_representation_fk', ARRAY['canonical_version_id', 'business_representation_id']::text[], 'public', 'representation_versions', ARRAY['id', 'business_representation_id']::text[], 'a')
),
actual_fk AS (
  SELECT
    constraint_row.conname::text AS constraint_name,
    pg_catalog.array_agg(source_attribute.attname::text ORDER BY source_key.ordinality) AS source_columns,
    target_namespace.nspname::text AS target_schema,
    target_class.relname::text AS target_table,
    pg_catalog.array_agg(target_attribute.attname::text ORDER BY source_key.ordinality) AS target_columns,
    constraint_row.confdeltype::text AS delete_code
  FROM target_relation AS target
  JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conrelid = target.relation_oid
   AND constraint_row.conrelid <> 0
  JOIN pg_catalog.pg_class AS target_class
    ON target_class.oid = constraint_row.confrelid
  JOIN pg_catalog.pg_namespace AS target_namespace
    ON target_namespace.oid = target_class.relnamespace
  CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
    WITH ORDINALITY AS source_key(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS source_attribute
    ON source_attribute.attrelid = target.relation_oid
   AND source_attribute.attnum = source_key.attnum
  JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
    WITH ORDINALITY AS target_key(attnum, ordinality)
    ON target_key.ordinality = source_key.ordinality
  JOIN pg_catalog.pg_attribute AS target_attribute
    ON target_attribute.attrelid = target_class.oid
   AND target_attribute.attnum = target_key.attnum
  WHERE constraint_row.contype = 'f'
  GROUP BY
    constraint_row.oid,
    constraint_row.conname,
    target_namespace.nspname,
    target_class.relname,
    constraint_row.confdeltype
),
missing_fk AS (
  SELECT * FROM expected_fk
  EXCEPT
  SELECT * FROM actual_fk
),
unexpected_fk AS (
  SELECT * FROM actual_fk
  EXCEPT
  SELECT * FROM expected_fk
),
expected_checks(constraint_name, required_fragment) AS (
  VALUES
    ('public_experience_sessions_token_hash_check', '^[0-9a-f]{64}$'),
    ('public_experience_sessions_phone_hash_check', '^[0-9a-f]{64}$'),
    ('public_experience_sessions_state_check', 'reflection_ready'),
    ('public_experience_expiry_after_creation', 'expires_at > created_at')
),
actual_checks AS (
  SELECT
    constraint_row.conname::text AS constraint_name,
    pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true)::text AS expression_text
  FROM target_relation AS target
  JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conrelid = target.relation_oid
   AND constraint_row.conrelid <> 0
  WHERE constraint_row.contype = 'c'
),
missing_checks AS (
  SELECT expected.constraint_name
  FROM expected_checks AS expected
  LEFT JOIN actual_checks AS actual
    ON actual.constraint_name = expected.constraint_name
   AND pg_catalog.strpos(actual.expression_text, expected.required_fragment) > 0
  WHERE actual.constraint_name IS NULL
),
unexpected_checks AS (
  SELECT actual.constraint_name
  FROM actual_checks AS actual
  LEFT JOIN expected_checks AS expected
    ON expected.constraint_name = actual.constraint_name
  WHERE expected.constraint_name IS NULL
),
table_privileges AS (
  SELECT
    count(*)::bigint AS relation_count,
    COALESCE(
      pg_catalog.bool_and(NOT pg_catalog.has_table_privilege('anon', relation_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      false
    ) AS anon_no_access,
    COALESCE(
      pg_catalog.bool_and(NOT pg_catalog.has_table_privilege('authenticated', relation_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      false
    ) AS authenticated_no_access,
    COALESCE(
      pg_catalog.bool_and(pg_catalog.has_table_privilege('service_role', relation_oid, 'SELECT')),
      false
    ) AS service_select,
    COALESCE(
      pg_catalog.bool_and(NOT pg_catalog.has_table_privilege('service_role', relation_oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      false
    ) AS service_no_write,
    COALESCE(
      pg_catalog.bool_and(
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(target.relacl, pg_catalog.acldefault('r', target.owner_oid))
          ) AS acl_row
          WHERE acl_row.grantee = 0
        )
      ),
      false
    ) AS public_no_access
  FROM target_relation AS target
),
expected_functions(signature) AS (
  VALUES
    ('zeya_create_public_experience_session(text,timestamp with time zone,uuid,text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text[],text,text,text)'),
    ('zeya_finalize_public_experience_zeya(text,uuid)'),
    ('zeya_request_public_experience_call(text,text,text)'),
    ('zeya_record_public_experience_dispatch(text,text,uuid,text)'),
    ('zeya_complete_public_experience_call(uuid,uuid)'),
    ('zeya_fail_public_experience_session(text)')
),
actual_functions AS (
  SELECT
    p.oid AS function_oid,
    p.proowner AS owner_oid,
    p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')' AS signature,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_text,
    p.prosecdef AS security_definer,
    p.proconfig::text AS configuration_text,
    p.proacl::text AS acl_text,
    p.proacl IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(p.proacl) AS acl_row
        WHERE acl_row.grantee = 0
          AND acl_row.privilege_type = 'EXECUTE'
      ) AS public_no_execute,
    NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_no_execute,
    NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_no_execute,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'zeya_create_public_experience_session',
      'zeya_finalize_public_experience_zeya',
      'zeya_request_public_experience_call',
      'zeya_record_public_experience_dispatch',
      'zeya_complete_public_experience_call',
      'zeya_fail_public_experience_session'
    )
),
actual_function_signatures AS (
  SELECT signature FROM actual_functions
),
missing_functions AS (
  SELECT * FROM expected_functions
  EXCEPT
  SELECT * FROM actual_function_signatures
),
unexpected_functions AS (
  SELECT * FROM actual_function_signatures
  EXCEPT
  SELECT * FROM expected_functions
),
function_security_summary AS (
  SELECT
    count(*)::bigint AS function_count,
    count(*) FILTER (WHERE owner_text = 'postgres')::bigint AS postgres_owner_count,
    count(*) FILTER (WHERE security_definer)::bigint AS security_definer_count,
    count(*) FILTER (WHERE configuration_text = '{"search_path=\"\""}')::bigint AS fixed_search_path_count,
    count(*) FILTER (WHERE public_no_execute)::bigint AS public_blocked_count,
    count(*) FILTER (WHERE anon_no_execute)::bigint AS anon_blocked_count,
    count(*) FILTER (WHERE authenticated_no_execute)::bigint AS authenticated_blocked_count,
    count(*) FILTER (WHERE service_execute)::bigint AS service_execute_count
  FROM actual_functions
),
trigger_function AS (
  SELECT
    p.oid AS function_oid,
    p.proowner AS owner_oid,
    n.nspname::text AS function_schema,
    p.proname::text AS function_name,
    p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')' AS signature,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_text,
    p.prosecdef AS security_definer,
    p.proconfig::text AS configuration_text,
    p.proacl::text AS acl_text,
    p.proacl IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(p.proacl) AS acl_row
        WHERE acl_row.grantee = 0
          AND acl_row.privilege_type = 'EXECUTE'
      ) AS public_no_execute,
    NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_no_execute,
    NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_no_execute,
    NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_no_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_enforce_public_experience_session_writes'
    AND p.pronargs = 0
),
trigger_function_summary AS (
  SELECT
    count(*)::bigint AS function_count,
    count(*) FILTER (
      WHERE function_schema = 'public'
        AND signature = 'zeya_enforce_public_experience_session_writes()'
        AND owner_text = 'postgres'
        AND NOT security_definer
        AND configuration_text = '{"search_path=\"\""}'
        AND public_no_execute
        AND anon_no_execute
        AND authenticated_no_execute
        AND service_no_execute
    )::bigint AS matching_count
  FROM trigger_function
),
actual_trigger AS (
  SELECT
    trigger_row.tgname::text AS trigger_name,
    trigger_row.tgenabled::text AS enabled_state,
    trigger_row.tgisinternal AS is_internal,
    trigger_row.tgtype::integer AS trigger_type,
    function_namespace.nspname::text AS function_schema,
    function_row.proname::text AS function_name,
    function_row.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(function_row.proargtypes), ', ', ',') || ')' AS function_signature
  FROM target_relation AS target
  JOIN pg_catalog.pg_trigger AS trigger_row
    ON trigger_row.tgrelid = target.relation_oid
  JOIN pg_catalog.pg_proc AS function_row
    ON function_row.oid = trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_row.pronamespace
  WHERE trigger_row.tgname = 'zeya_public_experience_session_writes'
),
trigger_summary AS (
  SELECT
    count(*)::bigint AS trigger_count,
    count(*) FILTER (
      WHERE trigger_name = 'zeya_public_experience_session_writes'
        AND enabled_state = 'O'
        AND NOT is_internal
        AND trigger_type = 31
        AND function_schema = 'public'
        AND function_name = 'zeya_enforce_public_experience_session_writes'
        AND function_signature = 'zeya_enforce_public_experience_session_writes()'
    )::bigint AS matching_count
  FROM actual_trigger
),
checks(check_name, passed, details) AS (
  SELECT
    'table_exists_exactly_once',
    relation_count = 1,
    pg_catalog.jsonb_build_object(
      'actual_count', relation_count
    )
  FROM target_relation_summary

  UNION ALL
  SELECT
    'columns_exact',
    NOT EXISTS (SELECT 1 FROM missing_columns)
      AND NOT EXISTS (SELECT 1 FROM unexpected_columns),
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_columns),
      'actual_count', (SELECT count(*) FROM actual_columns),
      'missing_count', (SELECT count(*) FROM missing_columns),
      'unexpected_count', (SELECT count(*) FROM unexpected_columns)
    )

  UNION ALL
  SELECT
    'indexes_exact',
    NOT EXISTS (SELECT 1 FROM missing_indexes)
      AND NOT EXISTS (SELECT 1 FROM unexpected_indexes),
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_indexes),
      'actual_count', (SELECT count(*) FROM actual_indexes),
      'missing_count', (SELECT count(*) FROM missing_indexes),
      'unexpected_count', (SELECT count(*) FROM unexpected_indexes)
    )

  UNION ALL
  SELECT
    'index_structure_counts',
    primary_count = 1
      AND unique_identity_count = 7
      AND explicit_index_count = 2,
    pg_catalog.jsonb_build_object(
      'primary_count', primary_count,
      'unique_identity_count', unique_identity_count,
      'explicit_index_count', explicit_index_count
    )
  FROM index_category_summary

  UNION ALL
  SELECT
    'foreign_keys_exact',
    NOT EXISTS (SELECT 1 FROM missing_fk)
      AND NOT EXISTS (SELECT 1 FROM unexpected_fk),
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_fk),
      'actual_count', (SELECT count(*) FROM actual_fk),
      'missing_count', (SELECT count(*) FROM missing_fk),
      'unexpected_count', (SELECT count(*) FROM unexpected_fk)
    )

  UNION ALL
  SELECT
    'checks_exact',
    NOT EXISTS (SELECT 1 FROM missing_checks)
      AND NOT EXISTS (SELECT 1 FROM unexpected_checks)
      AND (SELECT count(*) FROM actual_checks) = 4,
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_checks),
      'actual_count', (SELECT count(*) FROM actual_checks),
      'missing_count', (SELECT count(*) FROM missing_checks),
      'unexpected_count', (SELECT count(*) FROM unexpected_checks)
    )

  UNION ALL
  SELECT
    'no_plaintext_columns',
    NOT EXISTS (
      SELECT 1
      FROM actual_columns
      WHERE column_name IN ('token', 'public_token', 'phone', 'phone_number')
    ),
    pg_catalog.jsonb_build_object(
      'plaintext_column_count', (
        SELECT count(*)
        FROM actual_columns
        WHERE column_name IN ('token', 'public_token', 'phone', 'phone_number')
      ),
      'token_hash_present', EXISTS (SELECT 1 FROM actual_columns WHERE column_name = 'token_hash'),
      'phone_hash_present', EXISTS (SELECT 1 FROM actual_columns WHERE column_name = 'phone_hash')
    )

  UNION ALL
  SELECT
    'table_security',
    summary.relation_count = 1
      AND summary.owner_text = 'postgres'
      AND summary.rls_enabled
      AND privileges.public_no_access
      AND privileges.anon_no_access
      AND privileges.authenticated_no_access
      AND privileges.service_select
      AND privileges.service_no_write,
    pg_catalog.jsonb_build_object(
      'relation_count', summary.relation_count,
      'owner', summary.owner_text,
      'rls_enabled', summary.rls_enabled,
      'acl', summary.acl_text,
      'public_no_access', privileges.public_no_access,
      'anon_no_access', privileges.anon_no_access,
      'authenticated_no_access', privileges.authenticated_no_access,
      'service_select', privileges.service_select,
      'service_no_write', privileges.service_no_write
    )
  FROM target_relation_summary AS summary
  CROSS JOIN table_privileges AS privileges

  UNION ALL
  SELECT
    'mutation_functions_exact_and_secure',
    NOT EXISTS (SELECT 1 FROM missing_functions)
      AND NOT EXISTS (SELECT 1 FROM unexpected_functions)
      AND function_count = 6
      AND postgres_owner_count = 6
      AND security_definer_count = 6
      AND fixed_search_path_count = 6
      AND public_blocked_count = 6
      AND anon_blocked_count = 6
      AND authenticated_blocked_count = 6
      AND service_execute_count = 6,
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_functions),
      'actual_count', function_count,
      'missing_count', (SELECT count(*) FROM missing_functions),
      'unexpected_count', (SELECT count(*) FROM unexpected_functions),
      'postgres_owner_count', postgres_owner_count,
      'security_definer_count', security_definer_count,
      'fixed_search_path_count', fixed_search_path_count,
      'public_blocked_count', public_blocked_count,
      'anon_blocked_count', anon_blocked_count,
      'authenticated_blocked_count', authenticated_blocked_count,
      'service_execute_count', service_execute_count
    )
  FROM function_security_summary

  UNION ALL
  SELECT
    'trigger_function_exact',
    function_count = 1
      AND matching_count = 1,
    pg_catalog.jsonb_build_object(
      'expected_count', 1,
      'actual_count', function_count,
      'matching_count', matching_count
    )
  FROM trigger_function_summary

  UNION ALL
  SELECT
    'controlled_trigger_exact',
    trigger_count = 1
      AND matching_count = 1,
    pg_catalog.jsonb_build_object(
      'expected_count', 1,
      'actual_count', trigger_count,
      'matching_count', matching_count
    )
  FROM trigger_summary
)
SELECT
  check_name,
  passed,
  details
FROM checks
ORDER BY check_name;
