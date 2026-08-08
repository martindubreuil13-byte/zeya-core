// Hypothesis Persistence Orchestration — Type Contracts

import type { ConstitutionalDomain, HypothesisReasoningOutput } from './hypothesis-reasoning-types';

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
  source_content_hash?: string;
  captured_by_actor?: string;
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
