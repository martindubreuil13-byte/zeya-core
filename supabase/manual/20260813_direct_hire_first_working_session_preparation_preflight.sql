-- P2.2 read-only preflight. Do not run the migration unless every row passes.
WITH checks AS (
  SELECT 'PREFLIGHT-01 P2.1 table exists' AS check_name,
    to_regclass('public.direct_hire_working_sessions') IS NOT NULL AS pass,
    coalesce(to_regclass('public.direct_hire_working_sessions')::text, 'missing') AS actual,
    'public.direct_hire_working_sessions' AS expected
  UNION ALL
  SELECT 'PREFLIGHT-02 P2.2 not already applied',
    to_regclass('public.direct_hire_first_working_session_briefs') IS NULL,
    coalesce(to_regclass('public.direct_hire_first_working_session_briefs')::text, 'absent'), 'absent'
  UNION ALL
  SELECT 'PREFLIGHT-03 P2.1 lineage columns', count(*) = 5, count(*)::text, '5'
  FROM information_schema.columns WHERE table_schema='public' AND table_name='direct_hire_working_sessions'
    AND column_name IN ('owner_id','business_id','business_representation_id','direct_hire_onboarding_session_id','status')
  UNION ALL
  SELECT 'PREFLIGHT-04 induction eligibility columns', count(*) = 2, count(*)::text, '2'
  FROM information_schema.columns WHERE table_schema='public' AND table_name='direct_hire_onboarding_sessions'
    AND column_name IN ('onboarding_state','induction_state')
  UNION ALL
  SELECT 'PREFLIGHT-05 P1 finalizer signature', count(*) = 1,
    coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ', '), 'missing'),
    'p_onboarding_session_id uuid, p_expected_owner_id uuid, p_lease_id uuid, p_final_status text, p_failure_code text, p_progress jsonb, p_successful_page_count smallint, p_failed_page_count smallint, p_evidence jsonb, p_observations jsonb'
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='zeya_finalize_direct_hire_preparation'
    AND pg_get_function_identity_arguments(p.oid)='p_onboarding_session_id uuid, p_expected_owner_id uuid, p_lease_id uuid, p_final_status text, p_failure_code text, p_progress jsonb, p_successful_page_count smallint, p_failed_page_count smallint, p_evidence jsonb, p_observations jsonb'
)
SELECT check_name,pass,actual,expected,CASE WHEN pass THEN 'PASS' ELSE 'FAIL - STOP' END AS verdict
FROM checks ORDER BY check_name;
