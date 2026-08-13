-- READ ONLY. Run after 20260813020000_direct_hire_first_working_session_preparation_recovery.sql.

WITH expected_columns(column_name, data_type, is_nullable) AS (
  VALUES
    ('id','uuid','NO'), ('direct_hire_working_session_id','uuid','NO'),
    ('owner_id','uuid','NO'), ('business_id','uuid','NO'),
    ('business_representation_id','uuid','NO'),
    ('direct_hire_onboarding_session_id','uuid','NO'),
    ('exhausted_contract_version','text','NO'), ('recovery_contract_version','text','NO'),
    ('recovery_reason_code','text','NO'), ('previous_attempt_count','smallint','NO'),
    ('previous_failure_code','text','NO'), ('recovered_by_role','text','NO'),
    ('recovered_at','timestamp with time zone','NO')
), columns AS (
  SELECT count(*) = (SELECT count(*) FROM expected_columns)
    AND (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'direct_hire_first_working_session_preparation_recoveries') = 13 AS ok
  FROM information_schema.columns AS actual
  JOIN expected_columns AS expected
    ON expected.column_name = actual.column_name
   AND expected.data_type = actual.data_type
   AND expected.is_nullable = actual.is_nullable
  WHERE actual.table_schema = 'public'
    AND actual.table_name = 'direct_hire_first_working_session_preparation_recoveries'
), constraints AS (
  SELECT count(*) = 11
    AND count(*) FILTER (WHERE contype = 'p') = 1
    AND count(*) FILTER (WHERE contype = 'u') = 1
    AND count(*) FILTER (WHERE contype = 'f') = 5
    AND count(*) FILTER (WHERE contype = 'c') = 4 AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = to_regclass('public.direct_hire_first_working_session_preparation_recoveries')
), indexes AS (
  SELECT count(*) = 2 AS ok
  FROM pg_catalog.pg_index
  WHERE indrelid = to_regclass('public.direct_hire_first_working_session_preparation_recoveries')
), relation_acl AS (
  SELECT class.oid,
    coalesce(bool_or(expanded.grantee = 0), false) AS public_has_privilege
  FROM pg_catalog.pg_class AS class
  LEFT JOIN LATERAL aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) AS expanded ON true
  WHERE class.oid = to_regclass('public.direct_hire_first_working_session_preparation_recoveries')
  GROUP BY class.oid
), security AS (
  SELECT class.relrowsecurity
    AND NOT relation_acl.public_has_privilege
    AND NOT coalesce(has_table_privilege(to_regrole('anon'), class.oid, 'SELECT,INSERT,UPDATE,DELETE'), false)
    AND NOT coalesce(has_table_privilege(to_regrole('authenticated'), class.oid, 'SELECT,INSERT,UPDATE,DELETE'), false)
    AND coalesce(has_table_privilege(to_regrole('service_role'), class.oid, 'SELECT'), false)
    AND NOT coalesce(has_table_privilege(to_regrole('service_role'), class.oid, 'INSERT,UPDATE,DELETE'), false) AS ok
  FROM pg_catalog.pg_class AS class
  JOIN relation_acl USING (oid)
  WHERE class.oid = to_regclass('public.direct_hire_first_working_session_preparation_recoveries')
), trigger_check AS (
  SELECT count(*) = 1 AS ok
  FROM pg_catalog.pg_trigger
  WHERE tgrelid = to_regclass('public.direct_hire_first_working_session_preparation_recoveries')
    AND NOT tgisinternal
    AND (tgtype::integer & 8) = 8
    AND (tgtype::integer & 16) = 16
), object_scope AS (
  SELECT
    (SELECT count(*) FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname LIKE 'direct_hire_first_working_session_preparation_recover%') = 1
    AND (SELECT count(*) FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('zeya_recover_first_working_session_preparation',
                        'zeya_prevent_first_working_session_preparation_recovery_modification')) = 2 AS ok
)
SELECT 'exact_ledger_columns' AS check_name, ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM columns
UNION ALL SELECT 'ledger_constraints', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM constraints
UNION ALL SELECT 'ledger_indexes', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM indexes
UNION ALL SELECT 'ledger_rls_and_grants', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM security
UNION ALL SELECT 'immutable_trigger', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM trigger_check
UNION ALL SELECT 'expected_object_scope', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM object_scope;

WITH function_row AS (
  SELECT procedure.oid, procedure.proowner, procedure.proacl,
         pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
         lower(pg_get_functiondef(procedure.oid)) AS definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = to_regprocedure('public.zeya_recover_first_working_session_preparation(uuid,text,text,text)')
), acl AS (
  SELECT function_row.oid,
    coalesce(bool_or(expanded.grantee = 0 AND expanded.privilege_type = 'EXECUTE'), false) AS public_execute
  FROM function_row
  LEFT JOIN LATERAL aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) AS expanded ON true
  GROUP BY function_row.oid
)
SELECT function_row.identity_arguments,
       acl.public_execute,
       coalesce(has_function_privilege(to_regrole('anon'), function_row.oid, 'EXECUTE'), false) AS anon_execute,
       coalesce(has_function_privilege(to_regrole('authenticated'), function_row.oid, 'EXECUTE'), false) AS authenticated_execute,
       coalesce(has_function_privilege(to_regrole('service_role'), function_row.oid, 'EXECUTE'), false) AS service_role_execute,
       CASE WHEN NOT acl.public_execute
              AND NOT coalesce(has_function_privilege(to_regrole('anon'), function_row.oid, 'EXECUTE'), false)
              AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), function_row.oid, 'EXECUTE'), false)
              AND coalesce(has_function_privilege(to_regrole('service_role'), function_row.oid, 'EXECUTE'), false)
              AND function_row.definition LIKE '%security definer%'
              AND function_row.definition LIKE '%set search_path to ''''%'
              AND function_row.definition LIKE '%for update%'
              AND function_row.definition LIKE '%first-working-session-preparation-v2%'
              AND function_row.definition LIKE '%first-working-session-preparation-v3%'
              AND function_row.definition LIKE '%preparation_attempt_count <> 3%'
              AND function_row.definition LIKE '%preparation_lease_id is not null%'
              AND function_row.definition LIKE '%current_version_id is null%'
              AND function_row.definition NOT LIKE '%preparation_website_persisted_at =%'
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM function_row JOIN acl USING (oid);

SELECT count(*) AS recovery_rows,
       coalesce(bool_and(exhausted_contract_version = 'first-working-session-preparation-v2'), true) AS predecessor_is_v2,
       coalesce(bool_and(recovery_contract_version = 'first-working-session-preparation-v3'), true) AS recovery_is_v3,
       coalesce(bool_and(recovery_reason_code = 'corrected_application_defect'), true) AS reason_is_governed,
       coalesce(bool_and(previous_attempt_count = 3), true) AS exhausted_count_preserved,
       coalesce(bool_and(previous_failure_code <> ''), true) AS failure_preserved,
       coalesce(bool_and(recovered_by_role = 'service_role'), true) AS service_context_preserved,
       CASE WHEN coalesce(bool_and(exhausted_contract_version = 'first-working-session-preparation-v2'), true)
                  AND coalesce(bool_and(recovery_contract_version = 'first-working-session-preparation-v3'), true)
                  AND coalesce(bool_and(recovery_reason_code = 'corrected_application_defect'), true)
                  AND coalesce(bool_and(previous_attempt_count = 3), true)
                  AND coalesce(bool_and(previous_failure_code <> ''), true)
                  AND coalesce(bool_and(recovered_by_role = 'service_role'), true)
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM public.direct_hire_first_working_session_preparation_recoveries;
