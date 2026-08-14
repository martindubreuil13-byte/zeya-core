-- ZEYA Formation P1 stabilization — strictly read-only post-migration check
-- Target migration: supabase/migrations/20260806000000_formation_p1_stabilization.sql
-- Run manually against Preview only. This file performs no writes.

-- 1. Compact contract and data-integrity summary.
-- Expected: exactly one row with postcheck_pass = true. Current Version and
-- canonical-pointer counts are informational and must equal the counts recorded
-- by the pre-migration preflight; PostgreSQL does not retain historical counts.
WITH expected_columns(table_name, column_name) AS (
  VALUES
    ('representation_proposals', 'formation_session_id'),
    ('evidence', 'source_formation_session_id'),
    ('evidence', 'source_formation_proposal_id'),
    ('evidence', 'source_correction_request_key')
), column_status AS (
  SELECT count(*) FILTER (
    WHERE actual.column_name = 'formation_session_id'
  ) AS proposal_lineage_columns_present,
  count(*) FILTER (
    WHERE actual.table_name = 'evidence'
  ) AS correction_lineage_columns_present
  FROM expected_columns AS expected
  LEFT JOIN information_schema.columns AS actual
    ON actual.table_schema = 'public'
   AND actual.table_name = expected.table_name
   AND actual.column_name = expected.column_name
), constraint_status AS (
  SELECT count(*) AS correction_lineage_constraints_present
  FROM pg_catalog.pg_constraint AS constraint_record
  JOIN pg_catalog.pg_class AS table_class ON table_class.oid = constraint_record.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_class.relname = 'evidence'
    AND constraint_record.conname = 'evidence_formation_correction_lineage_complete'
    AND constraint_record.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_formation_session_id IS NULL%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_formation_proposal_id IS NULL%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_correction_request_key IS NULL%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_formation_session_id IS NOT NULL%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_formation_proposal_id IS NOT NULL%'
    AND pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ILIKE '%source_correction_request_key IS NOT NULL%'
), index_status AS (
  SELECT count(*) FILTER (
    WHERE index_class.relname = 'representation_proposals_one_draft_formation_idx'
      AND index_record.indisunique
      AND index_record.indpred IS NOT NULL
      AND pg_catalog.pg_get_indexdef(index_record.indexrelid)
        ILIKE '%(formation_session_id)%'
      AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
        ILIKE '%formation_session_id IS NOT NULL%'
      AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
        ILIKE '%status = ''draft''%'
  ) AS draft_summary_unique_indexes_present,
  count(*) FILTER (
    WHERE index_class.relname = 'evidence_formation_correction_request_idx'
      AND index_record.indisunique
      AND index_record.indpred IS NOT NULL
      AND pg_catalog.pg_get_indexdef(index_record.indexrelid)
        ILIKE '%(source_formation_session_id, source_correction_request_key)%'
      AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
        ILIKE '%source_formation_session_id IS NOT NULL%'
      AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
        ILIKE '%source_correction_request_key IS NOT NULL%'
  ) AS correction_request_unique_indexes_present
  FROM pg_catalog.pg_index AS index_record
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_record.indexrelid
  JOIN pg_catalog.pg_class AS table_class ON table_class.oid = index_record.indrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND index_class.relname IN (
      'representation_proposals_one_draft_formation_idx',
      'evidence_formation_correction_request_idx'
    )
), linkage_function AS (
  SELECT procedure.*
  FROM (VALUES (
    pg_catalog.to_regprocedure(
      'public.zeya_link_formation_conversation(uuid,uuid,uuid,text)'
    )
  )) AS expected(oid)
  LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = expected.oid
), correction_function AS (
  SELECT procedure.*
  FROM (VALUES (
    pg_catalog.to_regprocedure(
      'public.zeya_record_formation_owner_correction(uuid,uuid,uuid,uuid,text)'
    )
  )) AS expected(oid)
  LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = expected.oid
), function_contracts AS (
  SELECT
    linkage.oid IS NOT NULL
      AND linkage.prosecdef
      AND linkage.proconfig @> ARRAY['search_path=""']::text[]
      AND linkage.proallargtypes[5] = 'uuid'::pg_catalog.regtype::pg_catalog.oid
      AND linkage.proallargtypes[6] = 'uuid'::pg_catalog.regtype::pg_catalog.oid
      AND linkage.proallargtypes[7]
        = 'public.formation_session_status'::pg_catalog.regtype::pg_catalog.oid
      AND linkage.proallargtypes[8]
        = 'timestamptz'::pg_catalog.regtype::pg_catalog.oid
      AND linkage.proargnames[5:8] = ARRAY[
        'session_id', 'business_representation_id', 'status', 'linked_at'
      ]::text[]
      AS linkage_contract_valid,
    correction.oid IS NOT NULL
      AND correction.prosecdef
      AND correction.proconfig @> ARRAY['search_path=""']::text[]
      AND correction.proallargtypes[6] = 'uuid'::pg_catalog.regtype::pg_catalog.oid
      AND correction.proallargtypes[7] = 'boolean'::pg_catalog.regtype::pg_catalog.oid
      AND correction.proargnames[6:7] = ARRAY['evidence_id', 'replayed']::text[]
      AS correction_contract_valid
  FROM linkage_function AS linkage
  CROSS JOIN correction_function AS correction
), function_acl_status AS (
  SELECT
    pg_catalog.has_function_privilege('service_role', linkage.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', linkage.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', linkage.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(linkage.proacl, pg_catalog.acldefault('f', linkage.proowner))
        ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND acl.grantee NOT IN (
            linkage.proowner,
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'service_role')
          )
      ) AS linkage_service_role_only_execute,
    pg_catalog.has_function_privilege('service_role', correction.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', correction.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', correction.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(correction.proacl, pg_catalog.acldefault('f', correction.proowner))
        ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND acl.grantee NOT IN (
            correction.proowner,
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'service_role')
          )
      ) AS correction_service_role_only_execute
  FROM linkage_function AS linkage
  CROSS JOIN correction_function AS correction
), rls_status AS (
  SELECT count(*) FILTER (WHERE table_class.relrowsecurity) AS protected_tables,
    count(*) AS inspected_tables
  FROM pg_catalog.pg_class AS table_class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_class.relname IN (
      'representation_formation_sessions',
      'representation_proposals',
      'evidence',
      'representation_versions'
    )
), immutability_status AS (
  SELECT count(*) FILTER (
    WHERE trigger.tgenabled <> 'D'
  ) AS enabled_immutability_triggers
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS table_class ON table_class.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND NOT trigger.tgisinternal
    AND (
      (table_class.relname = 'evidence'
        AND trigger.tgname = 'evidence_prevent_modification_trigger')
      OR
      (table_class.relname = 'representation_versions'
        AND trigger.tgname = 'representation_versions_prevent_modification_trigger')
    )
), duplicate_draft_summaries AS (
  SELECT count(*) AS duplicate_group_count
  FROM (
    SELECT formation_session_id
    FROM public.representation_proposals
    WHERE formation_session_id IS NOT NULL AND status = 'draft'
    GROUP BY formation_session_id
    HAVING count(*) > 1
  ) AS duplicates
), duplicate_correction_requests AS (
  SELECT count(*) AS duplicate_group_count
  FROM (
    SELECT source_formation_session_id, source_correction_request_key
    FROM public.evidence
    WHERE source_formation_session_id IS NOT NULL
      AND source_correction_request_key IS NOT NULL
    GROUP BY source_formation_session_id, source_correction_request_key
    HAVING count(*) > 1
  ) AS duplicates
), unexpected_source_enums AS (
  SELECT count(*) AS unexpected_count
  FROM pg_catalog.pg_enum AS enum_value
  JOIN pg_catalog.pg_type AS type ON type.oid = enum_value.enumtypid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = 'public'
    AND type.typname = 'evidence_source_type'
    AND enum_value.enumlabel IN (
      'formation', 'formation_correction',
      'direct_hire_formation', 'direct_hire_correction'
    )
), migration_history AS (
  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260806000000'
  ) AS recorded
), current_counts AS (
  SELECT
    (SELECT count(*) FROM public.representation_formation_sessions)
      AS current_formation_count,
    (SELECT count(*) FROM public.representation_proposals)
      AS current_proposal_count,
    (SELECT count(*) FROM public.evidence) AS current_evidence_count,
    (SELECT count(*) FROM public.representation_versions) AS current_version_count,
    (SELECT count(*) FROM public.business_representations
      WHERE current_version_id IS NOT NULL) AS current_canonical_pointer_count
), summary AS (
  SELECT column_status.proposal_lineage_columns_present,
    column_status.correction_lineage_columns_present,
    constraint_status.correction_lineage_constraints_present,
    index_status.draft_summary_unique_indexes_present,
    index_status.correction_request_unique_indexes_present,
    function_contracts.linkage_contract_valid,
    function_contracts.correction_contract_valid,
    function_acl_status.linkage_service_role_only_execute,
    function_acl_status.correction_service_role_only_execute,
    rls_status.protected_tables AS rls_protected_tables,
    rls_status.inspected_tables AS rls_inspected_tables,
    immutability_status.enabled_immutability_triggers,
    duplicate_draft_summaries.duplicate_group_count
      AS duplicate_draft_summary_groups,
    duplicate_correction_requests.duplicate_group_count
      AS duplicate_correction_request_groups,
    unexpected_source_enums.unexpected_count AS unexpected_formation_source_enums,
    migration_history.recorded AS migration_history_recorded_non_authoritative,
    current_counts.*
  FROM column_status
  CROSS JOIN constraint_status
  CROSS JOIN index_status
  CROSS JOIN function_contracts
  CROSS JOIN function_acl_status
  CROSS JOIN rls_status
  CROSS JOIN immutability_status
  CROSS JOIN duplicate_draft_summaries
  CROSS JOIN duplicate_correction_requests
  CROSS JOIN unexpected_source_enums
  CROSS JOIN migration_history
  CROSS JOIN current_counts
)
SELECT summary.*,
  proposal_lineage_columns_present = 1
    AND correction_lineage_columns_present = 3
    AND correction_lineage_constraints_present = 1
    AND draft_summary_unique_indexes_present = 1
    AND correction_request_unique_indexes_present = 1
    AND linkage_contract_valid
    AND correction_contract_valid
    AND linkage_service_role_only_execute
    AND correction_service_role_only_execute
    AND rls_protected_tables = rls_inspected_tables
    AND rls_inspected_tables = 4
    AND enabled_immutability_triggers = 2
    AND duplicate_draft_summary_groups = 0
    AND duplicate_correction_request_groups = 0
    AND unexpected_formation_source_enums = 0
    AS postcheck_pass
FROM summary;

-- 2. Exact P1 indexes and predicates.
-- Expected: two unique partial indexes with the predicates defined by P1.
SELECT index_class.relname AS index_name,
  index_record.indisunique AS is_unique,
  pg_catalog.pg_get_indexdef(index_record.indexrelid) AS index_definition,
  pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid) AS predicate
FROM pg_catalog.pg_index AS index_record
JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_record.indexrelid
JOIN pg_catalog.pg_class AS table_class ON table_class.oid = index_record.indrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
WHERE namespace.nspname = 'public'
  AND index_class.relname IN (
    'representation_proposals_one_draft_formation_idx',
    'evidence_formation_correction_request_idx'
  )
ORDER BY index_class.relname;

-- 3. Exact P1 function definitions and ACLs for manual review.
-- Expected: two rows; both SECURITY DEFINER with search_path="". Only the
-- function owner and service_role may have EXECUTE.
WITH inspected_functions(function_oid) AS (
  VALUES
    (pg_catalog.to_regprocedure(
      'public.zeya_link_formation_conversation(uuid,uuid,uuid,text)')),
    (pg_catalog.to_regprocedure(
      'public.zeya_record_formation_owner_correction(uuid,uuid,uuid,uuid,text)'))
)
SELECT procedure.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(procedure.oid) AS return_type,
  procedure.prosecdef AS security_definer,
  procedure.proconfig AS function_settings,
  procedure.proacl AS access_control_list
FROM inspected_functions
LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = inspected_functions.function_oid
ORDER BY procedure.proname;

-- 4. Canonical-state counts for comparison with the pre-migration preflight.
-- Expected: representation_versions and canonical_pointers exactly equal their
-- recorded preflight values. This migration contains no Version insert/update
-- and no business_representations.current_version_id update.
SELECT
  (SELECT count(*) FROM public.representation_formation_sessions) AS formations,
  (SELECT count(*) FROM public.representation_proposals) AS proposals,
  (SELECT count(*) FROM public.evidence) AS evidence,
  (SELECT count(*) FROM public.representation_versions) AS representation_versions,
  (SELECT count(*) FROM public.business_representations
    WHERE current_version_id IS NOT NULL) AS canonical_pointers;

-- 5. Existing Direct Hire and Public Experience structures, informational only.
-- Expected: compare with their already-validated pre-P1 inventory. P1 adds no
-- Direct Hire or Public Experience object, and its migration contains no such DDL.
SELECT table_name, count(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name = 'direct_hire_onboarding'
    OR table_name LIKE 'public_experience%'
    OR table_name LIKE 'representation_brief%'
  )
GROUP BY table_name
ORDER BY table_name;

-- 6. Migration ledger status, informational and non-authoritative.
-- Expected after manual SQL Editor application: possibly zero rows. Absence does
-- not mean the migration failed because manual execution may not update the ledger.
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version = '20260806000000';
