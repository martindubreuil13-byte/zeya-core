-- Read-only verification for generated content_hash correction.
WITH
rpc AS (
  SELECT
    p.oid,
    pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.pg_get_function_result(p.oid)::text AS result_type,
    pg_catalog.regexp_replace(p.prosrc, '[[:space:]]+', '', 'g') AS body
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure(
    'public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)'
  )
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
    attribute_row.attgenerated::text AS generated_state,
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
      '[[:space:]]+',
      '',
      'g'
    ) AS normalized_generation_expression
  FROM pg_catalog.pg_attribute AS attribute_row
  JOIN pg_catalog.pg_class AS table_row ON table_row.oid = attribute_row.attrelid
  JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attrdef AS default_row
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
sequence_integrity AS (
  SELECT count(*)::bigint AS duplicate_group_count
  FROM (
    SELECT business_representation_id, version_number
    FROM public.representation_versions
    GROUP BY business_representation_id, version_number
    HAVING count(*) > 1
  ) AS duplicates
),
checks(check_name, passed, details) AS (
  SELECT
    'rpc_identity_security_acl'::text,
    owner_name = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=""']::text[]
      AND result_type = 'TABLE(version_id uuid, version_number bigint, created_at timestamp with time zone)'
      AND execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
    pg_catalog.jsonb_build_object(
      'owner', owner_name,
      'security_definer', prosecdef,
      'configuration', proconfig,
      'result_type', result_type,
      'execute_grantees', execute_grantees
    )
  FROM rpc CROSS JOIN rpc_acl
  UNION ALL
  SELECT
    'version_insert_exact_without_content_hash'::text,
    body ~* 'insertintopublic\.representation_versionsasinserted_version\(business_representation_id,previous_version_id,source_proposal_id,source_approval_id,element_values,version_number,overall_confidence_score,created_by_actor\)values\('
      AND body !~* 'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash',
    pg_catalog.jsonb_build_object(
      'exact_column_list_without_content_hash',
        body ~* 'insertintopublic\.representation_versionsasinserted_version\(business_representation_id,previous_version_id,source_proposal_id,source_approval_id,element_values,version_number,overall_confidence_score,created_by_actor\)values\(',
      'no_explicit_content_hash_assignment',
        body !~* 'insertintopublic\.representation_versionsasinserted_version\([^)]*content_hash'
    )
  FROM rpc
  UNION ALL
  SELECT
    'generated_hash_contract_preserved'::text,
    generated_state = 's'
      AND normalized_generation_expression =
        'encode(digest((element_values)::text,''sha256''::text),''hex''::text)',
    pg_catalog.jsonb_build_object(
      'attgenerated', generated_state,
      'normalized_generation_expression', normalized_generation_expression
    )
  FROM content_hash_catalog
  UNION ALL
  SELECT
    'atomic_invariants_and_qualified_references'::text,
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
      'atomic_pointer', body ~* 'setcurrent_version_id=v_new_version_id',
      'audit_insert', body ~* 'insertintopublic\.audit_events'
    )
  FROM rpc
  UNION ALL
  SELECT
    'pointer_integrity'::text,
    dangling_count = 0 AND cross_representation_count = 0,
    pg_catalog.jsonb_build_object(
      'dangling_count', dangling_count,
      'cross_representation_count', cross_representation_count
    )
  FROM pointer_integrity
  UNION ALL
  SELECT
    'sequence_integrity'::text,
    duplicate_group_count = 0,
    pg_catalog.jsonb_build_object('duplicate_group_count', duplicate_group_count)
  FROM sequence_integrity
)
SELECT check_name::text, passed::boolean, details::jsonb
FROM checks
ORDER BY check_name;
