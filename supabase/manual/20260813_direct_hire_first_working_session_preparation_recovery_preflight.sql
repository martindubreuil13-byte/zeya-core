-- READ ONLY. Run before 20260813020000_direct_hire_first_working_session_preparation_recovery.sql.

WITH expected_columns(column_name, data_type) AS (
  VALUES
    ('preparation_status','text'), ('preparation_attempt_count','smallint'),
    ('preparation_failure_code','text'), ('preparation_contract_version','text'),
    ('preparation_lease_id','uuid'), ('preparation_lease_expires_at','timestamp with time zone'),
    ('preparation_snapshot_fingerprint','text'),
    ('preparation_website_persisted_at','timestamp with time zone')
), column_check AS (
  SELECT count(*) = (SELECT count(*) FROM expected_columns) AS ok
  FROM expected_columns AS expected
  JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'direct_hire_working_sessions'
   AND actual.column_name = expected.column_name
   AND actual.data_type = expected.data_type
), expected_functions(signature) AS (
  VALUES
    ('public.zeya_claim_first_working_session_preparation(text,integer)'),
    ('public.zeya_fail_first_working_session_preparation(uuid,uuid,text)'),
    ('public.zeya_finalize_first_working_session_preparation(uuid,uuid,text,text,text,jsonb,uuid[],uuid[])')
), function_check AS (
  SELECT count(*) = (SELECT count(*) FROM expected_functions) AS ok
  FROM expected_functions
  WHERE to_regprocedure(signature) IS NOT NULL
), claim_bounds AS (
  SELECT count(*) = 1 AND bool_and(
    pg_get_constraintdef(oid, true) LIKE '%preparation_attempt_count%'
    AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
    AND pg_get_constraintdef(oid, true) LIKE '%<= 3%'
  ) AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.direct_hire_working_sessions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid, true) LIKE '%preparation_attempt_count%'
), recovery_absent AS (
  SELECT
    to_regclass('public.direct_hire_first_working_session_preparation_recoveries') IS NULL
    AND to_regprocedure('public.zeya_recover_first_working_session_preparation(uuid,text,text,text)') IS NULL
    AND to_regprocedure('public.zeya_prevent_first_working_session_preparation_recovery_modification()') IS NULL AS ok
)
SELECT 'predecessor_columns' AS check_name, column_check.ok,
       CASE WHEN column_check.ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM column_check
UNION ALL
SELECT 'predecessor_function_signatures', function_check.ok,
       CASE WHEN function_check.ok THEN 'PASS' ELSE 'FAIL' END FROM function_check
UNION ALL
SELECT 'attempt_bounds_0_to_3', claim_bounds.ok,
       CASE WHEN claim_bounds.ok THEN 'PASS' ELSE 'FAIL' END FROM claim_bounds
UNION ALL
SELECT 'recovery_objects_absent', recovery_absent.ok,
       CASE WHEN recovery_absent.ok THEN 'PASS' ELSE 'FAIL' END FROM recovery_absent;

WITH inspected(signature) AS (
  VALUES
    ('public.zeya_claim_first_working_session_preparation(text,integer)'),
    ('public.zeya_fail_first_working_session_preparation(uuid,uuid,text)'),
    ('public.zeya_finalize_first_working_session_preparation(uuid,uuid,text,text,text,jsonb,uuid[],uuid[])')
), functions AS (
  SELECT inspected.signature, procedure.oid, procedure.proowner, procedure.proacl,
         pg_get_function_identity_arguments(procedure.oid) AS identity_arguments
  FROM inspected
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = to_regprocedure(inspected.signature)
), acl AS (
  SELECT functions.oid,
    coalesce(bool_or(expanded.grantee = 0 AND expanded.privilege_type = 'EXECUTE'), false) AS public_execute
  FROM functions
  LEFT JOIN LATERAL aclexplode(coalesce(functions.proacl, acldefault('f', functions.proowner))) AS expanded ON true
  GROUP BY functions.oid
)
SELECT functions.signature, functions.identity_arguments,
       acl.public_execute,
       coalesce(has_function_privilege(to_regrole('anon'), functions.oid, 'EXECUTE'), false) AS anon_execute,
       coalesce(has_function_privilege(to_regrole('authenticated'), functions.oid, 'EXECUTE'), false) AS authenticated_execute,
       coalesce(has_function_privilege(to_regrole('service_role'), functions.oid, 'EXECUTE'), false) AS service_role_execute,
       CASE WHEN NOT acl.public_execute
              AND NOT coalesce(has_function_privilege(to_regrole('anon'), functions.oid, 'EXECUTE'), false)
              AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), functions.oid, 'EXECUTE'), false)
              AND coalesce(has_function_privilege(to_regrole('service_role'), functions.oid, 'EXECUTE'), false)
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM functions JOIN acl USING (oid)
ORDER BY functions.signature;

-- Aggregate only: confirms whether a recoverable v2 failure exists without
-- embedding a QA identifier or returning tenant lineage.
SELECT count(*) FILTER (
  WHERE working_session.status = 'scheduled'
    AND working_session.preparation_status = 'failed'
    AND working_session.preparation_attempt_count = 3
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v2'
    AND working_session.preparation_failure_code = 'brief_untraceable_language'
    AND working_session.preparation_lease_id IS NULL
    AND working_session.preparation_lease_expires_at IS NULL
) AS compatible_exhausted_v2_jobs
FROM public.direct_hire_working_sessions AS working_session;
