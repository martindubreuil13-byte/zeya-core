// Hypothesis Reasoning Service — Frozen Type Contract
// Uses OpenAI Responses API with strict JSON schema

export type ConstitutionalDomain =
  | 'whatYouSell'
  | 'whoItIsFor'
  | 'problemOrAspiration'
  | 'whyCustomersShouldCare'
  | 'proposedDescription'
  | 'authorityBoundaries'
  | 'clarificationsNeeded';

export type EpistemicState =
  | 'supported'      // 2+ independent Evidence + strong Observation
  | 'partial'        // 1 Evidence source OR weak Observation
  | 'unknown'        // No relevant Evidence
  | 'contradicted';  // Conflicting Evidence

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export type RepresentationRiskLevel = 'high' | 'medium' | 'low';

export type HypothesisReasoningScope =
  | { mode: 'all_domains' }
  | {
      mode: 'specific_domain';
      constitutionalDomain: ConstitutionalDomain;
    };

export interface HypothesisReasoningOutput {
  constitutionalDomain: ConstitutionalDomain;
  epistemicState: EpistemicState;
  currentBelief: string | null;
  // NULL if epistemicState = 'unknown'
  // Evidence-grounded statement, never inference-only
  // For clarificationsNeeded: may be null even if verificationNeed is present

  confidence: ConfidenceLevel;
  // high = 2+ independent Evidence + strong Observation
  // medium = single page + Observation OR multiple pages without owner
  // low = single source, weak corroboration
  // unknown = no relevant Evidence

  representationRisk: RepresentationRiskLevel;
  // high = pricing, guarantees, legal claims, delivery promises, negotiation authority, technical promises
  // medium = positioning nuance, differentiators, business model/lead prioritization assumptions
  // low = descriptive details not materially affecting representation

  riskReason: string;
  // "If wrong about this, damage is..."
  // Required if representationRisk = 'medium' or 'high'
  // May be empty only if representationRisk = 'low'

  verificationNeed: string | null;
  // Specific verification requirement or clarification need
  // Used primarily for clarificationsNeeded domain
  // Null if no outstanding verification need
  // Does NOT violate unknown/null-belief constraint
  // Example: "Confirm pricing authority; verify delivery timeline guarantees"

  sourceEvidenceIds: string[];
  // Exact Evidence IDs cited for non-unknown belief
  // Empty array allowed only if epistemicState = 'unknown'

  evidenceCutoffAt: string;
  // ISO-8601 timestamp: when Evidence snapshot was captured
}

export interface HypothesisReasoningResult {
  hypotheses: HypothesisReasoningOutput[];
  // Exactly 7 hypotheses, one per constitutional domain, in domain order

  generatedAt: string;
  // ISO-8601 timestamp
}

// Input to reasoning service
export interface EvidenceInput {
  id: string;
  sourceType: 'public_website' | 'direct_hire_induction' | 'conversation' | 'manual' | 'inference' | 'system' | 'import';
  rawStatement: string;
  affected_domains: string[];
  canonical_source_url?: string;
  requested_source_url?: string;
  source_page_type?: string;
  source_evidence_kind?: string;
  source_selector?: string;
  source_content_hash?: string;
  source_retrieved_at?: string;
  /** Stable identity for the page/location. Several artifacts may share it. */
  logical_source_key?: string;
  /** Server-classified origin. The provider must not infer independence from URLs. */
  authority_type?: 'owner' | 'first_party_company' | 'customer' | 'partner' | 'independent_third_party' | 'unknown';
  /** Stable non-PII grouping key. Several sources may share one authority. */
  authority_key?: string;
}

export interface ObservationInput {
  id: string;
  evidenceId: string;
  evidenceIds?: string[];
  category?: string;
  interpreted_meaning: string;
  confidence_in_interpretation: number; // 0-100
  affected_domains: string[];
}

export interface HypothesisReasoningRequest {
  /** Omitted only for backward compatibility; omission means all_domains. */
  scope?: HypothesisReasoningScope;
  onboardingSessionId: string;
  businessRepresentationId: string;
  businessId: string;
  ownerName: string;
  businessName: string;
  requestTraceId: string;
}
