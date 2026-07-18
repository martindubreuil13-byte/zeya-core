-- Read-only verification for the canonical Version atomicity runtime correction.
WITH target AS (
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
acl AS (
  SELECT COALESCE(
    pg_catalog.array_agg(
      CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
      ORDER BY CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
    ) FILTER (WHERE grant_row.privilege_type = 'EXECUTE'),
    ARRAY[]::name[]
  ) AS execute_grantees
  FROM target
  LEFT JOIN LATERAL pg_catalog.aclexplode(target.proacl) AS grant_row ON true
  LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = grant_row.grantee
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
    'ambiguities_removed'::text,
    body ~* 'max\(version_row\.version_number\)'
      AND body ~* 'returninginserted_version\.id,inserted_version\.created_at'
      AND body !~* 'max\(version_number\)',
    pg_catalog.jsonb_build_object(
      'qualified_sequence_column', body ~* 'max\(version_row\.version_number\)',
      'qualified_returning_columns', body ~* 'returninginserted_version\.id,inserted_version\.created_at',
      'unqualified_sequence_column_absent', body !~* 'max\(version_number\)'
    )
  FROM target
  UNION ALL
  SELECT
    'identity_security_and_return_contract'::text,
    owner_name = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=""']::text[]
      AND result_type = 'TABLE(version_id uuid, version_number bigint, created_at timestamp with time zone)',
    pg_catalog.jsonb_build_object(
      'owner', owner_name,
      'security_definer', prosecdef,
      'configuration', proconfig,
      'result_type', result_type
    )
  FROM target
  UNION ALL
  SELECT
    'acl_contract'::text,
    execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
    pg_catalog.jsonb_build_object('execute_grantees', execute_grantees)
  FROM acl
  UNION ALL
  SELECT
    'atomic_body_contract'::text,
    body ~* 'forupdate'
      AND body ~* 'v_rep\.current_version_id'
      AND body ~* 'setcurrent_version_id=v_new_version_id'
      AND body ~* 'row_count'
      AND body ~* 'insertintopublic\.audit_events',
    pg_catalog.jsonb_build_object(
      'row_lock', body ~* 'forupdate',
      'append_only_lineage', body ~* 'v_rep\.current_version_id',
      'pointer_update', body ~* 'setcurrent_version_id=v_new_version_id',
      'affected_row_check', body ~* 'row_count',
      'audit_insert', body ~* 'insertintopublic\.audit_events'
    )
  FROM target
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
