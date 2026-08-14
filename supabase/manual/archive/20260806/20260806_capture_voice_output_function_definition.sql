-- Exact deployed capture RPC definitions (STRICTLY READ-ONLY).
WITH target_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.prosecdef,
    procedure.proconfig,procedure.proacl
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.prokind='f'
    AND procedure.proname='zeya_capture_voice_conversation_output'
)
SELECT function_row.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(function_row.oid) AS result_type,
  owner_role.rolname AS owner_role,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS function_settings,
  has_function_privilege('service_role',function_row.oid,'EXECUTE') AS service_role_execute,
  has_function_privilege('authenticated',function_row.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon',function_row.oid,'EXECUTE') AS anon_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl
    WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
  ) AS public_execute,
  pg_catalog.pg_get_functiondef(function_row.oid) AS exact_function_definition
FROM target_functions AS function_row
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=function_row.proowner
ORDER BY identity_arguments;
