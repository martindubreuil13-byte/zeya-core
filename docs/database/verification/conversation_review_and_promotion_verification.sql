-- Static post-deployment verification; all statements are read-only.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname='public' AND tablename IN ('conversation_candidate_review_decisions','conversation_candidate_promotions');

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('conversation_candidate_review_decisions','conversation_candidate_promotions')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('conversation_candidate_review_decisions','conversation_candidate_promotions')
ORDER BY table_name, grantee, privilege_type;

SELECT p.oid::regprocedure AS exact_signature, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer, p.proconfig AS function_configuration, p.proacl AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'zeya_review_voice_conversation_candidate','zeya_promote_voice_conversation_candidate',
  'zeya_enforce_conversation_review_immutability'
);

SELECT conrelid::regclass AS relation, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.conversation_candidate_review_decisions'::regclass,'public.conversation_candidate_promotions'::regclass)
ORDER BY conrelid::regclass::text, conname;

SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN ('zeya_conversation_review_immutability','zeya_conversation_promotion_immutability');

-- Expected: authenticated SELECT true; every direct mutation privilege false.
SELECT role_name, table_name,
       has_table_privilege(role_name, format('public.%I',table_name),'SELECT') AS can_select,
       has_table_privilege(role_name, format('public.%I',table_name),'INSERT') AS can_insert,
       has_table_privilege(role_name, format('public.%I',table_name),'UPDATE') AS can_update,
       has_table_privilege(role_name, format('public.%I',table_name),'DELETE') AS can_delete
FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
CROSS JOIN (VALUES ('conversation_candidate_review_decisions'),('conversation_candidate_promotions')) tables(table_name)
ORDER BY table_name, role_name;

-- Expected: authenticated true for the two RPCs; anon and service_role false.
SELECT role_name, p.oid::regprocedure AS function_name,
       has_function_privilege(role_name,p.oid,'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) roles(role_name)
WHERE n.nspname='public' AND p.proname IN ('zeya_review_voice_conversation_candidate','zeya_promote_voice_conversation_candidate')
ORDER BY function_name::text, role_name;
