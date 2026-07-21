-- OPERATOR-INITIATED ROLLBACK — retained outside the forward migration path.
-- ═══════════════════════════════════════════════════════════════════════════════
-- ZEYA CANONICAL REPRESENTATION STATE ROLLBACK
-- Date: 2026-07-11
-- Purpose: Safely remove Representation State foundation
-- WARNING: This script is DESTRUCTIVE. Use only if you need to remove the foundation.
--          All data in Representation State tables will be lost.
--          Existing Zeya tables (businesses, sales_agents, etc.) are NOT affected.
-- Safety: Always back up the database before running this.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 1: CONFIRMATION
-- ──────────────────────────────────────────────────────────────────────────────

-- Confirm intent (uncomment to proceed)
-- TO PROCEED WITH ROLLBACK:
-- 1. Back up your database
-- 2. Uncomment the DO block below
-- 3. Run this script in Supabase SQL Editor
-- 4. Verify that all Representation State tables are removed
-- 5. Existing Zeya tables remain untouched

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║                   DESTRUCTIVE OPERATION WARNING                        ║';
  RAISE NOTICE '╠════════════════════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║ This script will DELETE all Representation State data:                 ║';
  RAISE NOTICE '║ - business_representations                                            ║';
  RAISE NOTICE '║ - representation_domains                                              ║';
  RAISE NOTICE '║ - representation_elements                                             ║';
  RAISE NOTICE '║ - evidence                                                            ║';
  RAISE NOTICE '║ - observations                                                        ║';
  RAISE NOTICE '║ - representation_proposals                                            ║';
  RAISE NOTICE '║ - approval_decisions                                                  ║';
  RAISE NOTICE '║ - representation_versions                                             ║';
  RAISE NOTICE '║ - confidence_assessments                                              ║';
  RAISE NOTICE '║ - audit_events                                                        ║';
  RAISE NOTICE '║                                                                       ║';
  RAISE NOTICE '║ Existing Zeya tables will NOT be affected.                            ║';
  RAISE NOTICE '║                                                                       ║';
  RAISE NOTICE '║ BACKUP YOUR DATABASE BEFORE PROCEEDING.                              ║';
  RAISE NOTICE '╚════════════════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 2: DROP TABLES (in dependency order, reverse of creation)
-- ──────────────────────────────────────────────────────────────────────────────

-- Drop audit_events (depends on business_representations, evidence, observations, proposals, versions, approvals)
DROP TABLE IF EXISTS audit_events CASCADE;

-- Drop confidence_assessments (depends on representation_versions)
DROP TABLE IF EXISTS confidence_assessments CASCADE;

-- Drop approval_decisions (depends on representation_proposals)
DROP TABLE IF EXISTS approval_decisions CASCADE;

-- Drop representation_versions (depends on business_representations, representation_proposals)
DROP TABLE IF EXISTS representation_versions CASCADE;

-- Drop representation_proposals (depends on business_representations)
DROP TABLE IF EXISTS representation_proposals CASCADE;

-- Drop observations (depends on business_representations, evidence)
DROP TABLE IF EXISTS observations CASCADE;

-- Drop evidence (depends on business_representations)
DROP TABLE IF EXISTS evidence CASCADE;

-- Drop representation_elements (depends on business_representations, representation_domains)
DROP TABLE IF EXISTS representation_elements CASCADE;

-- Drop representation_domains (depends on business_representations)
DROP TABLE IF EXISTS representation_domains CASCADE;

-- Drop business_representations (root entity)
DROP TABLE IF EXISTS business_representations CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 3: DROP FUNCTIONS (in dependency order)
-- ──────────────────────────────────────────────────────────────────────────────

-- Drop helper functions
DROP FUNCTION IF EXISTS get_agent_representation_context(UUID, TEXT);
DROP FUNCTION IF EXISTS get_agent_representation_context(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS compute_overall_phase(UUID);
DROP FUNCTION IF EXISTS initialize_business_representation(UUID, UUID);
DROP FUNCTION IF EXISTS zeya_purge_business_representation(UUID, UUID);

-- Drop auto-update trigger functions
DROP FUNCTION IF EXISTS update_representation_elements_updated_at();
DROP FUNCTION IF EXISTS update_representation_domains_updated_at();
DROP FUNCTION IF EXISTS update_business_representations_updated_at();

-- Drop immutability trigger functions
DROP FUNCTION IF EXISTS audit_events_prevent_modification();
DROP FUNCTION IF EXISTS confidence_assessments_prevent_modification();
DROP FUNCTION IF EXISTS representation_versions_prevent_modification();
DROP FUNCTION IF EXISTS evidence_prevent_modification();

-- Drop utility functions
DROP FUNCTION IF EXISTS calculate_record_hash(TEXT);

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 4: DROP ENUM TYPES
-- ──────────────────────────────────────────────────────────────────────────────

DROP TYPE IF EXISTS approval_decision_type CASCADE;
DROP TYPE IF EXISTS element_type CASCADE;
DROP TYPE IF EXISTS evidence_source_type CASCADE;
DROP TYPE IF EXISTS proposal_status CASCADE;
DROP TYPE IF EXISTS claim_eligibility_state CASCADE;
DROP TYPE IF EXISTS field_sensitivity_class CASCADE;
DROP TYPE IF EXISTS risk_tier CASCADE;
DROP TYPE IF EXISTS representation_phase CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 5: VERIFICATION
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_table_count INT := 0;
  v_type_count INT := 0;
BEGIN
  -- Count remaining Representation State tables (should be 0)
  SELECT COUNT(*) INTO v_table_count FROM pg_tables
  WHERE tablename IN (
    'business_representations', 'representation_domains', 'representation_elements',
    'evidence', 'observations', 'representation_proposals', 'approval_decisions',
    'representation_versions', 'confidence_assessments', 'audit_events'
  );

  -- Count remaining enum types (should be 0)
  SELECT COUNT(*) INTO v_type_count FROM pg_type
  WHERE typname IN (
    'representation_phase', 'risk_tier', 'field_sensitivity_class',
    'claim_eligibility_state', 'proposal_status', 'evidence_source_type',
    'element_type', 'approval_decision_type'
  );

  IF v_table_count = 0 AND v_type_count = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '✓ ROLLBACK SUCCESSFUL';
    RAISE NOTICE 'All Representation State tables and types have been removed.';
    RAISE NOTICE 'Existing Zeya tables remain intact.';
    RAISE NOTICE '';
  ELSE
    RAISE WARNING '';
    RAISE WARNING 'Rollback may be incomplete:';
    RAISE WARNING '  Remaining tables: %', v_table_count;
    RAISE WARNING '  Remaining types: %', v_type_count;
    RAISE WARNING 'Check database manually.';
    RAISE WARNING '';
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- END OF ROLLBACK SCRIPT
-- ──────────────────────────────────────────────────────────────────────────────
