BEGIN;

DO $$
DECLARE
  target_oid OID := to_regprocedure('public.zeya_mark_public_experience_dispatch_resolution_pending(text,text,text,text)');
  named_overload_count INTEGER;
  acl_exact BOOLEAN;
BEGIN
  SELECT count(*)
    INTO named_overload_count
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'zeya_mark_public_experience_dispatch_resolution_pending';

  IF target_oid IS NULL OR named_overload_count <> 1 THEN
    RAISE EXCEPTION 'Rollback refused: resolution-pending RPC signature drift detected';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=""']::text[]
         AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) AS x WHERE x.privilege_type = 'EXECUTE') = 2
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(p.proacl) AS x
           WHERE x.privilege_type = 'EXECUTE'
             AND x.grantee NOT IN (p.proowner, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
         )
    INTO acl_exact
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = target_oid;

  IF acl_exact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Rollback refused: resolution-pending RPC security drift detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.public_experience_sessions
    WHERE state IN ('call_requested', 'dispatch_resolution_pending')
  ) THEN
    RAISE EXCEPTION 'Rollback refused: unresolved dispatch reservations would be stranded';
  END IF;
END;
$$;

DROP FUNCTION public.zeya_mark_public_experience_dispatch_resolution_pending(TEXT, TEXT, TEXT, TEXT);

NOTIFY pgrst, 'reload schema';

COMMIT;
