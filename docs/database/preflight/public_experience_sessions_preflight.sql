-- Phase 4A read-only preflight. Every returned row must have passed = true.
-- All diagnostic catalog identities are converted to plain text before JSON.
WITH
expected_columns(
  table_name,
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
    ('businesses', 'id', 'U', 'pg_catalog', 'uuid', true, true, '', ''),
    ('businesses', 'user_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('business_representations', 'id', 'U', 'pg_catalog', 'uuid', true, true, '', ''),
    ('business_representations', 'business_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('business_representations', 'current_version_id', 'U', 'pg_catalog', 'uuid', false, false, '', ''),
    ('representation_versions', 'id', 'U', 'pg_catalog', 'uuid', true, true, '', ''),
    ('representation_versions', 'business_representation_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_representation_lineage', 'voice_context_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_representation_lineage', 'business_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_representation_lineage', 'business_representation_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_representation_lineage', 'canonical_version_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_conversation_outputs', 'id', 'U', 'pg_catalog', 'uuid', true, true, '', ''),
    ('voice_conversation_outputs', 'voice_context_id', 'U', 'pg_catalog', 'uuid', true, false, '', ''),
    ('voice_conversation_outputs', 'transcript_trust_level', 'S', 'pg_catalog', 'text', true, false, '', ''),
    ('voice_conversation_outputs', 'provider_attested', 'B', 'pg_catalog', 'bool', true, false, '', ''),
    ('voice_conversation_outputs', 'transcript_status', 'S', 'pg_catalog', 'text', true, false, '', '')
),
actual_columns AS (
  SELECT
    c.relname::text AS table_name,
    a.attname::text AS column_name,
    t.typcategory::text AS typcategory,
    tn.nspname::text AS type_schema,
    t.typname::text AS typname,
    a.attnotnull AS not_null,
    d.oid IS NOT NULL AS has_default,
    a.attidentity::text AS identity_state,
    a.attgenerated::text AS generated_state
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname IN (SELECT DISTINCT table_name FROM expected_columns)
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN (
      SELECT e.column_name
      FROM expected_columns AS e
      WHERE e.table_name = c.relname
    )
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
expected_unique(table_name, index_columns) AS (
  VALUES
    ('businesses', ARRAY['id', 'user_id']::text[]),
    ('business_representations', ARRAY['id', 'business_id']::text[]),
    ('representation_versions', ARRAY['id', 'business_representation_id']::text[])
),
actual_unique AS (
  SELECT
    c.relname::text AS table_name,
    pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality) AS index_columns
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS c ON c.oid = i.indrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.unnest(i.indkey::smallint[])
    WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS a
    ON a.attrelid = c.oid
   AND a.attnum = k.attnum
  WHERE n.nspname = 'public'
    AND i.indisunique
    AND i.indpred IS NULL
    AND c.relname IN (SELECT table_name FROM expected_unique)
  GROUP BY i.indexrelid, c.relname
),
missing_unique AS (
  SELECT * FROM expected_unique
  EXCEPT
  SELECT * FROM actual_unique
),
expected_fk(
  source_table,
  source_columns,
  target_schema,
  target_table,
  target_columns,
  delete_code
) AS (
  VALUES
    ('voice_conversation_outputs', ARRAY['submitted_by']::text[], 'auth', 'users', ARRAY['id']::text[], 'r'),
    ('voice_conversation_outputs', ARRAY['voice_context_id']::text[], 'public', 'voice_representation_lineage', ARRAY['voice_context_id']::text[], 'r'),
    ('voice_conversation_outputs', ARRAY['voice_context_id', 'tenant_user_id', 'business_id', 'business_representation_id', 'canonical_version_id']::text[], 'public', 'voice_representation_lineage', ARRAY['voice_context_id', 'tenant_user_id', 'business_id', 'business_representation_id', 'canonical_version_id']::text[], 'r'),
    ('voice_representation_lineage', ARRAY['business_id', 'tenant_user_id']::text[], 'public', 'businesses', ARRAY['id', 'user_id']::text[], 'a'),
    ('voice_representation_lineage', ARRAY['business_representation_id', 'business_id']::text[], 'public', 'business_representations', ARRAY['id', 'business_id']::text[], 'a'),
    ('voice_representation_lineage', ARRAY['canonical_version_id', 'business_representation_id']::text[], 'public', 'representation_versions', ARRAY['id', 'business_representation_id']::text[], 'a'),
    ('voice_representation_lineage', ARRAY['business_id']::text[], 'public', 'businesses', ARRAY['id']::text[], 'c'),
    ('voice_representation_lineage', ARRAY['business_representation_id']::text[], 'public', 'business_representations', ARRAY['id']::text[], 'r'),
    ('voice_representation_lineage', ARRAY['canonical_version_id']::text[], 'public', 'representation_versions', ARRAY['id']::text[], 'r'),
    ('voice_representation_lineage', ARRAY['tenant_user_id']::text[], 'auth', 'users', ARRAY['id']::text[], 'c')
),
actual_fk AS (
  SELECT
    source_class.relname::text AS source_table,
    pg_catalog.array_agg(source_attribute.attname::text ORDER BY source_key.ordinality) AS source_columns,
    target_namespace.nspname::text AS target_schema,
    target_class.relname::text AS target_table,
    pg_catalog.array_agg(target_attribute.attname::text ORDER BY source_key.ordinality) AS target_columns,
    constraint_row.confdeltype::text AS delete_code
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS source_class ON source_class.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS source_namespace ON source_namespace.oid = source_class.relnamespace
  JOIN pg_catalog.pg_class AS target_class ON target_class.oid = constraint_row.confrelid
  JOIN pg_catalog.pg_namespace AS target_namespace ON target_namespace.oid = target_class.relnamespace
  CROSS JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
    WITH ORDINALITY AS source_key(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS source_attribute
    ON source_attribute.attrelid = source_class.oid
   AND source_attribute.attnum = source_key.attnum
  JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
    WITH ORDINALITY AS target_key(attnum, ordinality)
    ON target_key.ordinality = source_key.ordinality
  JOIN pg_catalog.pg_attribute AS target_attribute
    ON target_attribute.attrelid = target_class.oid
   AND target_attribute.attnum = target_key.attnum
  WHERE source_namespace.nspname = 'public'
    AND constraint_row.contype = 'f'
    AND source_class.relname IN ('voice_representation_lineage', 'voice_conversation_outputs')
  GROUP BY
    constraint_row.oid,
    source_class.relname,
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
expected_functions(signature) AS (
  VALUES
    ('zeya_create_voice_representation_lineage(uuid,text,text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text[],boolean,text,text,text,text,text)'),
    ('zeya_capture_voice_conversation_output(uuid,text,text,text,text,text,text,boolean,uuid,timestamp with time zone,timestamp with time zone,jsonb,text,text,text,text,text,jsonb)'),
    ('zeya_finalize_voice_conversation_transcript(uuid,jsonb,timestamp with time zone,text,text)'),
    ('zeya_store_voice_conversation_candidates(uuid,text,jsonb)')
),
actual_functions AS (
  SELECT
    p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')' AS signature
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'zeya_create_voice_representation_lineage',
      'zeya_capture_voice_conversation_output',
      'zeya_finalize_voice_conversation_transcript',
      'zeya_store_voice_conversation_candidates'
    )
),
missing_functions AS (
  SELECT * FROM expected_functions
  EXCEPT
  SELECT * FROM actual_functions
),
unexpected_functions AS (
  SELECT * FROM actual_functions
  EXCEPT
  SELECT * FROM expected_functions
),
crypto_function AS (
  SELECT
    count(*)::bigint AS match_count,
    pg_catalog.min(n.nspname::text || '.' || p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')') AS signature_text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'pg_catalog'
    AND p.proname = 'gen_random_uuid'
    AND p.pronargs = 0
),
collisions AS (
  SELECT 'relation:' || c.relname::text AS object_identity
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'public_experience_sessions',
      'public_experience_sessions_representation_idx',
      'public_experience_sessions_expiry_idx'
    )
  UNION ALL
  SELECT
    'function:' || n.nspname::text || '.' || p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')'
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'zeya_enforce_public_experience_session_writes',
      'zeya_create_public_experience_session',
      'zeya_finalize_public_experience_zeya',
      'zeya_request_public_experience_call',
      'zeya_record_public_experience_dispatch',
      'zeya_complete_public_experience_call',
      'zeya_fail_public_experience_session'
    )
  UNION ALL
  SELECT 'trigger:' || trigger_row.tgname::text
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS relation_namespace ON relation_namespace.oid = relation_row.relnamespace
  WHERE relation_namespace.nspname = 'public'
    AND trigger_row.tgname = 'zeya_public_experience_session_writes'
),
collision_summary AS (
  SELECT
    count(*)::bigint AS collision_count,
    pg_catalog.string_agg(object_identity, ', ' ORDER BY object_identity) AS collision_identities
  FROM collisions
),
purge AS (
  SELECT
    p.oid AS function_oid,
    n.nspname::text || '.' || p.proname::text || '(' || pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',') || ')' AS signature_text,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_text,
    p.prosecdef AS security_definer,
    p.proconfig::text AS configuration_text,
    p.proacl::text AS acl_text,
    pg_catalog.pg_get_functiondef(p.oid) AS definition_text
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_purge_business_representation'
    AND pg_catalog.oidvectortypes(p.proargtypes) = 'uuid, uuid'
),
purge_summary AS (
  SELECT
    count(*)::bigint AS function_count,
    pg_catalog.max(signature_text) AS signature_text,
    pg_catalog.max(owner_text) AS owner_text,
    pg_catalog.bool_and(security_definer) AS security_definer,
    pg_catalog.max(configuration_text) AS configuration_text,
    pg_catalog.max(acl_text) AS acl_text,
    pg_catalog.max(pg_catalog.md5(definition_text)) AS definition_md5,
    pg_catalog.max(pg_catalog.strpos(definition_text, 'DELETE FROM public.voice_conversation_candidates')) AS candidate_position,
    pg_catalog.max(pg_catalog.strpos(definition_text, 'DELETE FROM public.voice_conversation_outputs')) AS output_position,
    pg_catalog.max(pg_catalog.strpos(definition_text, 'DELETE FROM public.voice_representation_lineage')) AS lineage_position,
    pg_catalog.max(pg_catalog.strpos(definition_text, 'DELETE FROM public.representation_versions')) AS version_position,
    pg_catalog.max(pg_catalog.strpos(definition_text, 'DELETE FROM public.business_representations')) AS representation_position
  FROM purge
),
purge_privileges AS (
  SELECT
    count(*)::bigint AS function_count,
    COALESCE(
      pg_catalog.bool_or(pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')),
      false
    ) AS anon_execute,
    COALESCE(
      pg_catalog.bool_or(pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')),
      false
    ) AS authenticated_execute,
    COALESCE(
      pg_catalog.bool_or(pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')),
      false
    ) AS service_role_execute
  FROM purge
),
checks(check_name, passed, details) AS (
  SELECT
    'migration_not_applied',
    pg_catalog.to_regclass('public.public_experience_sessions') IS NULL,
    pg_catalog.jsonb_build_object(
      'relation', pg_catalog.to_regclass('public.public_experience_sessions')::text
    )

  UNION ALL
  SELECT
    'dependency_columns_exact',
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
    'dependency_unique_identities_exact',
    NOT EXISTS (SELECT 1 FROM missing_unique),
    pg_catalog.jsonb_build_object(
      'required_count', (SELECT count(*) FROM expected_unique),
      'actual_unique_count', (SELECT count(*) FROM actual_unique),
      'missing_count', (SELECT count(*) FROM missing_unique)
    )

  UNION ALL
  SELECT
    'dependency_foreign_keys_exact',
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
    'dependency_function_signatures_exact',
    NOT EXISTS (SELECT 1 FROM missing_functions)
      AND NOT EXISTS (SELECT 1 FROM unexpected_functions),
    pg_catalog.jsonb_build_object(
      'expected_count', (SELECT count(*) FROM expected_functions),
      'actual_count', (SELECT count(*) FROM actual_functions),
      'missing_count', (SELECT count(*) FROM missing_functions),
      'unexpected_count', (SELECT count(*) FROM unexpected_functions)
    )

  UNION ALL
  SELECT
    'cryptographic_function',
    match_count = 1,
    pg_catalog.jsonb_build_object(
      'match_count', match_count,
      'function', signature_text
    )
  FROM crypto_function

  UNION ALL
  SELECT
    'object_collisions',
    collision_count = 0,
    pg_catalog.jsonb_build_object(
      'collision_count', collision_count,
      'collision_identities', collision_identities
    )
  FROM collision_summary

  UNION ALL
  SELECT
    'purge_metadata_and_order',
    function_count = 1
      AND owner_text = 'postgres'
      AND security_definer
      AND configuration_text = '{"search_path=public, auth, pg_temp"}'
      AND candidate_position > 0
      AND output_position > candidate_position
      AND lineage_position > output_position
      AND version_position > lineage_position
      AND representation_position > version_position,
    pg_catalog.jsonb_build_object(
      'function_count', function_count,
      'signature', signature_text,
      'owner', owner_text,
      'security_definer', security_definer,
      'configuration', configuration_text,
      'acl', acl_text,
      'definition_md5', definition_md5,
      'candidate_position', candidate_position,
      'output_position', output_position,
      'lineage_position', lineage_position,
      'version_position', version_position,
      'representation_position', representation_position
    )
  FROM purge_summary

  UNION ALL
  SELECT
    'purge_md5_pinned',
    function_count = 1
      AND definition_md5 = '8fb71232dd96059d13bc8000586bebee',
    pg_catalog.jsonb_build_object(
      'expected', '8fb71232dd96059d13bc8000586bebee',
      'actual', definition_md5
    )
  FROM purge_summary

  UNION ALL
  SELECT
    'purge_acl',
    function_count = 1
      AND NOT anon_execute
      AND NOT authenticated_execute
      AND service_role_execute,
    pg_catalog.jsonb_build_object(
      'function_count', function_count,
      'anon_execute', anon_execute,
      'authenticated_execute', authenticated_execute,
      'service_role_execute', service_role_execute
    )
  FROM purge_privileges
)
SELECT
  check_name,
  passed,
  details
FROM checks
ORDER BY check_name;
