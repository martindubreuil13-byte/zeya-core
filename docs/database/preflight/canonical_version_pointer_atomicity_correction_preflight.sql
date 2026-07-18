-- Read-only preflight for the canonical Version atomicity runtime correction.
WITH target AS (
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
overloads AS (
  SELECT count(*)::bigint AS count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_create_canonical_version_atomic'
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
checks(check_name, passed, details) AS (
  SELECT
    'deployed_defect_reproduced'::text,
    body ~* 'max\(version_number\)'
      AND body !~* 'max\(version_row\.version_number\)',
    pg_catalog.jsonb_build_object(
      'unqualified_version_number', body ~* 'max\(version_number\)',
      'qualified_version_number_absent', body !~* 'max\(version_row\.version_number\)'
    )
  FROM target
  UNION ALL
  SELECT
    'rpc_identity_and_security'::text,
    (SELECT count(*) FROM target) = 1
      AND overloads.count = 1
      AND target.owner_name = 'postgres'
      AND target.prosecdef
      AND target.proconfig = ARRAY['search_path=""']::text[],
    pg_catalog.jsonb_build_object(
      'exact_signature_count', (SELECT count(*) FROM target),
      'overload_count', overloads.count,
      'owner', target.owner_name,
      'security_definer', target.prosecdef,
      'configuration', target.proconfig
    )
  FROM target CROSS JOIN overloads
  UNION ALL
  SELECT
    'rpc_acl_preserved'::text,
    execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
    pg_catalog.jsonb_build_object('execute_grantees', execute_grantees)
  FROM acl
  UNION ALL
  SELECT
    'atomic_invariants_present'::text,
    body ~* 'forupdate'
      AND body ~* 'v_rep\.current_version_id'
      AND body ~* 'insertintopublic\.representation_versions'
      AND body ~* 'setcurrent_version_id=v_new_version_id'
      AND body ~* 'insertintopublic\.audit_events',
    pg_catalog.jsonb_build_object(
      'row_lock', body ~* 'forupdate',
      'append_only_lineage', body ~* 'v_rep\.current_version_id',
      'version_insert', body ~* 'insertintopublic\.representation_versions',
      'pointer_update', body ~* 'setcurrent_version_id=v_new_version_id',
      'audit_insert', body ~* 'insertintopublic\.audit_events'
    )
  FROM target
)
SELECT check_name::text, passed::boolean, details::jsonb
FROM checks
ORDER BY check_name;
