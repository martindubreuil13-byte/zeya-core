-- Read-only preflight for generated content_hash correction.
-- Every row must pass before manual deployment.
WITH
rpc AS (
  SELECT
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.regexp_replace(p.prosrc, '[[:space:]]+', '', 'g') AS body
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure(
    'public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)'
  )
),
rpc_overloads AS (
  SELECT count(*)::bigint AS count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_create_canonical_version_atomic'
),
rpc_acl AS (
  SELECT COALESCE(
    pg_catalog.array_agg(
      CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
      ORDER BY CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
    ) FILTER (WHERE grant_row.privilege_type = 'EXECUTE'),
    ARRAY[]::name[]
  ) AS execute_grantees
  FROM rpc
  LEFT JOIN LATERAL pg_catalog.aclexplode(rpc.proacl) AS grant_row ON true
  LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = grant_row.grantee
),
content_hash_catalog AS (
  SELECT
    type_namespace.nspname::text AS type_schema,
    type_row.typname::text AS type_name,
    attribute_row.attnotnull AS not_null,
    attribute_row.attgenerated::text AS generated_state,
    default_row.oid IS NOT NULL AS has_attribute_expression,
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
      '[[:space:]]+',
      '',
      'g'
    ) AS normalized_generation_expression
  FROM pg_catalog.pg_attribute AS attribute_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid = attribute_row.attrelid
  JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_row.relnamespace
  JOIN pg_catalog.pg_type AS type_row ON type_row.oid = attribute_row.atttypid
  JOIN pg_catalog.pg_namespace AS type_namespace ON type_namespace.oid = type_row.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS default_row
    ON default_row.adrelid = attribute_row.attrelid
   AND default_row.adnum = attribute_row.attnum
  WHERE table_namespace.nspname = 'public'
    AND table_row.relname = 'representation_versions'
    AND attribute_row.attname = 'content_hash'
    AND NOT attribute_row.attisdropped
),
pointer_integrity AS (
  SELECT
    count(*) FILTER (WHERE br.current_version_id IS NOT NULL AND rv.id IS NULL)::bigint
      AS dangling_count,
    count(*) FILTER (
      WHERE rv.id IS NOT NULL
        AND rv.business_representation_id IS DISTINCT FROM br.id
    )::bigint AS cross_representation_count
  FROM public.business_representations AS br
  LEFT JOIN public.representation_versions AS rv ON rv.id = br.current_version_id
),
checks(check_name, passed, details) AS (
  SELECT
    'rpc_exact_identity'::text,
    (SELECT count(*) FROM rpc) = 1 AND rpc_overloads.count = 1,
    pg_catalog.jsonb_build_object(
      'exact_signature_count', (SELECT count(*) FROM rpc),
      'named_overload_count', rpc_overloads.count
    )
  FROM rpc_overloads
  UNION ALL
  SELECT
    'rpc_security_and_acl'::text,
    owner_name = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=""']::text[]
      AND execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
    pg_catalog.jsonb_build_object(
      'owner', owner_name,
      'security_definer', prosecdef,
      'configuration', proconfig,
      'execute_grantees', execute_grantees
    )
  FROM rpc CROSS JOIN rpc_acl
  UNION ALL
  SELECT
    'deployed_rpc_explicitly_inserts_generated_hash'::text,
    body ~* 'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash[^)]*\)values',
    pg_catalog.jsonb_build_object(
      'content_hash_in_version_insert',
        body ~* 'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash[^)]*\)values'
    )
  FROM rpc
  UNION ALL
  SELECT
    'content_hash_generated_column_exact'::text,
    type_schema = 'pg_catalog'
      AND type_name = 'text'
      AND NOT not_null
      AND generated_state = 's'
      AND has_attribute_expression
      AND normalized_generation_expression =
        'encode(digest((element_values)::text,''sha256''::text),''hex''::text)',
    pg_catalog.jsonb_build_object(
      'type_schema', type_schema,
      'type_name', type_name,
      'not_null', not_null,
      'attgenerated', generated_state,
      'is_stored_generated', generated_state = 's',
      'is_ordinary_default', generated_state = '',
      'has_attribute_expression', has_attribute_expression,
      'normalized_generation_expression', normalized_generation_expression,
      'expected_generation_expression',
        'encode(digest((element_values)::text,''sha256''::text),''hex''::text)'
    )
  FROM content_hash_catalog
  UNION ALL
  SELECT
    'atomic_invariants_present'::text,
    body ~* 'forupdate'
      AND body ~* 'max\(version_row\.version_number\)'
      AND body ~* 'v_rep\.current_version_id'
      AND body ~* 'returninginserted_version\.id,inserted_version\.created_at'
      AND body ~* 'setcurrent_version_id=v_new_version_id'
      AND body ~* 'row_count'
      AND body ~* 'insertintopublic\.audit_events',
    pg_catalog.jsonb_build_object(
      'row_lock', body ~* 'forupdate',
      'qualified_sequence', body ~* 'max\(version_row\.version_number\)',
      'append_only_lineage', body ~* 'v_rep\.current_version_id',
      'qualified_returning', body ~* 'returninginserted_version\.id,inserted_version\.created_at',
      'pointer_update', body ~* 'setcurrent_version_id=v_new_version_id',
      'affected_row_check', body ~* 'row_count',
      'audit_insert', body ~* 'insertintopublic\.audit_events'
    )
  FROM rpc
  UNION ALL
  SELECT
    'current_pointer_integrity'::text,
    dangling_count = 0 AND cross_representation_count = 0,
    pg_catalog.jsonb_build_object(
      'dangling_count', dangling_count,
      'cross_representation_count', cross_representation_count
    )
  FROM pointer_integrity
)
SELECT check_name::text, passed::boolean, details::jsonb
FROM checks
ORDER BY check_name;
