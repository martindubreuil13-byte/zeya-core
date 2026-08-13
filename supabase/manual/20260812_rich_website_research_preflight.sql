-- P1 RICH WEBSITE RESEARCH — READ-ONLY PREFLIGHT
-- Run before 20260812000000_rich_website_research.sql.
-- Expected predecessor lineage:
--   20260805000000_direct_hire_preparation_research.sql
--   20260811000000_direct_hire_registered_public_sources.sql
-- No DDL or data mutation is performed.

-- 1. Migration history is informative: manually applied migrations may not be recorded.
WITH expected(version) AS (
  VALUES ('20260805000000'), ('20260811000000')
)
SELECT
  expected.version,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations AS migration
    WHERE migration.version = expected.version
  ) AS recorded
FROM expected
ORDER BY expected.version;

-- 2. Show the current page-count CHECK constraints. Both should say BETWEEN 0 AND 3.
SELECT
  constraint_row.conname AS constraint_name,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  pg_get_constraintdef(constraint_row.oid, true) ~
    'preparation_(successful|failed)_page_count.*BETWEEN 0 AND 3' AS predecessor_match
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.direct_hire_onboarding_sessions'::regclass
  AND constraint_row.contype = 'c'
  AND pg_get_constraintdef(constraint_row.oid, true) ~
    'preparation_(successful|failed)_page_count'
ORDER BY constraint_row.conname;
-- PASS: exactly two rows and predecessor_match=true for both.

-- 3. Show the current Evidence page-type constraint.
SELECT
  constraint_row.conname AS constraint_name,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  constraint_row.conname = 'evidence_source_page_type_check'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%homepage%'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%about%'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%products_services%'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%registered_public_page%'
    AND pg_get_constraintdef(constraint_row.oid, true) NOT LIKE '%case_studies%'
    AS registered_source_predecessor_match
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.evidence'::regclass
  AND constraint_row.contype = 'c'
  AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%source_page_type%';
-- PASS: one row named evidence_source_page_type_check and match=true.

-- 4. Show the current Evidence-kind constraint.
SELECT
  constraint_row.conname AS constraint_name,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  constraint_row.conname = 'evidence_source_evidence_kind_check'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%title%'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%registered_page_excerpt%'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%explicit_absence%'
    AND pg_get_constraintdef(constraint_row.oid, true) NOT LIKE '%section_text%'
    AS registered_source_predecessor_match
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.evidence'::regclass
  AND constraint_row.contype = 'c'
  AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%source_evidence_kind%';
-- PASS: one row named evidence_source_evidence_kind_check and match=true.

-- 5. Exact function identities and signatures from the deployed catalog.
WITH expected(function_name, identity) AS (
  VALUES
    ('zeya_claim_direct_hire_preparation',
      'public.zeya_claim_direct_hire_preparation()'),
    ('zeya_finalize_direct_hire_preparation',
      'public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)')
)
SELECT
  expected.function_name,
  expected.identity,
  to_regprocedure(expected.identity) IS NOT NULL AS signature_match
FROM expected;
-- PASS: signature_match=true for both. The page-count arguments are smallint.

-- 6. Complete predecessor definitions for direct review.
SELECT
  procedure.proname AS function_name,
  pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  pg_get_function_result(procedure.oid) AS result_type,
  procedure.prosecdef AS security_definer,
  procedure.proconfig AS function_settings,
  pg_get_functiondef(procedure.oid) AS definition
FROM pg_catalog.pg_proc AS procedure
WHERE procedure.oid IN (
  to_regprocedure('public.zeya_claim_direct_hire_preparation()'),
  to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)')
)
ORDER BY procedure.proname;
-- PASS: two rows; both SECURITY DEFINER and SET search_path=''. Definitions use
-- direct-hire-web-v1, finalizer page bounds 0..3, and observation ceiling 3.

-- 7. Effective function permissions. Claim: authenticated only. Finalizer: service_role only.
WITH functions(function_name, function_oid) AS (
  VALUES
    ('claim', to_regprocedure('public.zeya_claim_direct_hire_preparation()')),
    ('finalize', to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)'))
)
SELECT
  functions.function_name,
  functions.function_oid IS NOT NULL AS function_exists,
  EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', functions.function_oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', functions.function_oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', functions.function_oid, 'EXECUTE') AS service_role_execute
FROM functions
LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = functions.function_oid;
-- PASS claim: false,false,true,false. PASS finalize: false,false,false,true.

-- 8. Recorded extraction versions, without exposing owner or Evidence content.
SELECT
  coalesce(preparation_extraction_version, '<null>') AS extraction_version,
  count(*) AS session_count
FROM public.direct_hire_onboarding_sessions
GROUP BY preparation_extraction_version
ORDER BY extraction_version;
-- Preflight expectation: existing completed/attempted research may be v1 or null.

-- 9. One-row predecessor compatibility verdict.
WITH page_count_checks AS (
  SELECT
    count(*) = 2
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true)
        LIKE '%preparation_successful_page_count%'
      AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
      AND pg_get_constraintdef(oid, true) LIKE '%<= 3%'
    ) = 1
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true)
        LIKE '%preparation_failed_page_count%'
      AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
      AND pg_get_constraintdef(oid, true) LIKE '%<= 3%'
    ) = 1
    AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.direct_hire_onboarding_sessions'::regclass
    AND contype = 'c'
    AND (
      pg_get_constraintdef(oid, true)
        LIKE '%preparation_successful_page_count%'
      OR pg_get_constraintdef(oid, true)
        LIKE '%preparation_failed_page_count%'
    )
), page_type_check AS (
  SELECT count(*) = 1
    AND bool_and(conname = 'evidence_source_page_type_check'
      AND pg_get_constraintdef(oid, true) LIKE '%registered_public_page%'
      AND pg_get_constraintdef(oid, true) NOT LIKE '%case_studies%') AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND contype = 'c' AND pg_get_constraintdef(oid, true) LIKE '%source_page_type%'
), evidence_kind_check AS (
  SELECT count(*) = 1
    AND bool_and(conname = 'evidence_source_evidence_kind_check'
      AND pg_get_constraintdef(oid, true) LIKE '%registered_page_excerpt%'
      AND pg_get_constraintdef(oid, true) NOT LIKE '%section_text%') AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND contype = 'c' AND pg_get_constraintdef(oid, true) LIKE '%source_evidence_kind%'
), functions AS (
  SELECT
    to_regprocedure('public.zeya_claim_direct_hire_preparation()') IS NOT NULL
    AND to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)') IS NOT NULL AS ok
)
SELECT
  page_count_checks.ok AS page_count_predecessor_match,
  page_type_check.ok AS registered_page_type_predecessor_match,
  evidence_kind_check.ok AS registered_kind_predecessor_match,
  functions.ok AS function_signatures_match,
  page_count_checks.ok AND page_type_check.ok
    AND evidence_kind_check.ok AND functions.ok AS overall_preflight_pass
FROM page_count_checks, page_type_check, evidence_kind_check, functions;
-- PASS: every boolean is true. Any false means stop and reconcile schema drift.
