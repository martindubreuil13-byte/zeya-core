-- P2.1 manual preflight. Read-only. Run before applying
-- 20260813000000_direct_hire_first_working_sessions.sql.

WITH acceptance AS (
  SELECT
    p.oid,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    pg_get_functiondef(p.oid) AS definition,
    p.prosecdef,
    p.proacl,
    p.proowner
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_accept_direct_hire_employment'
), acceptance_acl AS (
  SELECT
    bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute,
    bool_or(role.rolname = 'anon' AND acl.privilege_type = 'EXECUTE') AS anon_execute,
    bool_or(role.rolname = 'authenticated' AND acl.privilege_type = 'EXECUTE') AS authenticated_execute,
    bool_or(role.rolname = 'service_role' AND acl.privilege_type = 'EXECUTE') AS service_role_execute
  FROM acceptance AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
), page_count_checks AS (
  SELECT
    count(*) = 2
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true) LIKE '%preparation_successful_page_count%'
        AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
        AND pg_get_constraintdef(oid, true) LIKE '%<= 10%'
    ) = 1
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true) LIKE '%preparation_failed_page_count%'
        AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
        AND pg_get_constraintdef(oid, true) LIKE '%<= 10%'
    ) = 1 AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.direct_hire_onboarding_sessions'::regclass
    AND contype = 'c'
    AND (
      pg_get_constraintdef(oid, true) LIKE '%preparation_successful_page_count%'
      OR pg_get_constraintdef(oid, true) LIKE '%preparation_failed_page_count%'
    )
), checks AS (
  SELECT 'PREFLIGHT-01 migration_not_already_applied' AS check_name,
    to_regclass('public.direct_hire_working_sessions') IS NULL AS pass,
    coalesce(to_regclass('public.direct_hire_working_sessions')::text, 'absent') AS actual,
    'absent' AS expected
  UNION ALL
  SELECT 'PREFLIGHT-02 acceptance_signature', count(*) = 1
    AND min(identity_arguments) = '',
    coalesce(string_agg(identity_arguments, ', '), 'missing'), 'no arguments'
  FROM acceptance
  UNION ALL
  SELECT 'PREFLIGHT-03 acceptance_return_contract', count(*) = 1
    AND min(result_type) = 'TABLE(onboarding_session_id uuid, onboarding_state text, preparation_status text)',
    coalesce(string_agg(result_type, ', '), 'missing'),
    'TABLE(onboarding_session_id uuid, onboarding_state text, preparation_status text)'
  FROM acceptance
  UNION ALL
  SELECT 'PREFLIGHT-04 predecessor_preparation_gate', count(*) = 1
    AND bool_and(definition LIKE '%preparation_status NOT IN (''ready'', ''partial'')%'),
    coalesce(string_agg((definition LIKE '%preparation_status NOT IN (''ready'', ''partial'')%')::text, ', '), 'missing'),
    'true'
  FROM acceptance
  UNION ALL
  SELECT 'PREFLIGHT-05 predecessor_security_and_states', count(*) = 1
    AND bool_and(prosecdef)
    AND bool_and(definition LIKE '%auth.uid()%')
    AND bool_and(definition LIKE '%auth.role() <> ''authenticated''%')
    AND bool_and(definition LIKE '%FOR UPDATE%')
    AND bool_and(definition LIKE '%onboarding_state = ''employment_accepted''%')
    AND bool_and(definition LIKE '%onboarding_state <> ''preparation''%'),
    coalesce(string_agg('security_definer=' || prosecdef::text, ', '), 'missing'),
    'one SECURITY DEFINER function with auth, lock, replay, and legal-source-state markers'
  FROM acceptance
  UNION ALL
  SELECT 'PREFLIGHT-06 predecessor_acl',
    NOT public_execute AND NOT anon_execute AND authenticated_execute AND NOT service_role_execute,
    format('public=%s anon=%s authenticated=%s service_role=%s', public_execute, anon_execute, authenticated_execute, service_role_execute),
    'public=false anon=false authenticated=true service_role=false'
  FROM acceptance_acl
  UNION ALL
  SELECT 'PREFLIGHT-07 P1_page_count_schema', ok, ok::text, 'true' FROM page_count_checks
  UNION ALL
  SELECT 'PREFLIGHT-08 induction_schema',
    count(*) = 2,
    count(*)::text,
    '2 columns: induction_state and induction_materials_count'
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'direct_hire_onboarding_sessions'
    AND column_name IN ('induction_state', 'induction_materials_count')
  UNION ALL
  SELECT 'PREFLIGHT-09 employment_state_schema', count(*) = 1
    AND bool_and(pg_get_constraintdef(oid, true) LIKE '%employment_accepted%')
    AND bool_and(pg_get_constraintdef(oid, true) LIKE '%preparation%'),
    coalesce(string_agg(pg_get_constraintdef(oid, true), E'\n'), 'missing'),
    'one onboarding_state CHECK permitting preparation and employment_accepted'
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.direct_hire_onboarding_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid, true) LIKE '%onboarding_state%'
  UNION ALL
  SELECT 'PREFLIGHT-10 registered_sources_available',
    to_regclass('public.direct_hire_public_sources') IS NOT NULL,
    coalesce(to_regclass('public.direct_hire_public_sources')::text, 'missing'),
    'public.direct_hire_public_sources'
  UNION ALL
  SELECT 'PREFLIGHT-11 formation_table_available',
    to_regclass('public.representation_formation_sessions') IS NOT NULL,
    coalesce(to_regclass('public.representation_formation_sessions')::text, 'missing'),
    'public.representation_formation_sessions'
)
SELECT check_name, pass, actual, expected,
  CASE WHEN pass THEN 'PASS' ELSE 'FAIL - STOP BEFORE MIGRATION' END AS verdict
FROM checks
ORDER BY check_name;

-- Reviewable predecessor definition; output only, no mutation.
SELECT pg_get_functiondef('public.zeya_accept_direct_hire_employment()'::regprocedure)
  AS predecessor_acceptance_definition;
