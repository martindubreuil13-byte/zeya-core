SELECT
  p.oid::regprocedure AS exact_signature,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_configuration,
  p.proacl AS function_acl,
  md5(pg_get_functiondef(p.oid)) AS deployed_definition_md5,
  strpos(pg_get_functiondef(p.oid), 'DELETE FROM public.voice_representation_lineage') > 0 AS has_voice_lineage_delete,
  strpos(pg_get_functiondef(p.oid), 'business_representation_id') > 0 AS scopes_representation,
  strpos(pg_get_functiondef(p.oid), 'business_id') > 0 AS scopes_business,
  strpos(pg_get_functiondef(p.oid), '''voice_representation_lineage''') > 0 AS reports_voice_lineage_count,
  pg_get_functiondef(p.oid) AS exact_deployed_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'zeya_purge_business_representation'
  AND pg_get_function_identity_arguments(p.oid) = 'p_business_representation_id uuid, p_expected_business_id uuid';

-- STOP unless the returned exact definition matches the checked-in authoritative
-- 20260715_voice_lineage_controlled_purge_patch.sql baseline.
