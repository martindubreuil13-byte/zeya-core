-- P1 RICH WEBSITE RESEARCH — READ-ONLY POSTCHECK
-- Run after manually applying 20260812000000_rich_website_research.sql.
-- No DDL or data mutation is performed.

-- 1. Show page-count constraints and verify both now permit 0..10.
SELECT
  constraint_row.conname AS constraint_name,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  pg_get_constraintdef(constraint_row.oid, true) ~
    'preparation_(successful|failed)_page_count.*BETWEEN 0 AND 10' AS p1_match
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.direct_hire_onboarding_sessions'::regclass
  AND constraint_row.contype = 'c'
  AND pg_get_constraintdef(constraint_row.oid, true) ~
    'preparation_(successful|failed)_page_count'
ORDER BY constraint_row.conname;
-- PASS: exactly two rows and p1_match=true for both.

-- 2. Evidence page-type vocabulary, including registered_public_page compatibility.
WITH required(value) AS (
  VALUES ('homepage'), ('about'), ('products_services'), ('pricing'),
    ('customers'), ('case_studies'), ('testimonials'), ('industries'),
    ('methodology'), ('team'), ('faq'), ('contact'), ('resources'),
    ('registered_public_page')
), deployed AS (
  SELECT pg_get_constraintdef(oid, true) AS definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND conname = 'evidence_source_page_type_check'
)
SELECT required.value,
  EXISTS (SELECT 1 FROM deployed WHERE definition LIKE '%''' || required.value || '''%') AS present
FROM required ORDER BY required.value;
-- PASS: every present value is true.

-- 3. Evidence-kind vocabulary: all predecessor values plus P1 section kinds.
WITH required(value) AS (
  VALUES ('title'), ('meta_description'), ('primary_heading'), ('main_excerpt'),
    ('about_excerpt'), ('products_services_excerpt'), ('registered_page_excerpt'),
    ('explicit_absence'), ('section_text'), ('section_list'), ('pricing_block'),
    ('testimonial'), ('quantitative_claim')
), deployed AS (
  SELECT pg_get_constraintdef(oid, true) AS definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND conname = 'evidence_source_evidence_kind_check'
)
SELECT required.value,
  EXISTS (SELECT 1 FROM deployed WHERE definition LIKE '%''' || required.value || '''%') AS present
FROM required ORDER BY required.value;
-- PASS: every present value is true.

-- 4. Function properties, extraction version, page limit, and unchanged observation ceiling.
WITH functions(function_name, function_oid) AS (
  VALUES
    ('claim', to_regprocedure('public.zeya_claim_direct_hire_preparation()')),
    ('finalize', to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)'))
), definitions AS (
  SELECT function_name, function_oid, pg_get_functiondef(function_oid) AS definition
  FROM functions WHERE function_oid IS NOT NULL
)
SELECT
  function_name,
  function_oid IS NOT NULL AS signature_match,
  definition LIKE '%direct-hire-web-v2%' AS uses_extraction_v2,
  CASE WHEN function_name = 'finalize'
    THEN definition LIKE '%p_successful_page_count NOT BETWEEN 0 AND 10%'
      AND definition LIKE '%p_failed_page_count NOT BETWEEN 0 AND 10%'
    ELSE NULL END AS accepts_page_counts_to_10,
  CASE WHEN function_name = 'finalize'
    THEN definition LIKE '%jsonb_array_length(coalesce(p_observations, ''[]''::jsonb)) > 3%'
    ELSE NULL END AS observation_ceiling_remains_3,
  procedure.prosecdef AS security_definer,
  'search_path=""' = ANY(procedure.proconfig) AS empty_search_path
FROM functions
LEFT JOIN definitions USING (function_name, function_oid)
LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = function_oid
ORDER BY function_name;
-- PASS: both signatures/v2/security fields true; finalizer page/observation fields true.

-- 5. Effective permissions remain unchanged.
WITH functions(function_name, function_oid) AS (
  VALUES
    ('claim', to_regprocedure('public.zeya_claim_direct_hire_preparation()')),
    ('finalize', to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)'))
)
SELECT
  functions.function_name,
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

-- 6. Compact catalog inventory for unrelated-change review. P1 should add no
-- columns, indexes, triggers, policies, tables, or types; only the four CHECK
-- constraints and two function definitions above should differ from preflight.
SELECT 'column' AS object_type, table_name || '.' || column_name AS object_name,
  data_type AS definition
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('direct_hire_onboarding_sessions', 'evidence')
UNION ALL
SELECT 'index', tablename || '.' || indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('direct_hire_onboarding_sessions', 'evidence')
UNION ALL
SELECT 'trigger', event_object_table || '.' || trigger_name,
  action_timing || ' ' || event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('direct_hire_onboarding_sessions', 'evidence')
ORDER BY object_type, object_name;
-- PASS: compare with preflight/environment inventory; no P1-created columns,
-- indexes, triggers, policies, tables, or types should appear.

-- 7. One-row postcheck verdict.
WITH page_counts AS (
  SELECT
    count(*) = 2
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true)
        LIKE '%preparation_successful_page_count%'
      AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
      AND pg_get_constraintdef(oid, true) LIKE '%<= 10%'
    ) = 1
    AND count(*) FILTER (
      WHERE pg_get_constraintdef(oid, true)
        LIKE '%preparation_failed_page_count%'
      AND pg_get_constraintdef(oid, true) LIKE '%>= 0%'
      AND pg_get_constraintdef(oid, true) LIKE '%<= 10%'
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
), page_types AS (
  SELECT count(*) = 1 AND bool_and(
    pg_get_constraintdef(oid, true) LIKE ALL (ARRAY[
      '%''homepage''%', '%''about''%', '%''products_services''%', '%''pricing''%',
      '%''customers''%', '%''case_studies''%', '%''testimonials''%', '%''industries''%',
      '%''methodology''%', '%''team''%', '%''faq''%', '%''contact''%',
      '%''resources''%', '%''registered_public_page''%'
    ])) AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND conname = 'evidence_source_page_type_check'
), evidence_kinds AS (
  SELECT count(*) = 1 AND bool_and(
    pg_get_constraintdef(oid, true) LIKE ALL (ARRAY[
      '%''title''%', '%''meta_description''%', '%''primary_heading''%', '%''main_excerpt''%',
      '%''about_excerpt''%', '%''products_services_excerpt''%', '%''registered_page_excerpt''%',
      '%''explicit_absence''%', '%''section_text''%', '%''section_list''%',
      '%''pricing_block''%', '%''testimonial''%', '%''quantitative_claim''%'
    ])) AS ok
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.evidence'::regclass
    AND conname = 'evidence_source_evidence_kind_check'
), function_checks AS (
  SELECT
    claim.oid IS NOT NULL AND finalize.oid IS NOT NULL
      AND pg_get_functiondef(claim.oid) LIKE '%direct-hire-web-v2%'
      AND pg_get_functiondef(finalize.oid) LIKE '%direct-hire-web-v2%'
      AND pg_get_functiondef(finalize.oid) LIKE '%p_successful_page_count NOT BETWEEN 0 AND 10%'
      AND pg_get_functiondef(finalize.oid) LIKE '%p_failed_page_count NOT BETWEEN 0 AND 10%'
      AND pg_get_functiondef(finalize.oid) LIKE '%jsonb_array_length(coalesce(p_observations, ''[]''::jsonb)) > 3%'
      AS definitions_ok,
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(coalesce(
        finalize.proacl,
        pg_catalog.acldefault('f', finalize.proowner)
      )) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
      AND NOT has_function_privilege('anon', finalize.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', finalize.oid, 'EXECUTE')
      AND has_function_privilege('service_role', finalize.oid, 'EXECUTE') AS finalizer_acl_ok,
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(coalesce(
        claim.proacl,
        pg_catalog.acldefault('f', claim.proowner)
      )) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
      AND NOT has_function_privilege('anon', claim.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', claim.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', claim.oid, 'EXECUTE') AS claim_acl_ok
  FROM pg_catalog.pg_proc AS claim
  CROSS JOIN pg_catalog.pg_proc AS finalize
  WHERE claim.oid = to_regprocedure('public.zeya_claim_direct_hire_preparation()')
    AND finalize.oid = to_regprocedure('public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)')
)
SELECT
  page_counts.ok AS page_counts_pass,
  page_types.ok AS page_types_pass,
  evidence_kinds.ok AS evidence_kinds_pass,
  coalesce(function_checks.definitions_ok, false) AS function_definitions_pass,
  coalesce(function_checks.claim_acl_ok, false) AS claim_permissions_pass,
  coalesce(function_checks.finalizer_acl_ok, false) AS finalizer_permissions_pass,
  page_counts.ok AND page_types.ok AND evidence_kinds.ok
    AND coalesce(function_checks.definitions_ok, false)
    AND coalesce(function_checks.claim_acl_ok, false)
    AND coalesce(function_checks.finalizer_acl_ok, false) AS overall_postcheck_pass
FROM page_counts, page_types, evidence_kinds
LEFT JOIN function_checks ON true;
-- PASS: every boolean is true. Any false requires investigation before acceptance.
