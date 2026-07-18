-- Verification: Canonical Version pointer atomicity.
-- Read-only. Every returned row must have passed = true after deployment.

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
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
      ORDER BY CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name ELSE role_row.rolname END
    ) FILTER (WHERE acl.privilege_type = 'EXECUTE'),
    ARRAY[]::name[]
  ) AS execute_grantees
  FROM rpc
  LEFT JOIN LATERAL pg_catalog.aclexplode(rpc.proacl) AS acl ON true
  LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = acl.grantee
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
duplicate_sequences AS (
  SELECT count(*)::bigint AS count
  FROM (
    SELECT business_representation_id, version_number
    FROM public.representation_versions
    GROUP BY business_representation_id, version_number
    HAVING count(*) > 1
  ) AS duplicates
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
    'rpc_security_contract'::text,
    owner_name = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=""']::text[],
    pg_catalog.jsonb_build_object(
      'owner', owner_name,
      'security_definer', prosecdef,
      'configuration', proconfig
    )
  FROM rpc

  UNION ALL
  SELECT
    'rpc_return_contract'::text,
    result_type = 'TABLE(version_id uuid, version_number bigint, created_at timestamp with time zone)',
    pg_catalog.jsonb_build_object('result_type', result_type)
  FROM rpc

  UNION ALL
  SELECT
    'rpc_acl_contract'::text,
    execute_grantees <@ ARRAY['postgres', 'service_role']::name[]
      AND execute_grantees @> ARRAY['postgres', 'service_role']::name[],
    pg_catalog.jsonb_build_object('execute_grantees', execute_grantees)
  FROM rpc_acl

  UNION ALL
  SELECT
    'rpc_atomic_body_contract'::text,
    body ~* 'frompublic\.business_representations.*forupdate'
      AND body ~* 'insertintopublic\.representation_versions'
      AND body ~* 'setcurrent_version_id=v_new_version_id'
      AND body ~* 'row_count'
      AND body ~* 'insertintopublic\.audit_events'
      AND body ~* 'v_rep\.current_version_id',
    pg_catalog.jsonb_build_object(
      'locks_representation', body ~* 'forupdate',
      'inserts_version', body ~* 'insertintopublic\.representation_versions',
      'updates_pointer', body ~* 'setcurrent_version_id=v_new_version_id',
      'extends_current_lineage', body ~* 'v_rep\.current_version_id',
      'writes_audit', body ~* 'insertintopublic\.audit_events'
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

  UNION ALL
  SELECT
    'version_sequence_integrity'::text,
    count = 0,
    pg_catalog.jsonb_build_object('duplicate_group_count', count)
  FROM duplicate_sequences
)
SELECT check_name::text, passed::boolean, details::jsonb
FROM checks
ORDER BY check_name;
