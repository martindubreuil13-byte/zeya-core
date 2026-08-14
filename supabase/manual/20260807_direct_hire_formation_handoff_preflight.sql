-- Direct Hire Formation Handoff Migration Preflight (Safe for Pre-Migration)
-- Structural and readiness checks for corrected two-migration sequence
-- Owner: mdubreu@gmail.com (da53cf7f-beb1-4168-a0cb-015610f092fc)
--
-- Migrations under review:
--   1. supabase/migrations/20260807000000_direct_hire_formation_source.sql (enum only)
--   2. supabase/migrations/20260807010000_direct_hire_formation_handoff.sql (schema + RPC + ACL)
--
-- Safe to run BEFORE migration is applied: uses to_regprocedure() not direct casts
-- READ-ONLY INSPECTION ONLY
-- No DDL, mutations, or data modification

-- ─────────────────────────────────────────────────────────────────────
-- PART 1: MIGRATION STRUCTURAL SAFETY
-- ─────────────────────────────────────────────────────────────────────

-- 1.1 Verify enum migration (20260807000000) exists and is separate
SELECT 'enum migration is separate file' AS check_name,
       '20260807000000_direct_hire_formation_source.sql' AS expected_file;

-- 1.2 Verify handoff migration (20260807010000) exists with RPC
SELECT 'handoff migration is separate file' AS check_name,
       '20260807010000_direct_hire_formation_handoff.sql' AS expected_file;

-- 1.3 Verify no collision with existing migration timestamp 20260807000000
SELECT 'enum migration timestamp unique' AS check_name,
       '20260807000000' AS migration_timestamp;

-- 1.4 Verify handoff migration timestamp (20260807010000) is after enum
SELECT 'handoff migration timestamp later than enum' AS check_name,
       ('20260807010000' > '20260807000000') AS result;

-- 1.5 Verify formation_initiation_source enum exists
SELECT 'formation_initiation_source enum exists' AS check_name,
       EXISTS (
         SELECT 1 FROM pg_type
         WHERE typname = 'formation_initiation_source'
         AND typtype = 'e'
       ) AS result;

-- 1.6 Verify direct_hire_onboarding enum value exists
SELECT 'direct_hire_onboarding enum value exists' AS check_name,
       EXISTS (
         SELECT 1 FROM pg_enum
         WHERE enumlabel = 'direct_hire_onboarding'
         AND enumtypid = 'formation_initiation_source'::regtype
       ) AS result;

-- 1.7 Verify direct_hire_onboarding_sessions table exists
SELECT 'direct_hire_onboarding_sessions table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'direct_hire_onboarding_sessions'
       ) AS result;

-- 1.8 Verify required columns on direct_hire_onboarding_sessions
SELECT 'direct_hire_onboarding_sessions required columns' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'direct_hire_onboarding_sessions'
         AND column_name IN ('id', 'owner_id', 'business_representation_id', 'onboarding_state', 'preparation_status')
       ) AS result;

-- 1.9 Check if formation_session_id column exists (added by migration)
SELECT 'formation_session_id column exists (pre-migration check)' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'direct_hire_onboarding_sessions'
         AND column_name = 'formation_session_id'
       ) AS result;

-- 1.10 Check if formation_initiated_at column exists (added by migration)
SELECT 'formation_initiated_at column exists (pre-migration check)' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'direct_hire_onboarding_sessions'
         AND column_name = 'formation_initiated_at'
       ) AS result;

-- 1.11 Verify representation_formation_sessions table exists
SELECT 'representation_formation_sessions table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'representation_formation_sessions'
       ) AS result;

-- 1.12 Verify formation_session_status enum exists
SELECT 'formation_session_status enum exists' AS check_name,
       EXISTS (
         SELECT 1 FROM pg_type
         WHERE typname = 'formation_session_status'
         AND typtype = 'e'
       ) AS result;

-- 1.13 Verify business_representations table exists
SELECT 'business_representations table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'business_representations'
       ) AS result;

-- 1.14 Verify business_representations.current_version_id exists
SELECT 'business_representations.current_version_id exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'business_representations'
         AND column_name = 'current_version_id'
       ) AS result;

-- 1.15 Verify evidence table exists
SELECT 'evidence table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'evidence'
       ) AS result;

-- 1.16 Verify evidence has required scoping columns
SELECT 'evidence scoping columns exist' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = 'evidence'
         AND column_name IN ('id', 'business_representation_id', 'source_type', 'direct_hire_onboarding_session_id')
       ) AS result;

-- 1.17 Verify audit_log table exists
SELECT 'audit_log table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'audit_log'
       ) AS result;

-- 1.18 Verify observations table exists
SELECT 'observations table exists' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name = 'observations'
       ) AS result;

-- ─────────────────────────────────────────────────────────────────────
-- PART 2: RPC AND AUDIT FUNCTION DEFINITIONS (SAFE ABSENCE CHECK)
-- ─────────────────────────────────────────────────────────────────────

-- 2.1 Safely check if zeya_initiate_direct_hire_formation RPC already exists
SELECT 'zeya_initiate_direct_hire_formation RPC exists' AS check_name,
       to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NOT NULL AS result;

-- 2.2 Safely check if zeya_audit_direct_hire_formation_initiation trigger function exists
SELECT 'zeya_audit_direct_hire_formation_initiation trigger function exists' AS check_name,
       to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()') IS NOT NULL AS result;

-- 2.3 Verify trigger exists on direct_hire_onboarding_sessions (if RPC exists)
SELECT 'trigger_audit_direct_hire_formation_initiation exists' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL THEN NULL
         ELSE EXISTS (
           SELECT 1 FROM information_schema.triggers
           WHERE trigger_schema = 'public'
           AND trigger_name = 'trigger_audit_direct_hire_formation_initiation'
           AND event_object_table = 'direct_hire_onboarding_sessions'
         )
       END AS result;

-- ─────────────────────────────────────────────────────────────────────
-- PART 3: RPC ACL VERIFICATION (GUARDED - ONLY IF RPC EXISTS)
-- ─────────────────────────────────────────────────────────────────────

-- 3.1 Verify RPC is NOT executable by PUBLIC (if RPC exists)
SELECT 'RPC has no PUBLIC execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'PUBLIC'::text,
           to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'),
           'EXECUTE'
         )
       END AS result;

-- 3.2 Verify RPC is NOT executable by anon (if RPC exists)
SELECT 'RPC has no anon execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'anon'::text,
           to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'),
           'EXECUTE'
         )
       END AS result;

-- 3.3 Verify RPC is NOT executable by authenticated (if RPC exists)
SELECT 'RPC has no authenticated execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'authenticated'::text,
           to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'),
           'EXECUTE'
         )
       END AS result;

-- 3.4 Verify RPC IS executable by service_role (if RPC exists)
SELECT 'RPC is executable by service_role (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') IS NULL THEN NULL
         ELSE has_function_privilege(
           'service_role'::text,
           to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)'),
           'EXECUTE'
         )
       END AS result;

-- 3.5 Verify audit trigger function is NOT executable by PUBLIC (if exists)
SELECT 'audit trigger function has no PUBLIC execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'PUBLIC'::text,
           to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()'),
           'EXECUTE'
         )
       END AS result;

-- 3.6 Verify audit trigger function is NOT executable by anon (if exists)
SELECT 'audit trigger function has no anon execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'anon'::text,
           to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()'),
           'EXECUTE'
         )
       END AS result;

-- 3.7 Verify audit trigger function is NOT executable by authenticated (if exists)
SELECT 'audit trigger function has no authenticated execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'authenticated'::text,
           to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()'),
           'EXECUTE'
         )
       END AS result;

-- 3.8 Verify audit trigger function is NOT executable by service_role (if exists)
SELECT 'audit trigger function has no service_role execute grant (deployed state)' AS check_name,
       CASE
         WHEN to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()') IS NULL THEN NULL
         ELSE NOT has_function_privilege(
           'service_role'::text,
           to_regprocedure('public.zeya_audit_direct_hire_formation_initiation()'),
           'EXECUTE'
         )
       END AS result;

-- ─────────────────────────────────────────────────────────────────────
-- PART 4: LIVE PREVIEW READINESS (Target Owner)
-- ─────────────────────────────────────────────────────────────────────

-- Owner identity
-- Email: mdubreu@gmail.com
-- UUID: da53cf7f-beb1-4168-a0cb-015610f092fc

-- 4.1 Verify owner exists in auth.users
SELECT 'Owner auth identity exists' AS check_name,
       EXISTS (
         SELECT 1 FROM auth.users
         WHERE id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         AND email = 'mdubreu@gmail.com'
       ) AS result;

-- 4.2 Verify exactly one Direct Hire onboarding session
SELECT 'Exactly one Direct Hire onboarding session for owner' AS check_name,
       (
         SELECT COUNT(*) FROM public.direct_hire_onboarding_sessions
         WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
       ) = 1 AS result;

-- 4.3 Verify onboarding state allows handoff
SELECT 'Onboarding state allows handoff' AS check_name,
       (
         SELECT onboarding_state FROM public.direct_hire_onboarding_sessions
         WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         LIMIT 1
       ) IN ('preparation', 'employment_accepted') AS result;

-- 4.4 Verify preparation_status is ready or partial
SELECT 'Preparation status is ready or partial' AS check_name,
       (
         SELECT preparation_status FROM public.direct_hire_onboarding_sessions
         WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         LIMIT 1
       ) IN ('ready', 'partial') AS result;

-- 4.5 Verify preparation_completed_at exists
SELECT 'Preparation completed timestamp exists' AS check_name,
       (
         SELECT preparation_completed_at IS NOT NULL
         FROM public.direct_hire_onboarding_sessions
         WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         LIMIT 1
       ) AS result;

-- 4.6 Verify no active preparation (not queued/running)
SELECT 'No active preparation (not queued/running)' AS check_name,
       (
         SELECT preparation_status FROM public.direct_hire_onboarding_sessions
         WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         LIMIT 1
       ) NOT IN ('queued', 'running') AS result;

-- 4.7 Verify business_representation exists and matches owner
SELECT 'Business representation lineage correct' AS check_name,
       (
         SELECT COUNT(*) FROM public.business_representations br
         WHERE br.id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
         AND br.user_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
       ) = 1 AS result;

-- 4.8 Verify website Evidence exists with correct scoping
SELECT 'Website Evidence exists (public_website + onboarding session scoped)' AS check_name,
       EXISTS (
         SELECT 1 FROM public.evidence e
         WHERE e.business_representation_id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
         AND e.source_type = 'public_website'
         AND e.direct_hire_onboarding_session_id = (
           SELECT id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
       ) AS result;

-- 4.9 Verify no active Formation lease exists
SELECT 'No active Formation lease exists' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM public.representation_formation_sessions
         WHERE business_representation_id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
         AND owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
         AND status IN ('initiated', 'getting_familiar', 'working_conversation_pending', 'working_conversation_linked')
       ) AS result;

-- 4.10 Verify no canonical Version exists
SELECT 'No canonical Version exists (current_version_id IS NULL)' AS check_name,
       (
         SELECT current_version_id IS NULL FROM public.business_representations
         WHERE id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
       ) AS result;

-- 4.11 Verify no existing Proposals
SELECT 'No existing Proposals for this representation' AS check_name,
       (
         SELECT COUNT(*) FROM public.representation_proposals
         WHERE business_representation_id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
       ) = 0 AS result;

-- 4.12 Verify no existing Approvals
SELECT 'No existing Approvals for this representation' AS check_name,
       (
         SELECT COUNT(*) FROM public.representation_approvals
         WHERE business_representation_id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
       ) = 0 AS result;

-- 4.13 Verify no existing Versions
SELECT 'No existing Versions for this representation' AS check_name,
       (
         SELECT COUNT(*) FROM public.representation_versions
         WHERE business_representation_id = (
           SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
       ) = 0 AS result;

-- ─────────────────────────────────────────────────────────────────────
-- PART 5: CROSS-OWNER LINEAGE SAFETY
-- ─────────────────────────────────────────────────────────────────────

-- 5.1 Verify no cross-owner Evidence linkage
SELECT 'No cross-owner Evidence linkage' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM public.evidence e
         INNER JOIN public.business_representations br ON e.business_representation_id = br.id
         WHERE e.direct_hire_onboarding_session_id = (
           SELECT id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
         AND br.user_id != 'da53cf7f-beb1-4168-a0cb-015610f092fc'
       ) AS result;

-- 5.2 Verify no cross-owner Observations linkage
SELECT 'No cross-owner Observations linkage' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM public.observations o
         INNER JOIN public.evidence e ON o.evidence_id = e.id
         INNER JOIN public.business_representations br ON e.business_representation_id = br.id
         WHERE e.direct_hire_onboarding_session_id = (
           SELECT id FROM public.direct_hire_onboarding_sessions
           WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
           LIMIT 1
         )
         AND br.user_id != 'da53cf7f-beb1-4168-a0cb-015610f092fc'
       ) AS result;

-- ─────────────────────────────────────────────────────────────────────
-- PART 6: DIAGNOSTIC COUNTS
-- ─────────────────────────────────────────────────────────────────────

-- 6.1 Count website Evidence for this Direct Hire session
SELECT 'Website Evidence count for onboarding session' AS check_name,
       COUNT(*) AS count
FROM public.evidence e
WHERE e.business_representation_id = (
  SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
  LIMIT 1
)
AND e.source_type = 'public_website'
AND e.direct_hire_onboarding_session_id = (
  SELECT id FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
  LIMIT 1
);

-- 6.2 Count Observations linked to website Evidence
SELECT 'Observations linked to website Evidence' AS check_name,
       COUNT(*) AS count
FROM public.observations o
INNER JOIN public.evidence e ON o.evidence_id = e.id
WHERE e.business_representation_id = (
  SELECT business_representation_id FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
  LIMIT 1
)
AND e.source_type = 'public_website'
AND e.direct_hire_onboarding_session_id = (
  SELECT id FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
  LIMIT 1
);

-- 6.3 Confirm no Formation is linked to onboarding session
SELECT 'Formation sessions linked to onboarding' AS check_name,
       COUNT(*) AS count
FROM public.representation_formation_sessions
WHERE id = (
  SELECT formation_session_id FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = 'da53cf7f-beb1-4168-a0cb-015610f092fc'
  LIMIT 1
);
