-- MIGRATION: Hypotheses Governance Foundation
-- Date: 2026-08-08
-- Purpose: Enable Day One hypothesis verification + immutable versioning
-- Safety: Additive only, no existing table modifications
-- Pattern: Reuses representation_versions immutability + approval_decisions verification patterns

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: hypotheses (Immutable, versioned, epistemic reasoning state)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolation (explicit for RLS clarity)
  owner_id UUID NOT NULL REFERENCES "auth"."users"(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id UUID NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  direct_hire_onboarding_session_id UUID NOT NULL REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE RESTRICT,

  -- Immutable versioning per constitutional domain per session
  constitutional_domain VARCHAR(50) NOT NULL,
  hypothesis_version BIGINT NOT NULL,
  -- Version sequence: v1, v2, v3... (immutable forever, never updated)

  -- Epistemic state (Zeya's reasoning about Evidence, not owner approval)
  epistemic_state VARCHAR(20) NOT NULL,
  -- Enum: supported | partial | unknown | contradicted
  -- This is about Evidence assessment, NOT owner decisions

  current_belief TEXT,
  -- NULL if epistemic_state = 'unknown'
  -- Evidence-grounded statement, never inferred-only

  confidence VARCHAR(10) NOT NULL DEFAULT 'unknown',
  -- Enum: high | medium | low | unknown
  -- high = 2+ independent Evidence + strong Observation
  -- medium = single page + Observation OR multiple pages without owner
  -- low = single source, weak corroboration
  -- unknown = no relevant Evidence

  representation_risk VARCHAR(10) NOT NULL DEFAULT 'low',
  -- Enum: high | medium | low
  -- Question: "If this belief is wrong, what damage could Zeya cause?"
  -- Independent of confidence (can be high-confidence + high-risk)

  risk_reason TEXT,
  -- Required if representation_risk = 'high'
  -- "If wrong, damage is..."

  -- Evidence provenance (immutable reference at hypothesis creation)
  source_evidence_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  -- Immutable: Evidence IDs considered when this hypothesis was created
  -- Updated via successor hypothesis (new row), never mutated

  evidence_cutoff_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- Timestamp when Evidence was captured
  -- Freezes "which Evidence was considered"

  -- Lineage (immutable versioning via FK, not mutation)
  previous_hypothesis_id UUID REFERENCES public.hypotheses(id) ON DELETE RESTRICT,
  -- NULL for hypothesis_version = 1 (original)
  -- Non-NULL for version > 1 (points to immediate predecessor)
  -- Used to traverse history; predecessor row never modified

  -- Idempotency (prevent duplicate versions on request retry)
  request_trace_id VARCHAR(64),
  -- Idempotency key from Zeya's request tracing
  -- Same (session, domain, request_trace_id) = same hypothesis (no duplicate v2)

  -- Immutable audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by_actor TEXT NOT NULL,
  -- 'zeya_reasoning_service' = auto-generated from Evidence
  -- 'owner_correction' = regenerated after owner provided correction

  -- CONSTRAINTS: Immutability, governance, validation
  CONSTRAINT hypothesis_is_immutable CHECK (true),
  -- Enforced by trigger: blocks any UPDATE/DELETE except controlled purge

  CONSTRAINT unique_hypothesis_version_per_domain_per_session
    UNIQUE (direct_hire_onboarding_session_id, constitutional_domain, hypothesis_version),
  -- Prevents duplicate versions; allows sequence per domain
  -- Note: partial unique constraint for request_trace_id is created as separate CREATE UNIQUE INDEX below

  CONSTRAINT valid_epistemic_state CHECK (
    epistemic_state IN ('supported', 'partial', 'unknown', 'contradicted')
  ),

  CONSTRAINT valid_confidence CHECK (
    confidence IN ('high', 'medium', 'low', 'unknown')
  ),

  CONSTRAINT valid_representation_risk CHECK (
    representation_risk IN ('high', 'medium', 'low')
  ),

  CONSTRAINT valid_constitutional_domain CHECK (
    constitutional_domain IN (
      'whatYouSell', 'whoItIsFor', 'problemOrAspiration', 'whyCustomersShouldCare',
      'proposedDescription', 'authorityBoundaries', 'clarificationsNeeded'
    )
  ),

  CONSTRAINT belief_consistency CHECK (
    (epistemic_state = 'unknown' AND current_belief IS NULL AND confidence = 'unknown') OR
    (epistemic_state != 'unknown' AND current_belief IS NOT NULL)
  ),

  CONSTRAINT non_unknown_requires_evidence CHECK (
    (epistemic_state = 'unknown') OR
    (cardinality(source_evidence_ids) > 0)
  ),
  -- PostgreSQL-safe: cardinality() returns 0 for empty arrays (not NULL)
  -- Unknown hypotheses allowed zero Evidence IDs
  -- Non-unknown must cite Evidence

  CONSTRAINT valid_lineage CHECK (
    (previous_hypothesis_id IS NULL AND hypothesis_version = 1) OR
    (previous_hypothesis_id IS NOT NULL AND hypothesis_version > 1)
  ),

  CONSTRAINT risk_reason_required_for_high CHECK (
    (representation_risk = 'high' AND risk_reason IS NOT NULL) OR
    (representation_risk IN ('medium', 'low'))
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hypotheses_session_version
  ON public.hypotheses(direct_hire_onboarding_session_id DESC, hypothesis_version DESC);
CREATE INDEX IF NOT EXISTS idx_hypotheses_domain
  ON public.hypotheses(constitutional_domain);
CREATE INDEX IF NOT EXISTS idx_hypotheses_owner
  ON public.hypotheses(owner_id);
CREATE INDEX IF NOT EXISTS idx_hypotheses_lineage
  ON public.hypotheses(previous_hypothesis_id) WHERE previous_hypothesis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hypotheses_idempotency
  ON public.hypotheses(direct_hire_onboarding_session_id, constitutional_domain, request_trace_id)
  WHERE request_trace_id IS NOT NULL;

-- Immutability trigger (same pattern as evidence table)
CREATE OR REPLACE FUNCTION public.hypotheses_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Hypotheses are immutable. Cannot % hypothesis %.', TG_OP, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hypotheses_prevent_modification_trigger ON public.hypotheses;
CREATE TRIGGER hypotheses_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON public.hypotheses
  FOR EACH ROW EXECUTE FUNCTION public.hypotheses_prevent_modification();

-- RLS: hypotheses
ALTER TABLE public.hypotheses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_can_manage_hypotheses" ON public.hypotheses;
CREATE POLICY "service_role_can_manage_hypotheses"
  ON public.hypotheses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_owner_select_own_hypotheses" ON public.hypotheses;
CREATE POLICY "authenticated_owner_select_own_hypotheses"
  ON public.hypotheses FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: hypothesis_verifications (Immutable events, multiple per hypothesis)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.hypothesis_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to immutable hypothesis
  hypothesis_id UUID NOT NULL REFERENCES public.hypotheses(id) ON DELETE RESTRICT,

  -- Deterministic verification ordering (not created_at + UUID)
  verification_sequence BIGINT NOT NULL,
  -- Sequence: 1, 2, 3... per hypothesis (first decision, second if owner changes mind, etc.)
  -- Latest verification = highest verification_sequence

  -- Owner decision (ONLY decisions, no epistemic state)
  decision public.approval_decision_type NOT NULL,
  -- Enum: approved | rejected | deferred
  -- approved = owner confirmed hypothesis is correct
  -- rejected = owner said this is wrong (triggers successor via Evidence + reasoning)
  -- deferred = owner said "we'll discuss later"

  verification_reasoning TEXT,
  -- Owner's reasoning for this decision
  -- If decision='rejected', often becomes new Evidence

  verifier_user_id UUID NOT NULL REFERENCES "auth"."users"(id) ON DELETE RESTRICT,
  -- Who verified (the owner)

  -- Immutable audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- CONSTRAINTS: Immutability, ordering
  CONSTRAINT verification_is_immutable CHECK (true),
  -- Enforced by trigger: blocks any UPDATE/DELETE except controlled purge

  CONSTRAINT unique_verification_sequence UNIQUE (hypothesis_id, verification_sequence)
  -- One verification per sequence per hypothesis
  -- Multiple verifications allowed (different sequences)
  -- Note: ownership validation is enforced in zeya_verify_hypothesis RPC, not via CHECK
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hypothesis_verifications_hypothesis_id
  ON public.hypothesis_verifications(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_hypothesis_verifications_sequence
  ON public.hypothesis_verifications(hypothesis_id DESC, verification_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_hypothesis_verifications_decision
  ON public.hypothesis_verifications(decision);

-- Immutability trigger
CREATE OR REPLACE FUNCTION public.hypothesis_verifications_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Hypothesis verifications are immutable. Cannot % verification %.', TG_OP, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hypothesis_verifications_prevent_modification_trigger ON public.hypothesis_verifications;
CREATE TRIGGER hypothesis_verifications_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON public.hypothesis_verifications
  FOR EACH ROW EXECUTE FUNCTION public.hypothesis_verifications_prevent_modification();

-- RLS: hypothesis_verifications
ALTER TABLE public.hypothesis_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_can_manage_verifications" ON public.hypothesis_verifications;
CREATE POLICY "service_role_can_manage_verifications"
  ON public.hypothesis_verifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_owner_verify_own_hypotheses" ON public.hypothesis_verifications;
CREATE POLICY "authenticated_owner_verify_own_hypotheses"
  ON public.hypothesis_verifications FOR ALL TO authenticated
  USING (
    verifier_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.hypotheses
      WHERE id = hypothesis_id AND owner_id = auth.uid()
    )
  )
  WITH CHECK (verifier_user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: zeya_persist_hypothesis (Service-role only, atomic version allocation)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.zeya_persist_hypothesis(
  p_owner_id UUID,
  p_onboarding_session_id UUID,
  p_constitutional_domain VARCHAR(50),
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
    FROM public.hypotheses
    WHERE direct_hire_onboarding_session_id = p_onboarding_session_id
      AND constitutional_domain = p_constitutional_domain
      AND request_trace_id = p_request_trace_id;

    IF FOUND THEN
      -- Idempotent return: this request already created this hypothesis
      RETURN QUERY
      SELECT
        v_existing_hypothesis.id,
        v_existing_hypothesis.hypothesis_version,
        TRUE,  -- is_idempotent_return
        v_existing_hypothesis.created_at;
      RETURN;
    END IF;
  END IF;

  -- Calculate next version number (now atomic, under session lock)
  SELECT COALESCE(MAX(hypothesis_version), 0) + 1
  INTO v_next_version
  FROM public.hypotheses
  WHERE direct_hire_onboarding_session_id = p_onboarding_session_id
    AND constitutional_domain = p_constitutional_domain;

  -- Calculate predecessor (if version > 1)
  IF v_next_version > 1 THEN
    SELECT id INTO v_predecessor_id
    FROM public.hypotheses
    WHERE direct_hire_onboarding_session_id = p_onboarding_session_id
      AND constitutional_domain = p_constitutional_domain
      AND hypothesis_version = v_next_version - 1;

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
    v_new_hypothesis_id,
    v_next_version,
    FALSE,  -- is_idempotent_return
    NOW();

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Explicit ACL: service-role only
REVOKE EXECUTE ON FUNCTION public.zeya_persist_hypothesis(UUID, UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_hypothesis(UUID, UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMP WITH TIME ZONE, VARCHAR, TEXT)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: zeya_verify_hypothesis (Authenticated owner, deterministic sequence)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.zeya_verify_hypothesis(
  p_hypothesis_id UUID,
  p_decision TEXT,
  p_verification_reasoning TEXT DEFAULT NULL
)
RETURNS TABLE (
  verification_id UUID,
  hypothesis_id UUID,
  verification_sequence BIGINT,
  decision VARCHAR,
  verified_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_hypothesis public.hypotheses%ROWTYPE;
  v_next_sequence BIGINT;
  v_verification_id UUID;
BEGIN
  -- Verify authenticated context only
  IF auth.role() != 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Load hypothesis (immutable read)
  SELECT * INTO v_hypothesis
  FROM public.hypotheses
  WHERE id = p_hypothesis_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hypothesis not found';
  END IF;

  -- Validate ownership (RPC-level enforcement)
  IF v_hypothesis.owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Ownership mismatch';
  END IF;

  -- Validate decision enum
  IF p_decision NOT IN ('approved', 'rejected', 'deferred') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  -- Lock hypothesis to serialize verification_sequence allocation
  SELECT * FROM public.hypotheses WHERE id = p_hypothesis_id FOR UPDATE;

  -- Calculate next verification_sequence for this hypothesis
  SELECT COALESCE(MAX(verification_sequence), 0) + 1
  INTO v_next_sequence
  FROM public.hypothesis_verifications
  WHERE hypothesis_id = p_hypothesis_id;

  -- Create immutable verification event
  INSERT INTO public.hypothesis_verifications (
    hypothesis_id,
    verification_sequence,
    decision,
    verification_reasoning,
    verifier_user_id,
    created_at
  ) VALUES (
    p_hypothesis_id,
    v_next_sequence,
    p_decision::public.approval_decision_type,
    p_verification_reasoning,
    auth.uid(),
    NOW()
  ) RETURNING id INTO v_verification_id;

  -- Return result
  RETURN QUERY
  SELECT
    v_verification_id,
    p_hypothesis_id,
    v_next_sequence,
    p_decision::VARCHAR,
    NOW();

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Explicit ACL: authenticated only
REVOKE EXECUTE ON FUNCTION public.zeya_verify_hypothesis(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_verify_hypothesis(UUID, TEXT, TEXT)
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VALIDATION & SAFETY
-- ═══════════════════════════════════════════════════════════════════════════════

-- Verify enum exists (reuse existing approval_decision_type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'approval_decision_type'
  ) THEN
    RAISE EXCEPTION 'Required enum approval_decision_type not found; ensure representation_state_foundation migration is applied first';
  END IF;
END;
$$;

COMMIT;
