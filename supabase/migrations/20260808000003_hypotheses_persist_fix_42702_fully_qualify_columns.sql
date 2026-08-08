-- CRITICAL Corrective Migration: Fix PostgreSQL 42702 by fully qualifying ALL table column references
--
-- Root Cause: In PL/pgSQL RETURNS TABLE functions, output column names become local variables.
-- Unqualified references to table columns with the same name as output variables cause ERROR 42702.
--
-- Example:
--   RETURNS TABLE (hypothesis_version BIGINT, ...)
--   SELECT MAX(hypothesis_version) FROM hypotheses
--   ↑ PostgreSQL ERROR 42702: ambiguous - which hypothesis_version?
--
-- Solution: Qualify ALL table column references with explicit table aliases.
--
-- Collision detected:
--   hypothesis_version (output variable) ↔ hypotheses.hypothesis_version (column)
--   created_at (output variable) ↔ hypotheses.created_at (column)

CREATE OR REPLACE FUNCTION public.zeya_persist_hypothesis(
  p_owner_id UUID,
  p_onboarding_session_id UUID,
  p_constitutional_domain VARCHAR(50),
  p_epistemic_state VARCHAR(20),
  p_current_belief TEXT,
  p_confidence VARCHAR(10),
  p_representation_risk VARCHAR(10),
  p_risk_reason TEXT,
  p_source_evidence_ids UUID[],
  p_evidence_cutoff_at TIMESTAMP WITH TIME ZONE,
  p_request_trace_id VARCHAR(64),
  p_created_by_actor TEXT DEFAULT 'zeya_reasoning_service'
)
RETURNS TABLE (
  hypothesis_id UUID,
  hypothesis_version BIGINT,
  is_idempotent_return BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_business_id UUID;
  v_business_representation_id UUID;
  v_existing_hypothesis public.hypotheses%ROWTYPE;
  v_next_version BIGINT;
  v_predecessor_id UUID;
  v_new_hypothesis_id UUID;
BEGIN
  -- Verify service-role access only
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'zeya_persist_hypothesis requires service-role access' USING ERRCODE = '42501';
  END IF;

  -- Load and validate onboarding session (with lock for atomic version allocation)
  SELECT * INTO v_session
  FROM public.direct_hire_onboarding_sessions
  WHERE id = p_onboarding_session_id AND owner_id = p_owner_id
  FOR UPDATE;
  -- ^ Lock the session row to serialize all domain calculations

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onboarding session not found or ownership mismatch';
  END IF;

  v_business_id := v_session.business_id;
  v_business_representation_id := v_session.business_representation_id;

  -- Validate tenant isolation
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = v_business_id AND user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'Business ownership mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_representations
    WHERE id = v_business_representation_id AND business_id = v_business_id AND user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'Business representation ownership mismatch';
  END IF;

  -- Validate input parameters
  IF p_constitutional_domain NOT IN (
    'whatYouSell', 'whoItIsFor', 'problemOrAspiration', 'whyCustomersShouldCare',
    'proposedDescription', 'authorityBoundaries', 'clarificationsNeeded'
  ) THEN
    RAISE EXCEPTION 'Invalid constitutional_domain: %', p_constitutional_domain;
  END IF;

  IF p_epistemic_state NOT IN ('supported', 'partial', 'unknown', 'contradicted') THEN
    RAISE EXCEPTION 'Invalid epistemic_state: %', p_epistemic_state;
  END IF;

  IF p_confidence NOT IN ('high', 'medium', 'low', 'unknown') THEN
    RAISE EXCEPTION 'Invalid confidence: %', p_confidence;
  END IF;

  IF p_representation_risk NOT IN ('high', 'medium', 'low') THEN
    RAISE EXCEPTION 'Invalid representation_risk: %', p_representation_risk;
  END IF;

  -- Validate belief consistency
  IF (p_epistemic_state = 'unknown' AND p_current_belief IS NOT NULL) OR
     (p_epistemic_state != 'unknown' AND p_current_belief IS NULL) THEN
    RAISE EXCEPTION 'Belief/epistemic_state mismatch: belief must be NULL iff epistemic_state=unknown';
  END IF;

  IF p_epistemic_state = 'unknown' AND p_confidence != 'unknown' THEN
    RAISE EXCEPTION 'Unknown epistemic state must have unknown confidence';
  END IF;

  -- Validate Evidence requirements
  IF p_epistemic_state IN ('supported', 'partial', 'contradicted') THEN
    IF p_source_evidence_ids IS NULL OR cardinality(p_source_evidence_ids) = 0 THEN
      RAISE EXCEPTION 'Epistemic state % requires at least one Evidence ID', p_epistemic_state;
    END IF;
  END IF;

  -- Validate every cited Evidence exists in session scope
  IF p_source_evidence_ids IS NOT NULL AND cardinality(p_source_evidence_ids) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM UNNEST(p_source_evidence_ids) AS eid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.evidence e
        WHERE e.id = eid
          AND e.business_representation_id = v_business_representation_id
          AND e.direct_hire_onboarding_session_id = p_onboarding_session_id
      )
    ) THEN
      RAISE EXCEPTION 'Cited Evidence not found in session scope or belongs to different business representation';
    END IF;
  END IF;

  -- Validate risk_reason required for high risk
  IF p_representation_risk = 'high' AND p_risk_reason IS NULL THEN
    RAISE EXCEPTION 'risk_reason required for high-risk hypotheses';
  END IF;

  -- IDEMPOTENCY CHECK: Same request for same (session, domain, trace) = same hypothesis
  IF p_request_trace_id IS NOT NULL THEN
    SELECT * INTO v_existing_hypothesis
    FROM public.hypotheses AS h
    WHERE h.direct_hire_onboarding_session_id = p_onboarding_session_id
      AND h.constitutional_domain = p_constitutional_domain
      AND h.request_trace_id = p_request_trace_id;

    IF FOUND THEN
      -- Idempotent return: this request already created this hypothesis
      RETURN QUERY
      SELECT
        v_existing_hypothesis.id AS hypothesis_id,
        v_existing_hypothesis.hypothesis_version AS hypothesis_version,
        TRUE AS is_idempotent_return,
        v_existing_hypothesis.created_at AS created_at;
      RETURN;
    END IF;
  END IF;

  -- Calculate next version number (now atomic, under session lock)
  -- FIXED: Fully qualify hypothesis_version to avoid collision with RETURNS TABLE output variable
  SELECT COALESCE(MAX(h.hypothesis_version), 0) + 1
  INTO v_next_version
  FROM public.hypotheses AS h
  WHERE h.direct_hire_onboarding_session_id = p_onboarding_session_id
    AND h.constitutional_domain = p_constitutional_domain;

  -- Calculate predecessor (if version > 1)
  IF v_next_version > 1 THEN
    -- FIXED: Fully qualify all columns to avoid ambiguity
    SELECT h.id INTO v_predecessor_id
    FROM public.hypotheses AS h
    WHERE h.direct_hire_onboarding_session_id = p_onboarding_session_id
      AND h.constitutional_domain = p_constitutional_domain
      AND h.hypothesis_version = v_next_version - 1;

    IF v_predecessor_id IS NULL THEN
      RAISE EXCEPTION 'Lineage error: expected predecessor version not found';
    END IF;

    -- Validate predecessor scope
    IF NOT EXISTS (
      SELECT 1 FROM public.hypotheses h
      WHERE h.id = v_predecessor_id
        AND h.owner_id = p_owner_id
        AND h.business_representation_id = v_business_representation_id
        AND h.business_id = v_business_id
        AND h.constitutional_domain = p_constitutional_domain
    ) THEN
      RAISE EXCEPTION 'Lineage error: predecessor scope mismatch';
    END IF;
  ELSE
    v_predecessor_id := NULL;
  END IF;

  -- Create immutable hypothesis record
  INSERT INTO public.hypotheses (
    owner_id,
    business_id,
    business_representation_id,
    direct_hire_onboarding_session_id,
    constitutional_domain,
    hypothesis_version,
    epistemic_state,
    current_belief,
    confidence,
    representation_risk,
    risk_reason,
    source_evidence_ids,
    evidence_cutoff_at,
    previous_hypothesis_id,
    request_trace_id,
    created_at,
    created_by_actor
  ) VALUES (
    p_owner_id,
    v_business_id,
    v_business_representation_id,
    p_onboarding_session_id,
    p_constitutional_domain,
    v_next_version,
    p_epistemic_state,
    p_current_belief,
    p_confidence,
    p_representation_risk,
    p_risk_reason,
    p_source_evidence_ids,
    p_evidence_cutoff_at,
    v_predecessor_id,
    p_request_trace_id,
    NOW(),
    p_created_by_actor
  ) RETURNING id INTO v_new_hypothesis_id;

  -- Return result
  RETURN QUERY
  SELECT
    v_new_hypothesis_id AS hypothesis_id,
    v_next_version AS hypothesis_version,
    FALSE AS is_idempotent_return,
    NOW() AS created_at;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Explicit ACL: service-role only (signature unchanged)
REVOKE EXECUTE ON FUNCTION public.zeya_persist_hypothesis(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_hypothesis(UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT)
  TO service_role;
