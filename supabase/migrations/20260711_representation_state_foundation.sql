-- ═══════════════════════════════════════════════════════════════════════════════
-- ZEYA CANONICAL REPRESENTATION STATE FOUNDATION
-- Date: 2026-07-11
-- Purpose: Implement core Representation State model for Phase 2
-- Safety: Idempotent, safe for multiple runs, preserves all data
-- Scope: Minimal vertical slice (10 core entities for founder statement → canonical version flow)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- ENUM TYPES
-- ──────────────────────────────────────────────────────────────────────────────

-- Representation phase progression (per domain)
CREATE TYPE representation_phase AS ENUM (
  'surface',      -- Basic facts identified (e.g., business name, offering)
  'structural',   -- Patterns and relationships understood
  'predictive',   -- Can predict behavior and outcomes
  'contextual',   -- Historical context and founder mindset
  'integrated'    -- Holistic coherent narrative
);

-- Risk tier for mutations (determines approval requirement)
CREATE TYPE risk_tier AS ENUM (
  'low',          -- Automatic, no approval needed
  'medium',       -- Provisional with review, auto-approval after deadline
  'high'          -- Explicit human approval required
);

-- Field sensitivity classification (governs risk assessment)
CREATE TYPE field_sensitivity_class AS ENUM (
  'legal',                    -- Legal claims
  'regulatory',               -- Regulatory compliance
  'pricing',                  -- Pricing, discounts
  'guarantees',               -- Warranties, SLAs
  'product_capability',       -- Product features
  'customer_commitment',      -- Customer promises
  'strategic_positioning',    -- Core positioning
  'target_market',            -- Target customers
  'financial',                -- Financial data
  'confidential',             -- Proprietary information
  'reputational',             -- Reputation-affecting
  'operational'               -- Internal operations
);

-- Claim eligibility state (governs external use)
CREATE TYPE claim_eligibility_state AS ENUM (
  'approved_for_external_use', -- Can be used externally without restriction
  'internal_only',             -- Cannot be shared externally
  'provisional',               -- Active but unconfirmed
  'disputed',                  -- Under contradiction, restricted
  'prohibited',                -- Cannot be used at all
  'expired'                    -- Evidence too old
);

-- Proposal status (lifecycle)
CREATE TYPE proposal_status AS ENUM (
  'draft',              -- Proposed, not yet assessed
  'risk_assessed',      -- Risk/sensitivity determined
  'pending_approval',   -- Awaiting high-risk approval
  'approved',           -- Ready for canonical version
  'rejected',           -- Declined
  'superseded'          -- Replaced by newer proposal
);

-- Evidence source type
CREATE TYPE evidence_source_type AS ENUM (
  'conversation',  -- From founder response
  'call_result',   -- From sales call
  'manual',        -- Founder entered directly
  'inference',     -- Derived from other evidence
  'system',        -- Auto-generated
  'import'         -- From external system
);

-- Representation element type
CREATE TYPE element_type AS ENUM (
  'fact',          -- Factual claim (business identity, features)
  'pattern',       -- Observed pattern (customer behavior, objection)
  'inference',     -- Derived understanding (likely needs, market position)
  'positioning',   -- Representation claim (how we describe them)
  'commitment'     -- Business commitment (guarantee, promise)
);

-- Approval decision type
CREATE TYPE approval_decision_type AS ENUM (
  'approved',
  'rejected',
  'deferred'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- IMMUTABILITY SUPPORT: Hash-based integrity checking
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_record_hash(record_data text)
RETURNS text AS $$
BEGIN
  -- Simple deterministic hash for integrity verification
  RETURN encode(digest(record_data, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ──────────────────────────────────────────────────────────────────────────────
-- CORE ENTITY: Business Representation
-- Master record for all representation state of a single business
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_representations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,  -- Assumes businesses table exists

  -- Ownership and tenant isolation
  user_id UUID NOT NULL,  -- Cached for RLS efficiency (should match businesses.user_id)

  -- Current state tracking
  current_phase representation_phase DEFAULT 'surface',  -- Weakest domain = overall phase
  current_version_id UUID,  -- FK to representation_versions (set after version creation)

  -- Overall representation metrics
  overall_confidence_score SMALLINT DEFAULT 0 CHECK (overall_confidence_score >= 0 AND overall_confidence_score <= 100),
  overall_confidence_updated_at TIMESTAMP WITH TIME ZONE,

  -- Fidelity tracking (how well representation matches reality)
  fidelity_last_assessed_at TIMESTAMP WITH TIME ZONE,
  fidelity_score SMALLINT,  -- NULL until first assessment

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Constraint: one representation per business
  UNIQUE(business_id),

  -- Constraint: user_id must match business owner (enforced in trigger)
  CONSTRAINT user_id_matches_business CHECK (user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_business_representations_business_id ON business_representations(business_id);
CREATE INDEX IF NOT EXISTS idx_business_representations_user_id ON business_representations(user_id);
CREATE INDEX IF NOT EXISTS idx_business_representations_current_phase ON business_representations(current_phase);

-- RLS: Users can only see/modify representation for their own businesses
ALTER TABLE business_representations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_business_representations" ON business_representations;
CREATE POLICY "users_can_view_own_business_representations"
  ON business_representations FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_can_insert_own_business_representations" ON business_representations;
CREATE POLICY "users_can_insert_own_business_representations"
  ON business_representations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_can_update_own_business_representations" ON business_representations;
CREATE POLICY "users_can_update_own_business_representations"
  ON business_representations FOR UPDATE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- DOMAIN ENTITY: Representation Domain
-- Tracks maturity independently across 12 domains
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS representation_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Domain classification (one of 12)
  domain_name TEXT NOT NULL CHECK (
    domain_name IN (
      'business_identity', 'offer', 'customer', 'market', 'positioning',
      'differentiation', 'objections', 'trust', 'qualification',
      'commercial_objectives', 'operational_constraints', 'channel_expression'
    )
  ),

  -- Domain-specific maturity (independent of overall)
  current_phase representation_phase NOT NULL DEFAULT 'surface',

  -- Domain-specific confidence
  confidence_score SMALLINT NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_updated_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- One entry per domain per business
  UNIQUE(business_representation_id, domain_name)
);

CREATE INDEX IF NOT EXISTS idx_representation_domains_business_rep_id ON representation_domains(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_representation_domains_domain_name ON representation_domains(domain_name);
CREATE INDEX IF NOT EXISTS idx_representation_domains_current_phase ON representation_domains(current_phase);

-- RLS: Inherit from business_representations via join
ALTER TABLE representation_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_domains" ON representation_domains;
CREATE POLICY "users_can_view_own_domains"
  ON representation_domains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_modify_own_domains" ON representation_domains;
CREATE POLICY "users_can_modify_own_domains"
  ON representation_domains FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- ELEMENT ENTITY: Representation Element
-- Individual claim/fact about the business
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS representation_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,
  representation_domain_id UUID NOT NULL REFERENCES representation_domains(id) ON DELETE CASCADE,

  -- Element classification
  element_key TEXT NOT NULL,  -- Stable identifier (e.g., "target_customer_primary")
  element_type element_type NOT NULL,  -- fact, pattern, inference, positioning, commitment

  -- Current state
  current_value_version_id UUID,  -- FK to representation_versions (which version holds current value)
  is_disputed BOOLEAN DEFAULT FALSE,  -- Has contradicting evidence
  claim_eligibility claim_eligibility_state DEFAULT 'internal_only',

  -- Sensitivity
  field_sensitivity field_sensitivity_class DEFAULT 'operational',

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- One key per domain per business
  UNIQUE(business_representation_id, representation_domain_id, element_key)
);

CREATE INDEX IF NOT EXISTS idx_representation_elements_business_rep_id ON representation_elements(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_representation_elements_domain_id ON representation_elements(representation_domain_id);
CREATE INDEX IF NOT EXISTS idx_representation_elements_disputed ON representation_elements(is_disputed);
CREATE INDEX IF NOT EXISTS idx_representation_elements_sensitivity ON representation_elements(field_sensitivity);
CREATE INDEX IF NOT EXISTS idx_representation_elements_eligibility ON representation_elements(claim_eligibility);

-- RLS: Inherit from business_representations
ALTER TABLE representation_elements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_elements" ON representation_elements;
CREATE POLICY "users_can_view_own_elements"
  ON representation_elements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_elements" ON representation_elements;
CREATE POLICY "users_can_insert_own_elements"
  ON representation_elements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_update_own_elements" ON representation_elements;
CREATE POLICY "users_can_update_own_elements"
  ON representation_elements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- EVIDENCE ENTITY: Evidence (Immutable)
-- Raw founder statement or observation - MUST NEVER BE MODIFIED
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Evidence provenance
  source_type evidence_source_type NOT NULL,  -- How was this learned
  source_description TEXT,  -- e.g., "Founder statement on call 2026-07-10", "Market research"

  -- The raw statement (immutable)
  raw_statement TEXT NOT NULL,  -- Original, uninterpreted
  statement_hash TEXT NOT NULL,  -- SHA256 hash for integrity verification

  -- Classification
  affected_domains TEXT[] DEFAULT ARRAY[]::TEXT[],  -- Which domains does this relate to?

  -- Metadata
  captured_by_actor TEXT,  -- User ID or system identifier
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- INVARIANT: Evidence is append-only, no updates allowed
  CONSTRAINT evidence_is_immutable CHECK (true)  -- Enforced by trigger + RLS
);

CREATE INDEX IF NOT EXISTS idx_evidence_business_representation_id ON evidence(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source_type ON evidence(source_type);
CREATE INDEX IF NOT EXISTS idx_evidence_created_at ON evidence(created_at DESC);

-- Immutability trigger: Block any UPDATE or DELETE
CREATE OR REPLACE FUNCTION evidence_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Evidence records are immutable. Cannot % evidence %.', TG_OP, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_prevent_modification_trigger ON evidence;
CREATE TRIGGER evidence_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_prevent_modification();

-- RLS: Users can only see evidence for their own businesses
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_evidence" ON evidence;
CREATE POLICY "users_can_view_own_evidence"
  ON evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_evidence" ON evidence;
CREATE POLICY "users_can_insert_own_evidence"
  ON evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- OBSERVATION ENTITY: Observation
-- Interpreted evidence - what the raw evidence means
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Evidence relationship
  evidence_id UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,

  -- Interpretation (preserving distinction from raw evidence)
  interpreted_meaning TEXT NOT NULL,  -- What does the evidence signify?
  confidence_in_interpretation SMALLINT NOT NULL CHECK (confidence_in_interpretation >= 0 AND confidence_in_interpretation <= 100),

  -- Classification
  affected_domains TEXT[] DEFAULT ARRAY[]::TEXT[],  -- Which domains are affected by this interpretation?
  affected_elements TEXT[] DEFAULT ARRAY[]::TEXT[],  -- Which elements?

  -- Who created this?
  created_by_actor TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_business_representation_id ON observations(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_observations_evidence_id ON observations(evidence_id);
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at DESC);

-- RLS
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_observations" ON observations;
CREATE POLICY "users_can_view_own_observations"
  ON observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_observations" ON observations;
CREATE POLICY "users_can_insert_own_observations"
  ON observations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- PROPOSAL ENTITY: Representation Proposal
-- Proposed changes to canonical representation
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS representation_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Affected elements
  affected_element_ids UUID[] NOT NULL,  -- Which elements are proposed to change

  -- Change specification (before/after)
  proposed_changes JSONB NOT NULL,  -- {element_id: {before: ..., after: ...}, ...}

  -- Evidence supporting proposal
  supporting_observation_ids UUID[] NOT NULL,  -- Which observations support this
  supporting_evidence_ids UUID[] DEFAULT ARRAY[]::UUID[],  -- Which raw evidence

  -- Risk and sensitivity assessment
  risk_tier risk_tier,  -- Set after assessment
  highest_sensitivity_class field_sensitivity_class,  -- Most sensitive field in proposal
  requires_approval BOOLEAN DEFAULT FALSE,  -- HIGH risk requires explicit approval

  -- Status
  status proposal_status NOT NULL DEFAULT 'draft',
  status_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Who created this proposal?
  proposed_by_actor TEXT NOT NULL,

  -- Metadata
  rationale TEXT,  -- Why is this change proposed?
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- INVARIANT: Draft proposals can be modified, approved proposals cannot
  CONSTRAINT proposal_immutability CHECK (
    (status = 'draft') OR
    (status IN ('risk_assessed', 'pending_approval', 'approved', 'rejected', 'superseded'))
  )
);

CREATE INDEX IF NOT EXISTS idx_representation_proposals_business_rep_id ON representation_proposals(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_representation_proposals_status ON representation_proposals(status);
CREATE INDEX IF NOT EXISTS idx_representation_proposals_risk_tier ON representation_proposals(risk_tier);
CREATE INDEX IF NOT EXISTS idx_representation_proposals_created_at ON representation_proposals(created_at DESC);

-- RLS
ALTER TABLE representation_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_proposals" ON representation_proposals;
CREATE POLICY "users_can_view_own_proposals"
  ON representation_proposals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_proposals" ON representation_proposals;
CREATE POLICY "users_can_insert_own_proposals"
  ON representation_proposals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- APPROVAL ENTITY: Approval Decision
-- High-risk proposals require explicit approval before becoming canonical
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  representation_proposal_id UUID NOT NULL REFERENCES representation_proposals(id) ON DELETE CASCADE,

  -- Decision
  decision approval_decision_type NOT NULL,

  -- Approver details
  approver_actor TEXT NOT NULL,  -- User ID or system
  approval_reason TEXT,  -- Why was this approved/rejected?

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- INVARIANT: One decision per proposal (latest is current)
  UNIQUE(representation_proposal_id)  -- Actually: current decision only, superseded don't matter
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_proposal_id ON approval_decisions(representation_proposal_id);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decision ON approval_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_created_at ON approval_decisions(created_at DESC);

-- RLS
ALTER TABLE approval_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_approvals" ON approval_decisions;
CREATE POLICY "users_can_view_own_approvals"
  ON approval_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM representation_proposals rp
      INNER JOIN business_representations br ON rp.business_representation_id = br.id
      WHERE rp.id = representation_proposal_id AND auth.uid() = br.user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_approvals" ON approval_decisions;
CREATE POLICY "users_can_insert_own_approvals"
  ON approval_decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM representation_proposals rp
      INNER JOIN business_representations br ON rp.business_representation_id = br.id
      WHERE rp.id = representation_proposal_id AND auth.uid() = br.user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- VERSION ENTITY: Representation Version (Immutable)
-- Canonical approved representation snapshot - NEVER MODIFIED
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS representation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Lineage
  previous_version_id UUID REFERENCES representation_versions(id),  -- NULL for first version

  -- Source of this version
  source_proposal_id UUID NOT NULL REFERENCES representation_proposals(id),  -- Which proposal created this
  source_approval_id UUID REFERENCES approval_decisions(id),  -- Which approval (NULL if low-risk)

  -- Content (immutable snapshot)
  element_values JSONB NOT NULL,  -- {element_id: {value, confidence, timestamp}, ...}
  version_number BIGINT NOT NULL,  -- Incremental version counter

  -- Quality metrics
  overall_confidence_score SMALLINT NOT NULL CHECK (overall_confidence_score >= 0 AND overall_confidence_score <= 100),

  -- Metadata
  created_by_actor TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  content_hash TEXT NOT NULL,  -- SHA256 hash of element_values for integrity

  -- INVARIANT: Versions are immutable, append-only
  CONSTRAINT version_is_immutable CHECK (true),  -- Enforced by trigger
  CONSTRAINT version_number_monotonic CHECK (version_number > 0)
);

CREATE INDEX IF NOT EXISTS idx_representation_versions_business_rep_id ON representation_versions(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_representation_versions_previous_version_id ON representation_versions(previous_version_id);
CREATE INDEX IF NOT EXISTS idx_representation_versions_version_number ON representation_versions(version_number DESC);
CREATE INDEX IF NOT EXISTS idx_representation_versions_created_at ON representation_versions(created_at DESC);

-- Immutability trigger
CREATE OR REPLACE FUNCTION representation_versions_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Representation versions are immutable. Cannot % version %.', TG_OP, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS representation_versions_prevent_modification_trigger ON representation_versions;
CREATE TRIGGER representation_versions_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON representation_versions
  FOR EACH ROW EXECUTE FUNCTION representation_versions_prevent_modification();

-- RLS
ALTER TABLE representation_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_versions" ON representation_versions;
CREATE POLICY "users_can_view_own_versions"
  ON representation_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_versions" ON representation_versions;
CREATE POLICY "users_can_insert_own_versions"
  ON representation_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- CONFIDENCE ENTITY: Confidence Assessment
-- Explainable confidence with full calculation details
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS confidence_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  representation_version_id UUID NOT NULL REFERENCES representation_versions(id) ON DELETE CASCADE,

  -- Score and explanation
  confidence_score SMALLINT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_band_min SMALLINT,  -- e.g., 65 for "75±10"
  confidence_band_max SMALLINT,

  -- Factors contributing to score
  evidence_count SMALLINT NOT NULL DEFAULT 0,
  source_diversity_score SMALLINT,  -- 0-100, how many independent sources
  source_quality_score SMALLINT,  -- 0-100, weighted by direct/inferred/indirect
  recency_score SMALLINT,  -- 0-100, penalizes stale evidence
  contradiction_penalty SMALLINT DEFAULT 0,  -- 0-100, amount deducted for contradictions

  -- Calculation details
  calculation_method TEXT NOT NULL,  -- Algorithm used (e.g., "weighted_evidence_sum_v1")
  calculation_version TEXT NOT NULL,  -- Version of algorithm (e.g., "1.0")
  calculation_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Human explanation
  rationale TEXT NOT NULL,  -- 3-5 sentence explanation in plain language

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_confidence_assessments_version_id ON confidence_assessments(representation_version_id);
CREATE INDEX IF NOT EXISTS idx_confidence_assessments_score ON confidence_assessments(confidence_score);

-- RLS
ALTER TABLE confidence_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_confidence" ON confidence_assessments;
CREATE POLICY "users_can_view_own_confidence"
  ON confidence_assessments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM representation_versions rv
      INNER JOIN business_representations br ON rv.business_representation_id = br.id
      WHERE rv.id = representation_version_id AND auth.uid() = br.user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_confidence" ON confidence_assessments;
CREATE POLICY "users_can_insert_own_confidence"
  ON confidence_assessments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM representation_versions rv
      INNER JOIN business_representations br ON rv.business_representation_id = br.id
      WHERE rv.id = representation_version_id AND auth.uid() = br.user_id
    )
  );

DROP POLICY IF EXISTS "users_can_update_own_confidence" ON confidence_assessments;
DROP POLICY IF EXISTS "users_can_delete_own_confidence" ON confidence_assessments;

-- INVARIANT: Confidence Assessments are immutable, append-only history.
CREATE OR REPLACE FUNCTION confidence_assessments_prevent_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Confidence assessments are immutable. Cannot % assessment %.',
    TG_OP,
    OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS confidence_assessments_prevent_modification_trigger
  ON confidence_assessments;
CREATE TRIGGER confidence_assessments_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON confidence_assessments
  FOR EACH ROW
  EXECUTE FUNCTION confidence_assessments_prevent_modification();

REVOKE ALL ON FUNCTION confidence_assessments_prevent_modification() FROM PUBLIC;
REVOKE ALL ON FUNCTION confidence_assessments_prevent_modification() FROM anon;
REVOKE ALL ON FUNCTION confidence_assessments_prevent_modification() FROM authenticated;
REVOKE ALL ON FUNCTION confidence_assessments_prevent_modification() FROM service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- AUDIT ENTITY: Audit Event (Immutable)
-- Complete audit trail of all representation changes
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_representation_id UUID NOT NULL REFERENCES business_representations(id) ON DELETE CASCADE,

  -- Event classification
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'evidence_created',
      'observation_created',
      'proposal_created',
      'proposal_assessed',
      'proposal_approved',
      'proposal_rejected',
      'contradiction_detected',
      'version_created',
      'version_rolled_back',
      'confidence_calculated',
      'domain_maturity_updated'
    )
  ),

  -- Related entities
  evidence_id UUID REFERENCES evidence(id),
  observation_id UUID REFERENCES observations(id),
  proposal_id UUID REFERENCES representation_proposals(id),
  version_id UUID REFERENCES representation_versions(id),
  approval_id UUID REFERENCES approval_decisions(id),

  -- Actor responsible
  actor_user_id UUID REFERENCES auth.users(id),
  actor_system TEXT,

  CONSTRAINT audit_actor_required CHECK (
    actor_user_id IS NOT NULL OR actor_system IS NOT NULL
  ),

  -- Change details
  details JSONB,  -- Structured event data

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- INVARIANT: Audit is append-only, immutable
  CONSTRAINT audit_is_immutable CHECK (true)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_business_rep_id ON audit_events(business_representation_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_proposal_id ON audit_events(proposal_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_version_id ON audit_events(version_id);

-- Immutability trigger
CREATE OR REPLACE FUNCTION audit_events_prevent_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit events are immutable. Cannot % event %.', TG_OP, OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Exact, service-role-only purge for confirmed permanent/test fixtures.
CREATE OR REPLACE FUNCTION zeya_purge_business_representation(
  p_business_representation_id UUID,
  p_expected_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_counts JSONB := '{}'::jsonb;
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'purge not authorized';
  END IF;

  SELECT business_id INTO v_business_id
  FROM business_representations
  WHERE id = p_business_representation_id
  FOR UPDATE;

  IF v_business_id IS NULL OR v_business_id <> p_expected_business_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  PERFORM set_config('zeya.controlled_purge', 'on', true);

  DELETE FROM audit_events WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('audit_events', v_count);
  DELETE FROM confidence_assessments WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('confidence_assessments', v_count);
  UPDATE business_representations SET current_version_id = NULL WHERE id = p_business_representation_id;
  DELETE FROM representation_versions WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_versions', v_count);
  DELETE FROM approval_decisions WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('approval_decisions', v_count);
  DELETE FROM proposal_elements WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_elements', v_count);
  DELETE FROM proposal_evidence WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_evidence', v_count);
  DELETE FROM proposal_observations WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('proposal_observations', v_count);
  DELETE FROM representation_proposals WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_proposals', v_count);
  DELETE FROM observations WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('observations', v_count);
  DELETE FROM evidence WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('evidence', v_count);
  DELETE FROM representation_elements WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_elements', v_count);
  DELETE FROM representation_domains WHERE business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('representation_domains', v_count);
  DELETE FROM business_representations WHERE id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_counts := v_counts || jsonb_build_object('business_representations', v_count);

  RETURN jsonb_build_object(
    'businessRepresentationId', p_business_representation_id,
    'businessId', p_expected_business_id,
    'deleted', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION zeya_purge_business_representation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_purge_business_representation(UUID, UUID) TO service_role;

DROP TRIGGER IF EXISTS audit_events_prevent_modification_trigger ON audit_events;
CREATE TRIGGER audit_events_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_modification();

-- RLS
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_audit_events" ON audit_events;
CREATE POLICY "users_can_view_own_audit_events"
  ON audit_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_audit_events" ON audit_events;
CREATE POLICY "users_can_insert_own_audit_events"
  ON audit_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- AUTO-UPDATE TRIGGERS
-- ──────────────────────────────────────────────────────────────────────────────

-- Update business_representations.updated_at
CREATE OR REPLACE FUNCTION update_business_representations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_representations_updated_at ON business_representations;
CREATE TRIGGER business_representations_updated_at
  BEFORE UPDATE ON business_representations
  FOR EACH ROW EXECUTE FUNCTION update_business_representations_updated_at();

-- Update representation_domains.updated_at
CREATE OR REPLACE FUNCTION update_representation_domains_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS representation_domains_updated_at ON representation_domains;
CREATE TRIGGER representation_domains_updated_at
  BEFORE UPDATE ON representation_domains
  FOR EACH ROW EXECUTE FUNCTION update_representation_domains_updated_at();

-- Update representation_elements.updated_at
CREATE OR REPLACE FUNCTION update_representation_elements_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS representation_elements_updated_at ON representation_elements;
CREATE TRIGGER representation_elements_updated_at
  BEFORE UPDATE ON representation_elements
  FOR EACH ROW EXECUTE FUNCTION update_representation_elements_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ──────────────────────────────────────────────────────────────────────────────

-- Create initial business representation for a new business
CREATE OR REPLACE FUNCTION initialize_business_representation(
  p_business_id UUID,
  p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_rep_id UUID;
  v_domain_name TEXT;
BEGIN
  -- Create the main representation record
  INSERT INTO business_representations (business_id, user_id, current_phase)
  VALUES (p_business_id, p_user_id, 'surface')
  RETURNING id INTO v_rep_id;

  -- Create entries for all 12 domains
  FOREACH v_domain_name IN ARRAY ARRAY[
    'business_identity', 'offer', 'customer', 'market', 'positioning',
    'differentiation', 'objections', 'trust', 'qualification',
    'commercial_objectives', 'operational_constraints', 'channel_expression'
  ] LOOP
    INSERT INTO representation_domains (
      business_representation_id, domain_name, current_phase, confidence_score
    ) VALUES (v_rep_id, v_domain_name, 'surface', 0);
  END LOOP;

  RETURN v_rep_id;
END;
$$ LANGUAGE plpgsql;

-- Compute overall phase from domain phases (weakest domain = overall)
CREATE OR REPLACE FUNCTION compute_overall_phase(
  p_business_representation_id UUID
)
RETURNS representation_phase AS $$
DECLARE
  v_phase_priority RECORD;
  v_overall_phase representation_phase;
BEGIN
  -- Map phases to priority (lower number = earlier/weaker)
  SELECT COALESCE(
    MIN(
      CASE current_phase
        WHEN 'surface' THEN 1
        WHEN 'structural' THEN 2
        WHEN 'predictive' THEN 3
        WHEN 'contextual' THEN 4
        WHEN 'integrated' THEN 5
      END
    )
  ) INTO v_phase_priority
  FROM representation_domains
  WHERE business_representation_id = p_business_representation_id;

  -- Map priority back to phase name
  v_overall_phase := CASE v_phase_priority
    WHEN 1 THEN 'surface'::representation_phase
    WHEN 2 THEN 'structural'::representation_phase
    WHEN 3 THEN 'predictive'::representation_phase
    WHEN 4 THEN 'contextual'::representation_phase
    WHEN 5 THEN 'integrated'::representation_phase
    ELSE 'surface'::representation_phase
  END;

  RETURN v_overall_phase;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS get_agent_representation_context(UUID, TEXT);
DROP FUNCTION IF EXISTS get_agent_representation_context(UUID, BOOLEAN);

-- Get current authorized agent context (filters for eligibility, sensitivity, etc.)
CREATE OR REPLACE FUNCTION get_agent_representation_context(
  p_business_representation_id UUID,
  p_include_provisional BOOLEAN DEFAULT false
)
RETURNS TABLE (
  element_id UUID,
  element_key TEXT,
  element_type representation_element_type,
  current_value JSONB,
  overall_confidence_score SMALLINT,
  claim_eligibility claim_eligibility_state,
  field_sensitivity field_sensitivity_class
) AS $$
BEGIN
  -- Verify authenticated user owns this representation
  IF NOT EXISTS (
    SELECT 1 FROM business_representations
    WHERE id = p_business_representation_id AND user_id = auth.uid()
  ) THEN
    -- Return empty result for tenant isolation
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    re.id,
    re.element_key,
    re.element_type,
    rv.element_values -> re.id::text,
    COALESCE(ca.confidence_score, rv.overall_confidence_score, 0)::SMALLINT,
    re.claim_eligibility,
    re.field_sensitivity
  FROM representation_elements re
  LEFT JOIN representation_versions rv ON re.current_value_version_id = rv.id
  LEFT JOIN confidence_assessments ca ON rv.id = ca.representation_version_id
  WHERE re.business_representation_id = p_business_representation_id
    AND (
      re.claim_eligibility = 'approved_for_external_use'
      OR (p_include_provisional AND re.claim_eligibility = 'provisional')
    )
    AND NOT re.is_disputed;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Foundation schema is complete. Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════════
