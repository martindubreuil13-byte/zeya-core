-- P2.1 manual postcheck. Read-only. Run after manually applying
-- 20260813000000_direct_hire_first_working_sessions.sql.

WITH expected_columns(name, data_type, nullable) AS (
  VALUES
    ('id', 'uuid', false),
    ('owner_id', 'uuid', false),
    ('business_id', 'uuid', false),
    ('business_representation_id', 'uuid', false),
    ('direct_hire_onboarding_session_id', 'uuid', false),
    ('formation_session_id', 'uuid', true),
    ('session_kind', 'text', false),
    ('scheduled_at', 'timestamp with time zone', false),
    ('scheduling_timezone', 'text', false),
    ('status', 'text', false),
    ('created_at', 'timestamp with time zone', false),
    ('updated_at', 'timestamp with time zone', false)
), column_check AS (
  SELECT count(*) = 12
    AND count(*) FILTER (
      WHERE actual.column_name IS NOT NULL
        AND actual.data_type = expected.data_type
        AND (actual.is_nullable = 'YES') = expected.nullable
    ) = 12 AS ok,
    count(actual.column_name) AS matched
  FROM expected_columns AS expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'direct_hire_working_sessions'
   AND actual.column_name = expected.name
), function_inventory AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result_type, pg_get_functiondef(p.oid) AS definition,
    p.prosecdef, p.proacl, p.proowner
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'zeya_accept_direct_hire_employment',
      'zeya_schedule_direct_hire_working_session',
      'zeya_cancel_direct_hire_working_session',
      'zeya_validate_direct_hire_working_session_lineage'
    )
), function_acl AS (
  SELECT function.proname,
    bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public_execute,
    bool_or(role.rolname = 'anon' AND acl.privilege_type = 'EXECUTE') AS anon_execute,
    bool_or(role.rolname = 'authenticated' AND acl.privilege_type = 'EXECUTE') AS authenticated_execute,
    bool_or(role.rolname = 'service_role' AND acl.privilege_type = 'EXECUTE') AS service_role_execute
  FROM function_inventory AS function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(function.proacl, pg_catalog.acldefault('f', function.proowner))
  ) AS acl
  LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
  GROUP BY function.proname
), table_acl AS (
  SELECT
    bool_or(acl.grantee = 0 AND acl.privilege_type <> '') AS public_any,
    bool_or(role.rolname = 'anon' AND acl.privilege_type <> '') AS anon_any,
    bool_or(role.rolname = 'authenticated' AND acl.privilege_type = 'SELECT') AS authenticated_select,
    bool_or(role.rolname = 'authenticated' AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) AS authenticated_mutate,
    bool_or(role.rolname = 'service_role' AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AS service_role_access
  FROM pg_catalog.pg_class AS class
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(class.relacl, pg_catalog.acldefault('r', class.relowner))
  ) AS acl
  LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
  WHERE class.oid = 'public.direct_hire_working_sessions'::regclass
), checks AS (
  SELECT 'POSTCHECK-01 table_columns' AS check_name, ok AS pass,
    matched::text AS actual, '12 exact expected columns' AS expected FROM column_check
  UNION ALL
  SELECT 'POSTCHECK-02 minimal_column_inventory', count(*) = 12,
    string_agg(column_name, ', ' ORDER BY ordinal_position),
    'id, owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id, formation_session_id, session_kind, scheduled_at, scheduling_timezone, status, created_at, updated_at'
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'direct_hire_working_sessions'
  UNION ALL
  SELECT 'POSTCHECK-03 constraints',
    count(*) = 9
    AND count(*) FILTER (WHERE contype = 'p') = 1
    AND count(*) FILTER (WHERE contype = 'f') = 5
    AND count(*) FILTER (WHERE contype = 'c') = 3,
    format('total=%s pk=%s fk=%s check=%s', count(*), count(*) FILTER (WHERE contype='p'), count(*) FILTER (WHERE contype='f'), count(*) FILTER (WHERE contype='c')),
    'total=9 pk=1 fk=5 check=3'
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.direct_hire_working_sessions'::regclass
  UNION ALL
  SELECT 'POSTCHECK-03b lineage_delete_actions',
    count(*) FILTER (WHERE referenced.relname IN ('direct_hire_onboarding_sessions','businesses','business_representations') AND fk_constraint.confdeltype = 'c') = 3
    AND count(*) FILTER (WHERE referenced.relname = 'representation_formation_sessions' AND fk_constraint.confdeltype = 'n') = 1,
    string_agg(referenced.relname || '=' || fk_constraint.confdeltype::text, ', ' ORDER BY referenced.relname),
    'businesses/business_representations/onboarding=cascade; formation=set null'
  FROM pg_catalog.pg_constraint AS fk_constraint
  JOIN pg_catalog.pg_class AS referenced ON referenced.oid = fk_constraint.confrelid
  WHERE fk_constraint.conrelid = 'public.direct_hire_working_sessions'::regclass
    AND fk_constraint.contype = 'f'
    AND referenced.relname <> 'users'
  UNION ALL
  SELECT 'POSTCHECK-04 one_active_unique_index', count(*) = 1
    AND bool_and(indexdef LIKE '%UNIQUE INDEX%')
    AND bool_and(indexdef LIKE '%direct_hire_onboarding_session_id%')
    AND bool_and(indexdef LIKE '%WHERE (status = ''scheduled''::text)%'),
    coalesce(string_agg(indexdef, E'\n'), 'missing'),
    'one partial unique index on onboarding session where status=scheduled'
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public' AND tablename = 'direct_hire_working_sessions'
    AND indexname = 'direct_hire_working_sessions_one_active_idx'
  UNION ALL
  SELECT 'POSTCHECK-05 supporting_owner_index', count(*) = 1,
    coalesce(string_agg(indexdef, E'\n'), 'missing'), 'owner/session/created_at index present'
  FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public' AND tablename = 'direct_hire_working_sessions'
    AND indexname = 'direct_hire_working_sessions_owner_idx'
  UNION ALL
  SELECT 'POSTCHECK-06 RLS_and_owner_policy', class.relrowsecurity
    AND count(policy.policyname) = 1
    AND bool_and(policy.cmd = 'SELECT')
    AND bool_and(policy.qual LIKE '%auth.uid()%'),
    format('rls=%s policies=%s', class.relrowsecurity, count(policy.policyname)),
    'rls=true, one owner SELECT policy'
  FROM pg_catalog.pg_class AS class
  LEFT JOIN pg_catalog.pg_policies AS policy
    ON policy.schemaname = 'public' AND policy.tablename = class.relname
  WHERE class.oid = 'public.direct_hire_working_sessions'::regclass
  GROUP BY class.relrowsecurity
  UNION ALL
  SELECT 'POSTCHECK-07 table_grants',
    NOT public_any AND NOT anon_any AND authenticated_select
      AND NOT authenticated_mutate AND service_role_access,
    format('public_any=%s anon_any=%s auth_select=%s auth_mutate=%s service_access=%s', public_any, anon_any, authenticated_select, authenticated_mutate, service_role_access),
    'public=false anon=false auth_select=true auth_mutate=false service_access=true'
  FROM table_acl
  UNION ALL
  SELECT 'POSTCHECK-08 function_signatures', count(*) = 4
    AND count(*) FILTER (WHERE proname='zeya_schedule_direct_hire_working_session' AND arguments='p_scheduled_at timestamp with time zone, p_scheduling_timezone text') = 1
    AND count(*) FILTER (WHERE proname='zeya_cancel_direct_hire_working_session' AND arguments='') = 1
    AND count(*) FILTER (WHERE proname='zeya_accept_direct_hire_employment' AND arguments='') = 1
    AND count(*) FILTER (WHERE proname='zeya_validate_direct_hire_working_session_lineage' AND arguments='') = 1,
    string_agg(proname || '(' || arguments || ')', ', ' ORDER BY proname),
    'four exact expected signatures'
  FROM function_inventory
  UNION ALL
  SELECT 'POSTCHECK-09 RPC_permissions', count(*) = 4
    AND count(*) FILTER (WHERE proname IN ('zeya_schedule_direct_hire_working_session','zeya_cancel_direct_hire_working_session','zeya_accept_direct_hire_employment') AND NOT public_execute AND NOT anon_execute AND authenticated_execute AND NOT service_role_execute) = 3
    AND count(*) FILTER (WHERE proname='zeya_validate_direct_hire_working_session_lineage' AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND NOT service_role_execute) = 1,
    string_agg(format('%s public=%s anon=%s auth=%s service=%s', proname, public_execute, anon_execute, authenticated_execute, service_role_execute), '; ' ORDER BY proname),
    'schedule/cancel/accept authenticated-only; trigger executable by no API role'
  FROM function_acl
  UNION ALL
  SELECT 'POSTCHECK-10 acceptance_semantics', count(*) = 1
    AND bool_and(definition NOT LIKE '%preparation_status NOT IN (''ready'', ''partial'')%')
    AND bool_and(definition LIKE '%P2.1 intentionally removes only%')
    AND bool_and(definition LIKE '%auth.uid()%')
    AND bool_and(definition LIKE '%FOR UPDATE%')
    AND bool_and(definition LIKE '%onboarding_state = ''employment_accepted''%')
    AND bool_and(definition LIKE '%onboarding_state <> ''preparation''%'),
    coalesce(string_agg('old_gate=' || (definition LIKE '%preparation_status NOT IN (''ready'', ''partial'')%')::text, ', '), 'missing'),
    'old_gate=false with explicit P2.1 marker and preserved auth/lock/state markers'
  FROM function_inventory WHERE proname='zeya_accept_direct_hire_employment'
  UNION ALL
  SELECT 'POSTCHECK-11 validation_trigger', count(*) = 1
    AND bool_and(NOT tgisinternal),
    count(*)::text, 'one user validation trigger'
  FROM pg_catalog.pg_trigger
  WHERE tgrelid = 'public.direct_hire_working_sessions'::regclass
    AND tgname = 'direct_hire_working_sessions_validate'
  UNION ALL
  SELECT 'POSTCHECK-12 no_unrelated_P2_objects',
    (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'direct_hire_working_sessions%') = 4
    AND (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'zeya_%direct_hire_working_session%') = 3,
    format('relations=%s functions=%s',
      (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'direct_hire_working_sessions%'),
      (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'zeya_%direct_hire_working_session%')),
    'relations=4 (table + primary-key index + 2 explicit indexes), functions=3'
)
SELECT check_name, pass, actual, expected,
  CASE WHEN pass THEN 'PASS' ELSE 'FAIL - REVIEW BEFORE APPROVAL' END AS verdict
FROM checks
ORDER BY check_name;

SELECT proname, pg_get_function_identity_arguments(oid) AS arguments,
  pg_get_functiondef(oid) AS definition
FROM pg_catalog.pg_proc
WHERE oid IN (
  'public.zeya_schedule_direct_hire_working_session(timestamptz,text)'::regprocedure,
  'public.zeya_cancel_direct_hire_working_session()'::regprocedure,
  'public.zeya_accept_direct_hire_employment()'::regprocedure
)
ORDER BY proname;
