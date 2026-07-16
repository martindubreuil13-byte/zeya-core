-- Run against the deployed database before reviewing the Phase 3 purge patch.
-- Pin the returned MD5 and exact definition. Do not deploy the patch until a
-- line-by-line comparison proves that only the two Phase 3 deletion/count blocks
-- were inserted and owner, SECURITY DEFINER, search path, ACL, order, and all
-- other behavior remain unchanged.
SELECT
  p.oid::regprocedure AS exact_signature,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_configuration,
  p.proacl AS function_acl,
  pg_get_functiondef(p.oid) AS function_definition,
  md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'zeya_purge_business_representation'
  AND pg_get_function_identity_arguments(p.oid) = 'p_business_representation_id uuid, p_expected_business_id uuid';
