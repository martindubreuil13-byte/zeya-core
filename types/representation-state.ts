// Canonical Representation State — TypeScript Domain Model
// Mirrors the deployed Supabase schema
// Separates persistence models from domain entities

// ─────────────────────────────────────────────────────────────────────
// ENUM TYPES (match PostgreSQL enums)
// ─────────────────────────────────────────────────────────────────────

export type RepresentationPhase = 'surface' | 'structural' | 'predictive' | 'contextual' | 'integrated';
export type RiskTier = 'low' | 'medium' | 'high';
export type FieldSensitivityClass =
  | 'legal'
  | 'regulatory'
  | 'pricing'
  | 'guarantees'
  | 'product_capability'
  | 'customer_commitment'
  | 'strategic_positioning'
  | 'target_market'
  | 'financial'
  | 'confidential'
  | 'reputational'
  | 'operational';
export type ClaimEligibilityState = 'approved_for_external_use' | 'internal_only' | 'provisional' | 'disputed' | 'prohibited' | 'expired';
export type ProposalStatus = 'draft' | 'risk_assessed' | 'pending_approval' | 'approved' | 'rejected' | 'superseded';
export type EvidenceSourceType = 'conversation' | 'call_result' | 'manual' | 'inference' | 'system' | 'import';
export type RepresentationElementType = 'fact' | 'pattern' | 'inference' | 'positioning' | 'commitment';
export type ApprovalDecisionType = 'approved' | 'rejected' | 'deferred';
export type ConfidenceBand = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
export type AuditEventType =
  | 'representation_initialized'
  | 'evidence_created'
  | 'observation_created'
  | 'proposal_created'
  | 'proposal_assessed'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'contradiction_detected'
  | 'version_created'
  | 'version_rolled_back'
  | 'confidence_calculated'
  | 'domain_maturity_updated';

// ─────────────────────────────────────────────────────────────────────
// PERSISTENCE MODELS (Supabase row types)
// ─────────────────────────────────────────────────────────────────────

export interface BusinessRepresentationRow {
  id: string;
  business_id: string;
  user_id: string;
  current_phase: RepresentationPhase;
  current_version_id: string | null;
  overall_confidence_score: number;
  overall_confidence_updated_at: string | null;
  fidelity_last_assessed_at: string | null;
  fidelity_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface RepresentationDomainRow {
  id: string;
  business_representation_id: string;
  domain_name: string;
  current_phase: RepresentationPhase;
  confidence_score: number;
  confidence_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepresentationElementRow {
  id: string;
  business_representation_id: string;
  representation_domain_id: string;
  element_key: string;
  element_type: RepresentationElementType;
  current_value_version_id: string | null;
  is_disputed: boolean;
  claim_eligibility: ClaimEligibilityState;
  field_sensitivity: FieldSensitivityClass;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  business_representation_id: string;
  source_type: EvidenceSourceType;
  source_description: string | null;
  raw_statement: string;
  statement_hash: string;
  affected_domains: string[];
  captured_by_actor: string | null;
  created_at: string;
}

export interface ObservationRow {
  id: string;
  business_representation_id: string;
  evidence_id: string;
  interpreted_meaning: string;
  confidence_in_interpretation: number;
  affected_domains: string[];
  affected_elements: string[];
  created_by_actor: string | null;
  created_at: string;
}

export interface RepresentationProposalRow {
  id: string;
  business_representation_id: string;
  proposed_changes: Record<string, any>;
  risk_tier: RiskTier | null;
  highest_sensitivity_class: FieldSensitivityClass | null;
  requires_approval: boolean;
  status: ProposalStatus;
  status_updated_at: string;
  proposed_by_actor: string;
  rationale: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ProposalObservationRow {
  proposal_id: string;
  observation_id: string;
  business_representation_id: string;
}

export interface ProposalEvidenceRow {
  proposal_id: string;
  evidence_id: string;
  business_representation_id: string;
}

export interface ProposalElementRow {
  proposal_id: string;
  element_id: string;
  business_representation_id: string;
}

export interface ApprovalDecisionRow {
  id: string;
  business_representation_id: string;
  representation_proposal_id: string;
  decision: ApprovalDecisionType;
  approver_user_id: string;
  approval_reason: string | null;
  created_at: string;
}

export interface RepresentationVersionRow {
  id: string;
  business_representation_id: string;
  previous_version_id: string | null;
  source_proposal_id: string;
  source_approval_id: string | null;
  element_values: Record<string, any>;
  version_number: number;
  overall_confidence_score: number;
  created_by_actor: string;
  created_at: string;
  content_hash: string;
}

export interface ConfidenceAssessmentRow {
  id: string;
  business_representation_id: string;
  representation_version_id: string;
  confidence_score: number;
  confidence_band: ConfidenceBand;
  evidence_count: number;
  source_diversity_score: number | null;
  source_quality_score: number | null;
  recency_score: number | null;
  contradiction_penalty: number;
  calculation_method: string;
  calculation_version: string;
  calculation_timestamp: string;
  rationale: string;
  factors: Record<string, any>;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  business_representation_id: string;
  event_type: AuditEventType;
  evidence_id: string | null;
  observation_id: string | null;
  proposal_id: string | null;
  version_id: string | null;
  approval_id: string | null;
  actor_user_id: string | null;
  actor_system: string | null;
  details: Record<string, any>;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────
// DOMAIN ENTITIES (business logic)
// ─────────────────────────────────────────────────────────────────────

export interface BusinessRepresentation {
  id: string;
  businessId: string;
  userId: string;
  currentPhase: RepresentationPhase;
  currentVersionId: string | null;
  overallConfidenceScore: number;
  overallConfidenceUpdatedAt: Date | null;
  fidelityLastAssessedAt: Date | null;
  fidelityScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepresentationDomain {
  id: string;
  businessRepresentationId: string;
  domainName: string;
  currentPhase: RepresentationPhase;
  confidenceScore: number;
  confidenceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepresentationElement {
  id: string;
  businessRepresentationId: string;
  representationDomainId: string;
  elementKey: string;
  elementType: RepresentationElementType;
  currentValueVersionId: string | null;
  isDisputed: boolean;
  claimEligibility: ClaimEligibilityState;
  fieldSensitivity: FieldSensitivityClass;
  createdAt: Date;
  updatedAt: Date;
}

export interface Evidence {
  id: string;
  businessRepresentationId: string;
  sourceType: EvidenceSourceType;
  sourceDescription: string | null;
  rawStatement: string;
  statementHash: string;
  affectedDomains: string[];
  capturedByActor: string | null;
  createdAt: Date;
}

export interface Observation {
  id: string;
  businessRepresentationId: string;
  evidenceId: string;
  interpretedMeaning: string;
  confidenceInInterpretation: number;
  affectedDomains: string[];
  affectedElements: string[];
  createdByActor: string | null;
  createdAt: Date;
}

export interface RepresentationProposal {
  id: string;
  businessRepresentationId: string;
  proposedChanges: Record<string, any>;
  riskTier: RiskTier | null;
  highestSensitivityClass: FieldSensitivityClass | null;
  requiresApproval: boolean;
  status: ProposalStatus;
  statusUpdatedAt: Date;
  proposedByActor: string;
  rationale: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ApprovalDecision {
  id: string;
  businessRepresentationId: string;
  representationProposalId: string;
  decision: ApprovalDecisionType;
  approverUserId: string;
  approvalReason: string | null;
  createdAt: Date;
}

export interface RepresentationVersion {
  id: string;
  businessRepresentationId: string;
  previousVersionId: string | null;
  sourceProposalId: string;
  sourceApprovalId: string | null;
  elementValues: Record<string, any>;
  versionNumber: number;
  overallConfidenceScore: number;
  createdByActor: string;
  createdAt: Date;
  contentHash: string;
}

export interface ConfidenceAssessment {
  id: string;
  businessRepresentationId: string;
  representationVersionId: string;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  evidenceCount: number;
  sourceDiversityScore: number | null;
  sourceQualityScore: number | null;
  recencyScore: number | null;
  contradictionPenalty: number;
  calculationMethod: string;
  calculationVersion: string;
  calculationTimestamp: Date;
  rationale: string;
  factors: Record<string, any>;
  createdAt: Date;
}

export interface AuditEvent {
  id: string;
  businessRepresentationId: string;
  eventType: AuditEventType;
  evidenceId: string | null;
  observationId: string | null;
  proposalId: string | null;
  versionId: string | null;
  approvalId: string | null;
  actorUserId: string | null;
  actorSystem: string | null;
  details: Record<string, any>;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// MUTATION COMMANDS
// ─────────────────────────────────────────────────────────────────────

export interface CreateEvidenceCommand {
  businessRepresentationId: string;
  sourceType: EvidenceSourceType;
  sourceDescription?: string;
  rawStatement: string;
  affectedDomains?: string[];
  affectedElementIds?: string[];
  capturedByActor?: string;
}

export interface CreateObservationCommand {
  businessRepresentationId: string;
  evidenceId: string;
  interpretedMeaning: string;
  confidenceInInterpretation: number;
  affectedDomains?: string[];
  affectedElements?: string[];
  createdByActor?: string;
}

export interface CreateProposalCommand {
  businessRepresentationId: string;
  proposedChanges: Record<string, any>;
  supportingObservationIds: string[];
  supportingEvidenceIds?: string[];
  affectedElementIds: string[];
  riskTier?: RiskTier;
  highestSensitivityClass?: FieldSensitivityClass;
  requiresApproval?: boolean;
  proposedByActor: string;
  rationale?: string;
  expiresAt?: Date;
}

export interface CreateApprovalCommand {
  businessRepresentationId: string;
  representationProposalId: string;
  decision: ApprovalDecisionType;
  approverUserId: string;
  approvalReason?: string;
}

export interface CreateCanonicalVersionCommand {
  businessRepresentationId: string;
  sourceProposalId: string;
  elementValues: Record<string, any>;
  overallConfidenceScore: number;
  actorUserId: string;
  rollbackOfVersionId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// QUERY RESULTS
// ─────────────────────────────────────────────────────────────────────

export interface RepresentationProposalWithRelations extends RepresentationProposal {
  observations: Observation[];
  evidence: Evidence[];
  elements: RepresentationElement[];
}

export interface RepresentationVersionWithLineage extends RepresentationVersion {
  previousVersion: RepresentationVersion | null;
  confidenceAssessment: ConfidenceAssessment | null;
  sourceProposal: RepresentationProposal;
  sourceApproval: ApprovalDecision | null;
}

// ─────────────────────────────────────────────────────────────────────
// AGENT-FACING REPRESENTATION CONTEXT
// ─────────────────────────────────────────────────────────────────────

export interface AgentContextElement {
  elementId: string;
  elementKey: string;
  elementType: RepresentationElementType;
  currentValue: Record<string, any> | null;
  overallConfidenceScore: number;
  claimEligibility: ClaimEligibilityState;
  fieldSensitivity: FieldSensitivityClass;
}

export interface AgentRepresentationContext {
  businessRepresentationId: string;
  elements: AgentContextElement[];
  retrievedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// RISK ASSESSMENT RESULT
// ─────────────────────────────────────────────────────────────────────

export interface RiskAssessmentResult {
  riskTier: RiskTier;
  highestSensitivityClass: FieldSensitivityClass;
  requiresApproval: boolean;
  reasoning: string;
  ruleIdentifiers: string[];
}

// ─────────────────────────────────────────────────────────────────────
// AUDIT LINEAGE
// ─────────────────────────────────────────────────────────────────────

export interface AuditLineageItem {
  event: AuditEvent;
  evidence?: Evidence;
  observation?: Observation;
  proposal?: RepresentationProposal;
  version?: RepresentationVersion;
  approval?: ApprovalDecision;
}

export interface CompleteAuditLineage {
  evidence: Evidence;
  observation: Observation;
  proposal: RepresentationProposal;
  approval: ApprovalDecision | null;
  version: RepresentationVersion;
  confidenceAssessment: ConfidenceAssessment;
  auditEvents: AuditEvent[];
}
