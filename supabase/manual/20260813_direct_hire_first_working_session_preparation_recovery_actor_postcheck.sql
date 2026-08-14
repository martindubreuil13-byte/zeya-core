-- READ ONLY. Run after 20260813030000_direct_hire_first_working_session_preparation_recovery_actor.sql.

SELECT session_user::text AS database_session_role,
       current_user::text AS current_database_role,
       auth.role() AS jwt_role,
       CASE WHEN auth.role() = 'service_role'
                  OR session_user::text IN ('postgres', 'service_role')
            THEN 'PASS' ELSE 'FAIL' END AS supported_recovery_invocation_context;

WITH recovery_function AS (
  SELECT procedure.oid, procedure.proowner, procedure.proacl,
         pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
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
), definition_check AS (
  SELECT identity_arguments = 'p_working_session_id uuid, p_exhausted_contract_version text, p_recovery_contract_version text, p_recovery_reason_code text'
     AND definition LIKE '%security definer%'
     AND definition LIKE '%set search_path to ''''%'
     AND definition LIKE '%v_jwt_role text := auth.role()%'
     AND definition LIKE '%v_database_role text := session_user::text%'
     AND definition LIKE '%v_jwt_role is distinct from ''service_role''%'
     AND definition LIKE '%v_database_role not in (''postgres'', ''service_role'')%'
     AND definition LIKE '%when v_jwt_role = ''service_role'' then ''service_role''%'
     AND definition LIKE '%else v_database_role%'
     AND definition LIKE '%v_session.preparation_failure_code, v_recovery_actor%'
     AND definition LIKE '%insert into public.direct_hire_first_working_session_preparation_recoveries%'
     AND definition LIKE '%update public.direct_hire_working_sessions%'
     AND strpos(definition, 'insert into public.direct_hire_first_working_session_preparation_recoveries')
         < strpos(definition, 'update public.direct_hire_working_sessions') AS ok
  FROM recovery_function
), acl_check AS (
  SELECT NOT function_acl.public_execute
     AND NOT coalesce(has_function_privilege(to_regrole('anon'), recovery_function.oid, 'EXECUTE'), false)
     AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), recovery_function.oid, 'EXECUTE'), false)
     AND coalesce(has_function_privilege(to_regrole('service_role'), recovery_function.oid, 'EXECUTE'), false) AS ok
  FROM recovery_function JOIN function_acl USING (oid)
), actor_constraint AS (
  SELECT count(*) = 1
     AND bool_and(pg_get_constraintdef(constraint_row.oid, true) LIKE '%service_role%')
     AND bool_and(pg_get_constraintdef(constraint_row.oid, true) LIKE '%postgres%') AS ok
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovered_by_role%'
), recovery_objects AS (
  SELECT
    (SELECT count(*) FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname LIKE 'direct_hire_first_working_session_preparation_recover%') = 1
    AND (SELECT count(*) FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('zeya_recover_first_working_session_preparation',
                        'zeya_prevent_first_working_session_preparation_recovery_modification')) = 2
    AND (SELECT count(*) FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
        AND NOT tgisinternal) = 1 AS ok
)
SELECT 'corrected_actor_and_authorization_definition' AS check_name, ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM definition_check
UNION ALL SELECT 'api_acl_service_role_only', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM acl_check
UNION ALL SELECT 'truthful_non_null_actor_constraint', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM actor_constraint
UNION ALL SELECT 'recovery_object_scope_unchanged', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM recovery_objects;

SELECT count(*) AS recovery_rows,
       coalesce(bool_and(recovered_by_role IN ('service_role', 'postgres')), true) AS actor_is_truthful_and_allowed,
       coalesce(bool_and(recovered_by_role IS NOT NULL), true) AS actor_is_non_null,
       CASE WHEN coalesce(bool_and(recovered_by_role IN ('service_role', 'postgres')), true)
                  AND coalesce(bool_and(recovered_by_role IS NOT NULL), true)
            THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM public.direct_hire_first_working_session_preparation_recoveries;
