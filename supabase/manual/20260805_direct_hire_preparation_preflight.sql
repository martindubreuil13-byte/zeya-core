-- DIRECT HIRE VERTICAL SLICE 2 — READ-ONLY PREFLIGHT
-- Expected project: hdjojgvvlojbhgidirht
-- This script performs no writes.

-- 1. Migration-history record.
-- This may be false when the previous migration was applied manually in the
-- SQL Editor. The schema-contract checks below are authoritative.
SELECT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260804000000'
) AS previous_migration_recorded;

-- 2. Required tables.
WITH required(object_name) AS (
  VALUES
    ('businesses'),
    ('business_representations'),
    ('direct_hire_onboarding_sessions'),
    ('evidence'),
    ('observations'),
    ('audit_events'),
    ('representation_versions'),
    ('representation_formation_sessions')
)
SELECT
  object_name,
  to_regclass('public.' || object_name) IS NOT NULL AS present
FROM required
ORDER BY object_name;
-- Expect every present value to be true.

-- 3. Required pre-Slice-2 columns.
WITH required(table_name, column_name) AS (
  VALUES
    ('direct_hire_onboarding_sessions', 'id'),
    ('direct_hire_onboarding_sessions', 'owner_id'),
    ('direct_hire_onboarding_sessions', 'business_id'),
    ('direct_hire_onboarding_sessions', 'business_representation_id'),
    ('direct_hire_onboarding_sessions', 'owner_relationship_name'),
    ('direct_hire_onboarding_sessions', 'website_url'),
    ('direct_hire_onboarding_sessions', 'phone_e164'),
    ('direct_hire_onboarding_sessions', 'growth_priority'),
    ('direct_hire_onboarding_sessions', 'onboarding_state'),
    ('direct_hire_onboarding_sessions', 'preparation_status'),
    ('direct_hire_onboarding_sessions', 'profile_completed_at'),
    ('evidence', 'business_representation_id'),
    ('evidence', 'source_type'),
    ('evidence', 'raw_statement'),
    ('evidence', 'statement_hash'),
    ('evidence', 'affected_domains'),
    ('evidence', 'captured_by_actor'),
    ('observations', 'business_representation_id'),
    ('observations', 'evidence_id'),
    ('observations', 'interpreted_meaning'),
    ('observations', 'confidence_in_interpretation'),
    ('observations', 'affected_domains'),
    ('observations', 'affected_elements'),
    ('observations', 'created_by_actor'),
    ('audit_events', 'business_representation_id'),
    ('audit_events', 'event_type'),
    ('audit_events', 'evidence_id'),
    ('audit_events', 'observation_id'),
    ('audit_events', 'actor_system'),
    ('audit_events', 'details')
)
SELECT
  required.table_name,
  required.column_name,
  columns.column_name IS NOT NULL AS present
FROM required
LEFT JOIN information_schema.columns AS columns
  ON columns.table_schema = 'public'
 AND columns.table_name = required.table_name
 AND columns.column_name = required.column_name
ORDER BY required.table_name, required.column_name;
-- Expect every present value to be true.

-- 4. Required existing enum and values.
SELECT enum_value.enumlabel
FROM pg_catalog.pg_enum AS enum_value
JOIN pg_catalog.pg_type AS enum_type
  ON enum_type.oid = enum_value.enumtypid
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = enum_type.typnamespace
WHERE namespace.nspname = 'public'
  AND enum_type.typname = 'evidence_source_type'
ORDER BY enum_value.enumsortorder;
-- Expect the existing values such as conversation, call_result, manual,
-- inference, system, and import.
-- Do not expect public_website yet.

-- 5. Previous Direct Hire RPC, policy, RLS, hash, and immutability contracts.
SELECT
  to_regprocedure(
    'public.zeya_upsert_direct_hire_profile(text,text,text,text,text)'
  ) IS NOT NULL AS profile_rpc_present,
  to_regprocedure(
    'public.zeya_set_evidence_statement_hash()'
  ) IS NOT NULL AS evidence_hash_function_present,
  to_regprocedure(
    'public.evidence_prevent_modification()'
  ) IS NOT NULL AS evidence_immutability_function_present;

SELECT
  row_security.relrowsecurity AS direct_hire_rls_enabled
FROM pg_catalog.pg_class AS row_security
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = row_security.relnamespace
WHERE namespace.nspname = 'public'
  AND row_security.relname = 'direct_hire_onboarding_sessions';
-- Expect true.

SELECT
  policyname,
  cmd,
  roles,
  qual
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename = 'direct_hire_onboarding_sessions';
-- Expect direct_hire_owner_select, SELECT, authenticated, owner_id = auth.uid().

SELECT
  has_table_privilege(
    'authenticated',
    'public.direct_hire_onboarding_sessions',
    'SELECT'
  ) AS authenticated_select,
  has_table_privilege(
    'authenticated',
    'public.direct_hire_onboarding_sessions',
    'INSERT'
  ) AS authenticated_insert,
  has_table_privilege(
    'authenticated',
    'public.direct_hire_onboarding_sessions',
    'UPDATE'
  ) AS authenticated_update,
  has_table_privilege(
    'authenticated',
    'public.direct_hire_onboarding_sessions',
    'DELETE'
  ) AS authenticated_delete;
-- Expect true, false, false, false.

SELECT
  trigger_name,
  event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND (
    (event_object_table = 'evidence'
      AND trigger_name IN (
        'evidence_prevent_modification_trigger',
        'zeya_set_evidence_statement_hash'
      ))
    OR
    (event_object_table = 'direct_hire_onboarding_sessions'
      AND trigger_name IN (
        'direct_hire_onboarding_validate_lineage',
        'direct_hire_onboarding_updated_at'
      ))
  )
ORDER BY event_object_table, trigger_name;
-- Expect all four existing trigger names.

-- 6. Required Audit event values.
SELECT
  constraint_name,
  pg_get_constraintdef(pg_constraint.oid) AS definition
FROM information_schema.table_constraints
JOIN pg_catalog.pg_constraint
  ON pg_constraint.conname = table_constraints.constraint_name
WHERE table_constraints.table_schema = 'public'
  AND table_constraints.table_name = 'audit_events'
  AND table_constraints.constraint_type = 'CHECK'
  AND pg_get_constraintdef(pg_constraint.oid) LIKE '%evidence_created%'
  AND pg_get_constraintdef(pg_constraint.oid) LIKE '%observation_created%';
-- Expect at least one row.

-- 7. Existing Direct Hire status constraint.
SELECT
  constraint_name,
  pg_get_constraintdef(pg_constraint.oid) AS definition
FROM information_schema.table_constraints
JOIN pg_catalog.pg_constraint
  ON pg_constraint.conname = table_constraints.constraint_name
WHERE table_constraints.table_schema = 'public'
  AND table_constraints.table_name = 'direct_hire_onboarding_sessions'
  AND table_constraints.constraint_name =
    'direct_hire_onboarding_sessions_preparation_status_check';
-- Expect one row whose definition permits only queued.

-- 8. Slice-2 enum value must not already exist.
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_enum AS enum_value
  JOIN pg_catalog.pg_type AS enum_type
    ON enum_type.oid = enum_value.enumtypid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = enum_type.typnamespace
  WHERE namespace.nspname = 'public'
    AND enum_type.typname = 'evidence_source_type'
    AND enum_value.enumlabel = 'public_website'
) AS public_website_already_exists;
-- Expect false.

-- 9. Slice-2 columns must not already exist.
WITH new_columns(table_name, column_name) AS (
  VALUES
    ('direct_hire_onboarding_sessions', 'research_authorized_at'),
    ('direct_hire_onboarding_sessions', 'profile_business_name'),
    ('direct_hire_onboarding_sessions', 'preparation_attempt_count'),
    ('direct_hire_onboarding_sessions', 'preparation_started_at'),
    ('direct_hire_onboarding_sessions', 'preparation_completed_at'),
    ('direct_hire_onboarding_sessions', 'preparation_failed_at'),
    ('direct_hire_onboarding_sessions', 'preparation_lease_id'),
    ('direct_hire_onboarding_sessions', 'preparation_lease_expires_at'),
    ('direct_hire_onboarding_sessions', 'preparation_failure_code'),
    ('direct_hire_onboarding_sessions', 'preparation_progress'),
    ('direct_hire_onboarding_sessions', 'preparation_successful_page_count'),
    ('direct_hire_onboarding_sessions', 'preparation_failed_page_count'),
    ('direct_hire_onboarding_sessions', 'preparation_extraction_version'),
    ('direct_hire_onboarding_sessions', 'preparation_last_retry_at'),
    ('evidence', 'direct_hire_onboarding_session_id'),
    ('evidence', 'website_source_key'),
    ('evidence', 'requested_source_url'),
    ('evidence', 'canonical_source_url'),
    ('evidence', 'source_retrieved_at'),
    ('evidence', 'source_content_hash'),
    ('evidence', 'source_page_type'),
    ('evidence', 'source_evidence_kind'),
    ('evidence', 'source_selector'),
    ('evidence', 'extraction_method_version'),
    ('observations', 'website_observation_key')
)
SELECT
  new_columns.table_name,
  new_columns.column_name
FROM new_columns
JOIN information_schema.columns AS columns
  ON columns.table_schema = 'public'
 AND columns.table_name = new_columns.table_name
 AND columns.column_name = new_columns.column_name
ORDER BY new_columns.table_name, new_columns.column_name;
-- Expect zero rows.

-- 10. Slice-2 functions must not already exist.
SELECT function_name
FROM (
  VALUES
    (
      'zeya_claim_direct_hire_preparation',
      to_regprocedure('public.zeya_claim_direct_hire_preparation()')
    ),
    (
      'zeya_finalize_direct_hire_preparation',
      to_regprocedure(
        'public.zeya_finalize_direct_hire_preparation(uuid,uuid,uuid,text,text,jsonb,smallint,smallint,jsonb,jsonb)'
      )
    ),
    (
      'zeya_direct_hire_profile_replay_guard',
      to_regprocedure('public.zeya_direct_hire_profile_replay_guard()')
    ),
    (
      'zeya_enforce_direct_hire_website_evidence_authority',
      to_regprocedure(
        'public.zeya_enforce_direct_hire_website_evidence_authority()'
      )
    ),
    (
      'zeya_enforce_direct_hire_website_observation_authority',
      to_regprocedure(
        'public.zeya_enforce_direct_hire_website_observation_authority()'
      )
    )
) AS functions(function_name, procedure_identifier)
WHERE procedure_identifier IS NOT NULL;
-- Expect zero rows.

-- 11. Slice-2 indexes and triggers must not already exist.
SELECT indexname
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'evidence_website_source_key_unique',
    'observations_website_key_unique'
  );
-- Expect zero rows.

SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'direct_hire_website_evidence_authority',
    'direct_hire_website_observation_authority',
    'direct_hire_profile_insert_guard',
    'direct_hire_profile_update_guard'
  );
-- Expect zero rows.

-- 12. Exactly one queued Direct Hire row.
SELECT
  count(*) AS direct_hire_row_count,
  count(*) FILTER (WHERE preparation_status = 'queued') AS queued_row_count,
  bool_and(preparation_status = 'queued') AS every_row_is_queued
FROM public.direct_hire_onboarding_sessions;
-- Expect: 1, 1, true.

-- 13. No Formation or canonical state for that Direct Hire Representation.
WITH current_session AS (
  SELECT business_representation_id
  FROM public.direct_hire_onboarding_sessions
)
SELECT
  (
    SELECT count(*)
    FROM public.representation_formation_sessions AS formation
    JOIN current_session
      ON current_session.business_representation_id =
         formation.business_representation_id
  ) AS formation_count,
  (
    SELECT count(*)
    FROM public.business_representations AS representation
    JOIN current_session
      ON current_session.business_representation_id = representation.id
    WHERE representation.current_version_id IS NOT NULL
  ) AS canonical_pointer_count,
  (
    SELECT count(*)
    FROM public.representation_versions AS version
    JOIN current_session
      ON current_session.business_representation_id =
         version.business_representation_id
  ) AS representation_version_count;
-- Expect: 0, 0, 0.
