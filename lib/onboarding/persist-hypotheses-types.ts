// Hypothesis Persistence Orchestration — Type Contracts

import type { ConstitutionalDomain, EvidenceInput, HypothesisReasoningOutput } from './hypothesis-reasoning-types';

// Individual domain persistence result
export interface HypothesisPersistenceDomainResult {
  constitutionalDomain: ConstitutionalDomain;
  hypothesisId?: string;
  hypothesisVersion?: number;
  isIdempotentReturn?: boolean;
  persistenceStatus: 'persisted' | 'idempotent' | 'failed';
  errorCode?: string;
}

// Overall orchestration result
export interface PersistReasonedHypothesesResult {
  onboardingSessionId: string;
  businessRepresentationId: string;
  reasoningRunId: string; // Deterministic fingerprint
  evidenceCutoffAt: string; // ISO-8601 timestamp
  status: 'complete' | 'incomplete';
  domains: HypothesisPersistenceDomainResult[];
  readbackVerified: boolean;
}

// Readback verification result (internal)
export interface HypothesisReadbackVerification {
  constitutionalDomain: ConstitutionalDomain;
  hypothesisId: string;
  hypothesisVersion: number;
  epistemicState: string;
  currentBelief: string | null;
  confidence: string;
  representationRisk: string;
  riskReason: string;
  sourceEvidenceIds: string[];
  evidenceCutoffAt: string;
}

// Database Evidence row (for loading)
export interface DatabaseEvidence {
  id: string;
  business_representation_id: string;
  direct_hire_onboarding_session_id: string;
  source_type: string;
  raw_statement: string;
  affected_domains: string[];
  requested_source_url?: string | null;
  canonical_source_url?: string | null;
  source_retrieved_at?: string | null;
  source_content_hash?: string | null;
  source_page_type?: string | null;
  source_evidence_kind?: string | null;
  source_selector?: string | null;
  extraction_method_version?: string | null;
  registered_public_source_id?: string | null;
  source_authority_type?: EvidenceInput['authority_type'] | null;
  source_authority_key?: string | null;
  captured_by_actor?: string;
  induction_material_type?: string | null;
  induction_material_label?: string | null;
  created_at: string;
}

// Database Observation row (for loading)
export interface DatabaseObservation {
  id: string;
  business_representation_id: string;
  evidence_id: string;
  interpreted_meaning: string;
  confidence_in_interpretation: number;
  affected_domains: string[];
  created_by_actor?: string;
  created_at: string;
}

// Database DirectHireOnboardingSession row
export interface DatabaseDirectHireSession {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  preparation_status: string;
  created_at: string;
}
