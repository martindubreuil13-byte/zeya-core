-- READ ONLY. Run before 20260813030000_direct_hire_first_working_session_preparation_recovery_actor.sql.

SELECT session_user::text AS database_session_role,
       current_user::text AS current_database_role,
       auth.role() AS jwt_role,
       CASE WHEN auth.role() = 'service_role'
                  OR session_user::text IN ('postgres', 'service_role')
            THEN 'PASS' ELSE 'FAIL' END AS supported_recovery_invocation_context;

WITH recovery_function AS (
  SELECT procedure.oid, procedure.proowner, procedure.proacl,
         lower(regexp_replace(pg_get_functiondef(procedure.oid), '\s+', ' ', 'g')) AS definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = to_regprocedure(
    'public.zeya_recover_first_working_session_preparation(uuid,text,text,text)'
  )
), function_acl AS (
  SELECT recovery_function.oid,
    coalesce(bool_or(expanded.grantee = 0 AND expanded.privilege_type = 'EXECUTE'), false) AS public_execute
  FROM recovery_function
  LEFT JOIN LATERAL aclexplode(
    coalesce(recovery_function.proacl, acldefault('f', recovery_function.proowner))
  ) AS expanded ON true
  GROUP BY recovery_function.oid
), predecessor AS (
  SELECT
    to_regclass('public.direct_hire_first_working_session_preparation_recoveries') IS NOT NULL
    AND to_regprocedure('public.zeya_prevent_first_working_session_preparation_recovery_modification()') IS NOT NULL
    AND EXISTS (SELECT 1 FROM recovery_function) AS ok
), defective_definition AS (
  SELECT definition LIKE '%if auth.role() <> ''service_role'' then%'
     AND definition LIKE '%v_session.preparation_failure_code, auth.role()%'
     AND definition NOT LIKE '%session_user%'
     AND definition NOT LIKE '%is distinct from ''service_role''%' AS ok
  FROM recovery_function
), acl_check AS (
  SELECT NOT function_acl.public_execute
     AND NOT coalesce(has_function_privilege(to_regrole('anon'), recovery_function.oid, 'EXECUTE'), false)
     AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), recovery_function.oid, 'EXECUTE'), false)
     AND coalesce(has_function_privilege(to_regrole('service_role'), recovery_function.oid, 'EXECUTE'), false) AS ok
  FROM recovery_function JOIN function_acl USING (oid)
), ledger_empty AS (
  SELECT count(*) = 0 AS ok
  FROM public.direct_hire_first_working_session_preparation_recoveries
), old_actor_constraint AS (
  SELECT count(*) = 1
     AND bool_and(pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovered_by_role%service_role%') AS ok
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovered_by_role%'
)
SELECT 'recovery_predecessor_present' AS check_name, ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM predecessor
UNION ALL SELECT 'defective_expression_matches_patch', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM defective_definition
UNION ALL SELECT 'api_acl_service_role_only', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM acl_check
UNION ALL SELECT 'failed_transaction_left_ledger_empty', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM ledger_empty
UNION ALL SELECT 'old_actor_constraint_present', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM old_actor_constraint;

-- Aggregate compatibility only; no QA identifier or tenant lineage is embedded.
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
