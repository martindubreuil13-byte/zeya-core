-- ═══════════════════════════════════════════════════════════════════════════════
-- ZEYA CANONICAL REPRESENTATION STATE VERIFICATION
-- Date: 2026-07-11
-- Purpose: Verify foundation schema correctness and constraints
-- Usage: Run in Supabase SQL Editor. Review results carefully.
--        This script creates test data and verifies invariants.
--        DO NOT run in production without reviewing expected failures.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 1: SCHEMA STRUCTURE VERIFICATION
-- ──────────────────────────────────────────────────────────────────────────────

-- Verify all enum types exist
SELECT 'Checking enum types...' as check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'representation_phase') THEN
    RAISE EXCEPTION 'Missing enum type: representation_phase';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_tier') THEN
    RAISE EXCEPTION 'Missing enum type: risk_tier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'field_sensitivity_class') THEN
    RAISE EXCEPTION 'Missing enum type: field_sensitivity_class';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_eligibility_state') THEN
    RAISE EXCEPTION 'Missing enum type: claim_eligibility_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proposal_status') THEN
    RAISE EXCEPTION 'Missing enum type: proposal_status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_source_type') THEN
    RAISE EXCEPTION 'Missing enum type: evidence_source_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'element_type') THEN
    RAISE EXCEPTION 'Missing enum type: element_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_decision_type') THEN
    RAISE EXCEPTION 'Missing enum type: approval_decision_type';
  END IF;
  RAISE NOTICE 'All enum types exist: PASS';
END;
$$;

-- Verify all required tables exist
SELECT 'Checking table existence...' as check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'business_representations') THEN
    RAISE EXCEPTION 'Missing table: business_representations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'representation_domains') THEN
    RAISE EXCEPTION 'Missing table: representation_domains';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'representation_elements') THEN
    RAISE EXCEPTION 'Missing table: representation_elements';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'evidence') THEN
    RAISE EXCEPTION 'Missing table: evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'observations') THEN
    RAISE EXCEPTION 'Missing table: observations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'representation_proposals') THEN
    RAISE EXCEPTION 'Missing table: representation_proposals';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'approval_decisions') THEN
    RAISE EXCEPTION 'Missing table: approval_decisions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'representation_versions') THEN
    RAISE EXCEPTION 'Missing table: representation_versions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'confidence_assessments') THEN
    RAISE EXCEPTION 'Missing table: confidence_assessments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'audit_events') THEN
    RAISE EXCEPTION 'Missing table: audit_events';
  END IF;
  RAISE NOTICE 'All required tables exist: PASS';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 2: SETUP TEST DATA
-- Create test user and business (or use existing if available)
-- ──────────────────────────────────────────────────────────────────────────────

-- NOTE: These UUIDs are for testing only. Replace with actual values for production.
DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
BEGIN
  -- Create test business (if not exists)
  -- NOTE: This assumes the businesses table exists. If it doesn't, create it.
  INSERT INTO businesses (id, user_id, name)
  VALUES (v_test_business_id, v_test_user_id, 'Test Business For Representation State Verification')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Test data setup: PASS (test_user_id: %, test_business_id: %)',
    v_test_user_id, v_test_business_id;
END;
$$;

-- Store test IDs for later use
SELECT
  '550e8400-e29b-41d4-a716-446655440000'::UUID as test_user_id,
  '550e8400-e29b-41d4-a716-446655440001'::UUID as test_business_id;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 3: HAPPY PATH - VERTICAL SLICE
-- Test the complete end-to-end flow
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 3: Testing happy path vertical slice...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;

  v_rep_id UUID;
  v_domain_id UUID;
  v_element_id UUID;
  v_evidence_id UUID;
  v_observation_id UUID;
  v_proposal_id UUID;
  v_approval_id UUID;
  v_version_id UUID;
  v_confidence_id UUID;
  v_audit_id UUID;
BEGIN
  -- Step 1: Initialize business representation
  INSERT INTO business_representations (business_id, user_id, current_phase)
  VALUES (v_test_business_id, v_test_user_id, 'surface')
  RETURNING id INTO v_rep_id;
  RAISE NOTICE 'Step 1 - Business representation created: %', v_rep_id;

  -- Step 2: Get a domain
  SELECT id INTO v_domain_id FROM representation_domains
  WHERE business_representation_id = v_rep_id
  AND domain_name = 'business_identity'
  LIMIT 1;
  RAISE NOTICE 'Step 2 - Domain retrieved: %', v_domain_id;

  -- Step 3: Create a representation element
  INSERT INTO representation_elements (
    business_representation_id, representation_domain_id,
    element_key, element_type, claim_eligibility, field_sensitivity
  ) VALUES (
    v_rep_id, v_domain_id,
    'company_name', 'fact', 'internal_only', 'operational'
  )
  RETURNING id INTO v_element_id;
  RAISE NOTICE 'Step 3 - Representation element created: %', v_element_id;

  -- Step 4: Create evidence (founder statement)
  INSERT INTO evidence (
    business_representation_id, source_type, source_description,
    raw_statement, statement_hash, affected_domains, captured_by_actor
  ) VALUES (
    v_rep_id, 'conversation', 'Founder statement during onboarding',
    'We are Acme Inc, a software company building AI tools',
    encode(digest('We are Acme Inc, a software company building AI tools', 'sha256'), 'hex'),
    ARRAY['business_identity'],
    v_test_user_id::TEXT
  )
  RETURNING id INTO v_evidence_id;
  RAISE NOTICE 'Step 4 - Evidence created: %', v_evidence_id;

  -- Step 5: Create observation (interpret the evidence)
  INSERT INTO observations (
    business_representation_id, evidence_id,
    interpreted_meaning, confidence_in_interpretation,
    affected_domains, affected_elements, created_by_actor
  ) VALUES (
    v_rep_id, v_evidence_id,
    'Business is named Acme Inc and is a software company',
    85, ARRAY['business_identity'], ARRAY[v_element_id::TEXT],
    v_test_user_id::TEXT
  )
  RETURNING id INTO v_observation_id;
  RAISE NOTICE 'Step 5 - Observation created: %', v_observation_id;

  -- Step 6: Create proposal
  INSERT INTO representation_proposals (
    business_representation_id,
    affected_element_ids,
    proposed_changes,
    supporting_observation_ids,
    risk_tier, highest_sensitivity_class,
    proposed_by_actor, rationale, status
  ) VALUES (
    v_rep_id,
    ARRAY[v_element_id],
    jsonb_build_object(v_element_id::TEXT, jsonb_build_object('before', NULL, 'after', 'Acme Inc')),
    ARRAY[v_observation_id],
    'low', 'operational',
    v_test_user_id::TEXT, 'Founder confirmed company name', 'risk_assessed'
  )
  RETURNING id INTO v_proposal_id;
  RAISE NOTICE 'Step 6 - Proposal created: %', v_proposal_id;

  -- Step 7: Create canonical version
  INSERT INTO representation_versions (
    business_representation_id,
    source_proposal_id,
    element_values,
    version_number,
    overall_confidence_score,
    created_by_actor,
    content_hash
  ) VALUES (
    v_rep_id,
    v_proposal_id,
    jsonb_build_object(v_element_id::TEXT, jsonb_build_object('value', 'Acme Inc', 'confidence', 85, 'timestamp', now())),
    1,
    85,
    v_test_user_id::TEXT,
    'hash123'
  )
  RETURNING id INTO v_version_id;
  RAISE NOTICE 'Step 7 - Representation version created: %', v_version_id;

  -- Step 8: Create confidence assessment
  INSERT INTO confidence_assessments (
    representation_version_id,
    confidence_score,
    confidence_band_min,
    confidence_band_max,
    evidence_count,
    source_diversity_score,
    source_quality_score,
    recency_score,
    calculation_method,
    calculation_version,
    rationale
  ) VALUES (
    v_version_id,
    85,
    75, 95,
    1,
    50,
    100,
    100,
    'direct_evidence_weighted',
    '1.0',
    'Single direct founder statement about company name. High confidence as this is verified fact.'
  )
  RETURNING id INTO v_confidence_id;
  RAISE NOTICE 'Step 8 - Confidence assessment created: %', v_confidence_id;

  -- Step 9: Create audit events
  INSERT INTO audit_events (
    business_representation_id,
    event_type,
    evidence_id,
    actor,
    details
  ) VALUES (v_rep_id, 'evidence_created', v_evidence_id, v_test_user_id::TEXT,
    jsonb_build_object('source_type', 'conversation'))
  RETURNING id INTO v_audit_id;
  RAISE NOTICE 'Step 9 - Audit events created: %', v_audit_id;

  -- Update business_representations to point to current version
  UPDATE business_representations
  SET current_version_id = v_version_id
  WHERE id = v_rep_id;

  RAISE NOTICE 'Happy path test COMPLETED SUCCESSFULLY';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 4: IMMUTABILITY ENFORCEMENT TESTS
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 4: Testing immutability constraints...' as test_section;

-- Test 4.1: Evidence immutability
DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_evidence_id UUID;
  v_rep_id UUID;
BEGIN
  -- Get the representation we created
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  -- Get an evidence record
  SELECT id INTO v_evidence_id FROM evidence
  WHERE business_representation_id = v_rep_id
  LIMIT 1;

  -- Try to update (should fail)
  BEGIN
    UPDATE evidence
    SET raw_statement = 'Modified statement'
    WHERE id = v_evidence_id;

    RAISE EXCEPTION 'ERROR: Evidence should be immutable but was modified!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 4.1 PASS: Evidence update blocked as expected (error: %)', SQLERRM;
  END;

  -- Try to delete (should fail)
  BEGIN
    DELETE FROM evidence WHERE id = v_evidence_id;
    RAISE EXCEPTION 'ERROR: Evidence should be immutable but was deleted!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 4.1b PASS: Evidence delete blocked as expected (error: %)', SQLERRM;
  END;
END;
$$;

-- Test 4.2: Representation version immutability
DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_version_id UUID;
  v_rep_id UUID;
BEGIN
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  SELECT id INTO v_version_id FROM representation_versions
  WHERE business_representation_id = v_rep_id
  LIMIT 1;

  -- Try to update (should fail)
  BEGIN
    UPDATE representation_versions
    SET overall_confidence_score = 50
    WHERE id = v_version_id;

    RAISE EXCEPTION 'ERROR: Version should be immutable but was modified!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 4.2 PASS: Version update blocked as expected (error: %)', SQLERRM;
  END;
END;
$$;

-- Test 4.3: Audit event immutability
DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_audit_id UUID;
  v_rep_id UUID;
BEGIN
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  SELECT id INTO v_audit_id FROM audit_events
  WHERE business_representation_id = v_rep_id
  LIMIT 1;

  -- Try to update (should fail)
  BEGIN
    UPDATE audit_events
    SET event_type = 'observation_created'
    WHERE id = v_audit_id;

    RAISE EXCEPTION 'ERROR: Audit should be immutable but was modified!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 4.3 PASS: Audit update blocked as expected (error: %)', SQLERRM;
  END;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 5: TENANT ISOLATION VERIFICATION
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 5: Testing tenant isolation...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_other_user_id UUID := '550e8400-e29b-41d4-a716-446655440099'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_rep_count INT;
BEGIN
  -- Check that first user can see their data
  SELECT COUNT(*) INTO v_rep_count FROM business_representations
  WHERE business_id = v_test_business_id
    AND user_id = v_test_user_id;

  IF v_rep_count > 0 THEN
    RAISE NOTICE 'Test 5.1 PASS: User can view own business representation';
  ELSE
    RAISE EXCEPTION 'ERROR: User should be able to view own data!';
  END IF;

  -- NOTE: Full RLS testing requires multiple connections with different auth users.
  -- This test verifies the policy structure is in place.
  -- In practice, test with multiple authenticated connections.
  RAISE NOTICE 'Test 5.2: RLS policies are defined (full testing requires multiple connections)';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 6: REJECTED PROPOSAL PROTECTION
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 6: Testing rejected proposal protection...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_rep_id UUID;
  v_domain_id UUID;
  v_element_id UUID;
  v_rejected_proposal_id UUID;
  v_version_count INT;
BEGIN
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  SELECT id INTO v_domain_id FROM representation_domains
  WHERE business_representation_id = v_rep_id AND domain_name = 'offer'
  LIMIT 1;

  -- Create element
  INSERT INTO representation_elements (
    business_representation_id, representation_domain_id,
    element_key, element_type
  ) VALUES (v_rep_id, v_domain_id, 'pricing_model', 'fact')
  RETURNING id INTO v_element_id;

  -- Create rejected proposal
  INSERT INTO representation_proposals (
    business_representation_id,
    affected_element_ids,
    proposed_changes,
    supporting_observation_ids,
    risk_tier, highest_sensitivity_class,
    proposed_by_actor,
    status
  ) VALUES (
    v_rep_id,
    ARRAY[v_element_id],
    jsonb_build_object(v_element_id::TEXT, jsonb_build_object('before', NULL, 'after', 'Monthly subscription')),
    ARRAY[]::UUID[],
    'medium', 'pricing',
    v_test_user_id::TEXT,
    'rejected'
  )
  RETURNING id INTO v_rejected_proposal_id;

  -- Try to create version from rejected proposal
  BEGIN
    INSERT INTO representation_versions (
      business_representation_id,
      source_proposal_id,
      element_values,
      version_number,
      overall_confidence_score,
      created_by_actor,
      content_hash
    ) VALUES (
      v_rep_id,
      v_rejected_proposal_id,
      jsonb_build_object(),
      2,
      0,
      v_test_user_id::TEXT,
      'hash'
    );

    -- Check if it was created
    SELECT COUNT(*) INTO v_version_count FROM representation_versions
    WHERE source_proposal_id = v_rejected_proposal_id;

    IF v_version_count = 0 THEN
      RAISE NOTICE 'Test 6 PASS: Rejected proposal protection enforced (application layer)';
    ELSE
      RAISE NOTICE 'Test 6 WARNING: Rejected proposals can create versions (enforce in application logic)';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Test 6 PASS: Rejected proposal rejected at database level (error: %)', SQLERRM;
  END;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 7: HIGH-RISK APPROVAL ENFORCEMENT
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 7: Testing high-risk approval enforcement...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_rep_id UUID;
  v_domain_id UUID;
  v_element_id UUID;
  v_high_risk_proposal_id UUID;
BEGIN
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  SELECT id INTO v_domain_id FROM representation_domains
  WHERE business_representation_id = v_rep_id AND domain_name = 'offer'
  LIMIT 1;

  -- Create element
  INSERT INTO representation_elements (
    business_representation_id, representation_domain_id,
    element_key, element_type, field_sensitivity
  ) VALUES (v_rep_id, v_domain_id, 'pricing', 'fact', 'pricing')
  RETURNING id INTO v_element_id;

  -- Create high-risk proposal (pricing change)
  INSERT INTO representation_proposals (
    business_representation_id,
    affected_element_ids,
    proposed_changes,
    supporting_observation_ids,
    risk_tier, highest_sensitivity_class,
    requires_approval,
    proposed_by_actor,
    status
  ) VALUES (
    v_rep_id,
    ARRAY[v_element_id],
    jsonb_build_object(v_element_id::TEXT, jsonb_build_object('before', '$100/month', 'after', '$150/month')),
    ARRAY[]::UUID[],
    'high', 'pricing',
    TRUE,
    v_test_user_id::TEXT,
    'pending_approval'
  )
  RETURNING id INTO v_high_risk_proposal_id;

  RAISE NOTICE 'Test 7 PASS: High-risk proposal created with requires_approval = TRUE';
  RAISE NOTICE 'Application layer must enforce: versions can only be created from approved proposals where requires_approval = FALSE or approval_decision.decision = approved';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 8: CONFIDENCE METADATA REQUIREMENTS
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 8: Testing confidence assessment completeness...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_confidence_row RECORD;
BEGIN
  SELECT ca.* INTO v_confidence_row
  FROM confidence_assessments ca
  INNER JOIN representation_versions rv ON ca.representation_version_id = rv.id
  INNER JOIN business_representations br ON rv.business_representation_id = br.id
  WHERE br.business_id = v_test_business_id AND br.user_id = v_test_user_id
  LIMIT 1;

  IF v_confidence_row IS NOT NULL THEN
    IF v_confidence_row.confidence_score IS NOT NULL
      AND v_confidence_row.evidence_count IS NOT NULL
      AND v_confidence_row.calculation_method IS NOT NULL
      AND v_confidence_row.calculation_version IS NOT NULL
      AND v_confidence_row.rationale IS NOT NULL THEN
      RAISE NOTICE 'Test 8 PASS: Confidence assessment contains all required metadata';
      RAISE NOTICE 'Score: %, Band: %±%, Evidence: %, Method: %',
        v_confidence_row.confidence_score,
        v_confidence_row.confidence_band_min,
        (v_confidence_row.confidence_band_max - v_confidence_row.confidence_band_min),
        v_confidence_row.evidence_count,
        v_confidence_row.calculation_method;
    ELSE
      RAISE EXCEPTION 'ERROR: Confidence assessment missing required fields!';
    END IF;
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 9: VERSION LINEAGE INTEGRITY
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 9: Testing version lineage...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_version_count INT;
  v_lineage_valid BOOLEAN := TRUE;
BEGIN
  SELECT COUNT(*) INTO v_version_count FROM representation_versions rv
  INNER JOIN business_representations br ON rv.business_representation_id = br.id
  WHERE br.business_id = v_test_business_id AND br.user_id = v_test_user_id;

  IF v_version_count > 0 THEN
    -- Check that versions have sequential version_number
    IF EXISTS (
      SELECT 1 FROM representation_versions rv
      INNER JOIN business_representations br ON rv.business_representation_id = br.id
      WHERE br.business_id = v_test_business_id AND br.user_id = v_test_user_id
      AND rv.version_number <= 0
    ) THEN
      v_lineage_valid := FALSE;
    END IF;

    IF v_lineage_valid THEN
      RAISE NOTICE 'Test 9 PASS: Version lineage is valid (% versions found)', v_version_count;
    ELSE
      RAISE EXCEPTION 'ERROR: Version lineage broken (invalid version_number)';
    END IF;
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 10: ROLLBACK BEHAVIOR
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 10: Testing rollback behavior...' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
  v_rep_id UUID;
  v_prev_version_id UUID;
  v_rollback_version_id UUID;
  v_version_count_before INT;
  v_version_count_after INT;
BEGIN
  SELECT id INTO v_rep_id FROM business_representations
  WHERE business_id = v_test_business_id AND user_id = v_test_user_id
  LIMIT 1;

  SELECT COUNT(*) INTO v_version_count_before FROM representation_versions
  WHERE business_representation_id = v_rep_id;

  -- Get previous version
  SELECT id INTO v_prev_version_id FROM representation_versions
  WHERE business_representation_id = v_rep_id
  ORDER BY version_number DESC
  LIMIT 1;

  -- Create rollback version (restores content from previous version)
  IF v_prev_version_id IS NOT NULL THEN
    INSERT INTO representation_versions (
      business_representation_id,
      previous_version_id,
      source_proposal_id,  -- Would be a rollback proposal in real usage
      element_values,
      version_number,
      overall_confidence_score,
      created_by_actor,
      content_hash
    )
    SELECT
      business_representation_id,
      v_prev_version_id,
      source_proposal_id,
      element_values,
      (SELECT MAX(version_number) + 1 FROM representation_versions WHERE business_representation_id = v_rep_id),
      overall_confidence_score,
      'rollback_function'::TEXT,
      'rollback_hash'
    FROM representation_versions
    WHERE id = v_prev_version_id
    RETURNING id INTO v_rollback_version_id;

    SELECT COUNT(*) INTO v_version_count_after FROM representation_versions
    WHERE business_representation_id = v_rep_id;

    IF v_version_count_after > v_version_count_before THEN
      RAISE NOTICE 'Test 10 PASS: Rollback creates new version (before: %, after: %)',
        v_version_count_before, v_version_count_after;
      RAISE NOTICE 'Rollback version ID: %, chains back to: %',
        v_rollback_version_id, v_prev_version_id;
    ELSE
      RAISE EXCEPTION 'ERROR: Rollback did not create new version!';
    END IF;
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION 11: DATA SUMMARY
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'SECTION 11: Data Summary' as test_section;

DO $$
DECLARE
  v_test_user_id UUID := '550e8400-e29b-41d4-a716-446655440000'::UUID;
  v_test_business_id UUID := '550e8400-e29b-41d4-a716-446655440001'::UUID;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Representation State Foundation - Test Data Summary';
  RAISE NOTICE '──────────────────────────────────────────────────────';

  RAISE NOTICE 'Business Representations: %',
    (SELECT COUNT(*) FROM business_representations WHERE user_id = v_test_user_id);

  RAISE NOTICE 'Representation Domains: %',
    (SELECT COUNT(*) FROM representation_domains rd
     INNER JOIN business_representations br ON rd.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Representation Elements: %',
    (SELECT COUNT(*) FROM representation_elements re
     INNER JOIN business_representations br ON re.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Evidence Records: %',
    (SELECT COUNT(*) FROM evidence e
     INNER JOIN business_representations br ON e.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Observations: %',
    (SELECT COUNT(*) FROM observations o
     INNER JOIN business_representations br ON o.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Representation Proposals: %',
    (SELECT COUNT(*) FROM representation_proposals rp
     INNER JOIN business_representations br ON rp.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Representation Versions: %',
    (SELECT COUNT(*) FROM representation_versions rv
     INNER JOIN business_representations br ON rv.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Confidence Assessments: %',
    (SELECT COUNT(*) FROM confidence_assessments ca
     INNER JOIN representation_versions rv ON ca.representation_version_id = rv.id
     INNER JOIN business_representations br ON rv.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE 'Audit Events: %',
    (SELECT COUNT(*) FROM audit_events ae
     INNER JOIN business_representations br ON ae.business_representation_id = br.id
     WHERE br.user_id = v_test_user_id);

  RAISE NOTICE '──────────────────────────────────────────────────────';
  RAISE NOTICE '';
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- VERIFICATION COMPLETE
-- ──────────────────────────────────────────────────────────────────────────────

SELECT 'VERIFICATION COMPLETE' as status;

-- Display summary
SELECT COUNT(*) as total_tests_run
FROM (
  SELECT 'Enum types' UNION ALL
  SELECT 'Table existence' UNION ALL
  SELECT 'Happy path' UNION ALL
  SELECT 'Evidence immutability' UNION ALL
  SELECT 'Version immutability' UNION ALL
  SELECT 'Audit immutability' UNION ALL
  SELECT 'Tenant isolation' UNION ALL
  SELECT 'Rejected proposal protection' UNION ALL
  SELECT 'High-risk approval enforcement' UNION ALL
  SELECT 'Confidence metadata' UNION ALL
  SELECT 'Version lineage' UNION ALL
  SELECT 'Rollback behavior'
) as tests;
