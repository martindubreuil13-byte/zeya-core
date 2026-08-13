-- P2.2 read-only postcheck.
WITH functions AS (
  SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) arguments,p.proacl,p.proowner,
    (p.proname='zeya_claim_first_working_session_preparation' AND pg_get_function_identity_arguments(p.oid)='p_contract_version text, p_lease_seconds integer')
    OR (p.proname='zeya_persist_first_working_session_website_research' AND pg_get_function_identity_arguments(p.oid)='p_working_session_id uuid, p_lease_id uuid, p_final_status text, p_failure_code text, p_successful_page_count smallint, p_failed_page_count smallint, p_evidence jsonb, p_observations jsonb')
    OR (p.proname='zeya_finalize_first_working_session_preparation' AND pg_get_function_identity_arguments(p.oid)='p_working_session_id uuid, p_lease_id uuid, p_snapshot_fingerprint text, p_hypothesis_trace_fingerprint text, p_contract_version text, p_brief jsonb, p_source_evidence_ids uuid[], p_source_hypothesis_ids uuid[]')
    OR (p.proname='zeya_fail_first_working_session_preparation' AND pg_get_function_identity_arguments(p.oid)='p_working_session_id uuid, p_lease_id uuid, p_failure_code text')
    OR (p.proname IN ('zeya_validate_direct_hire_first_working_session_brief_lineage','zeya_mark_first_working_session_preparation_stale') AND pg_get_function_identity_arguments(p.oid)='')
    AS expected_signature
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'zeya_claim_first_working_session_preparation','zeya_finalize_first_working_session_preparation',
    'zeya_fail_first_working_session_preparation','zeya_persist_first_working_session_website_research',
    'zeya_validate_direct_hire_first_working_session_brief_lineage'
    ,'zeya_mark_first_working_session_preparation_stale'
  )
), acl AS (
  SELECT f.proname,
    bool_or(a.grantee=0 AND a.privilege_type='EXECUTE') public_execute,
    bool_or(r.rolname='anon' AND a.privilege_type='EXECUTE') anon_execute,
    bool_or(r.rolname='authenticated' AND a.privilege_type='EXECUTE') authenticated_execute,
    bool_or(r.rolname='service_role' AND a.privilege_type='EXECUTE') service_execute
  FROM functions f CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
  LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee GROUP BY f.proname
), checks AS (
  SELECT 'POSTCHECK-01 lifecycle columns' check_name,count(*)=10 pass,count(*)::text actual,'10' expected
  FROM information_schema.columns WHERE table_schema='public' AND table_name='direct_hire_working_sessions'
    AND column_name LIKE 'preparation_%'
  UNION ALL
  SELECT 'POSTCHECK-02 private brief table',to_regclass('public.direct_hire_first_working_session_briefs') IS NOT NULL,
    coalesce(to_regclass('public.direct_hire_first_working_session_briefs')::text,'missing'),'public.direct_hire_first_working_session_briefs'
  UNION ALL
  SELECT 'POSTCHECK-03 private table has RLS and no owner policy',c.relrowsecurity AND count(p.policyname)=0,
    format('rls=%s policies=%s',c.relrowsecurity,count(p.policyname)),'rls=true policies=0'
  FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_policies p ON p.schemaname='public' AND p.tablename=c.relname
  WHERE c.oid='public.direct_hire_first_working_session_briefs'::regclass GROUP BY c.relrowsecurity
  UNION ALL
  SELECT 'POSTCHECK-04 exact functions',count(*)=6 AND count(*) FILTER (WHERE expected_signature)=6,string_agg(proname||'('||arguments||')',', ' ORDER BY proname),'6 exact expected signatures'
  FROM functions
  UNION ALL
  SELECT 'POSTCHECK-05 worker-only RPC ACL',count(*)=6
    AND count(*) FILTER (WHERE proname IN ('zeya_claim_first_working_session_preparation','zeya_finalize_first_working_session_preparation','zeya_fail_first_working_session_preparation','zeya_persist_first_working_session_website_research') AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND service_execute)=4
    AND count(*) FILTER (WHERE proname IN ('zeya_validate_direct_hire_first_working_session_brief_lineage','zeya_mark_first_working_session_preparation_stale') AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND NOT service_execute)=2,
    string_agg(format('%s public=%s anon=%s auth=%s service=%s',proname,public_execute,anon_execute,authenticated_execute,service_execute),'; ' ORDER BY proname),
    'four service-only RPCs; two triggers have no API execution'
  FROM acl
  UNION ALL
  SELECT 'POSTCHECK-06 claim index',count(*)=1,coalesce(string_agg(indexdef,E'\n'),'missing'),'one preparation claim index'
  FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='direct_hire_working_sessions'
    AND indexname='direct_hire_working_sessions_preparation_claim_idx'
  UNION ALL
  SELECT 'POSTCHECK-07 brief indexes',count(*)=2,string_agg(indexname,', ' ORDER BY indexname),'2 explicit brief indexes'
  FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='direct_hire_first_working_session_briefs'
    AND indexname IN ('direct_hire_first_working_session_briefs_current_idx','direct_hire_first_working_session_briefs_scope_idx')
)
SELECT check_name,pass,actual,expected,CASE WHEN pass THEN 'PASS' ELSE 'FAIL - REVIEW' END verdict
FROM checks ORDER BY check_name;
