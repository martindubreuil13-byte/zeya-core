// Canonical Representation State Service Layer
// Orchestrates the complete vertical slice flow

import { SupabaseClient } from '@supabase/supabase-js';
import * as types from '@/types/representation-state';
import { RepresentationStateAdapter } from './supabase-adapter';
import { RepresentationConflictError, RepresentationInvalidInputError } from './errors';

type FounderStatementContext = {
  sourceDescription?: string;
  affectedDomains?: string[];
  affectedElementIds?: string[];
  affectedElementValues?: Record<string, unknown>;
};

export class RepresentationStateService {
  private adapter: RepresentationStateAdapter;

  constructor(private db: SupabaseClient, canonicalVersionDb?: SupabaseClient) {
    this.adapter = new RepresentationStateAdapter(db, canonicalVersionDb);
  }

  // ─────────────────────────────────────────────────────────────────────
  // VERTICAL SLICE: Founder Statement → Canonical Version
  // ─────────────────────────────────────────────────────────────────────

  async processFounderStatement(
    businessId: string,
    statement: string,
    context?: FounderStatementContext
  ): Promise<{
    evidence: types.Evidence;
    observation: types.Observation;
    proposal: types.RepresentationProposal;
    riskAssessment: types.RiskAssessmentResult;
    contradictionDetected: boolean;
    representationRestricted: boolean;
    confidenceReduced: boolean;
    reviewRequired: boolean;
  }> {
    // Step 1: Initialize representation (idempotent)
    const repId = await this.adapter.initializeRepresentation(businessId);

    // Step 2: Create evidence from founder statement
    const evidence = await this.adapter.createEvidence({
      businessRepresentationId: repId,
      sourceType: 'conversation',
      sourceDescription: context?.sourceDescription || 'Founder statement',
      rawStatement: statement,
      affectedDomains: context?.affectedDomains || [],
      affectedElementIds: context?.affectedElementIds || [],
      capturedByActor: await this.getCurrentUserId(),
    });

    // Step 3: Create observation (interpret the evidence)
    const observation = await this.adapter.createObservation({
      businessRepresentationId: repId,
      evidenceId: evidence.id,
      interpretedMeaning: statement,
      confidenceInInterpretation: 80,
      affectedDomains: context?.affectedDomains || [],
      affectedElements: context?.affectedElementIds || [],
      createdByActor: await this.getCurrentUserId(),
    });

    // Step 4: Generate proposal from observation
    const proposal = await this.adapter.createProposal({
      businessRepresentationId: repId,
      proposedChanges: {
        founder_statement: {
          before: null,
          after: statement,
        },
      },
      supportingObservationIds: [observation.id],
      supportingEvidenceIds: [evidence.id],
      affectedElementIds: context?.affectedElementIds || [],
      proposedByActor: await this.getCurrentUserId(),
      rationale: 'Initial founder statement during onboarding',
    });

    // Step 5: Assess risk and sensitivity
    const riskAssessment = await this.assessProposalRisk(proposal);

    // Update proposal with risk assessment
    await this.updateProposalRiskAssessment(proposal.id, riskAssessment);

    const contradictionResult = await this.handleContradictions({
      businessRepresentationId: repId,
      statement,
      evidence,
      observation,
      proposal,
      affectedElementIds: context?.affectedElementIds || [],
      affectedElementValues: context?.affectedElementValues || {},
      actorUserId: await this.getCurrentUserId(),
    });

    return {
      evidence,
      observation,
      proposal,
      riskAssessment,
      contradictionDetected: contradictionResult.contradictionDetected,
      representationRestricted: contradictionResult.representationRestricted,
      confidenceReduced: contradictionResult.confidenceReduced,
      reviewRequired: contradictionResult.reviewRequired,
    };
  }

  async approveAndCreateCanonicalVersion(
    businessRepresentationId: string,
    proposalId: string,
    elementValues: Record<string, any>,
    confidenceScore: number
  ): Promise<{
    approval: types.ApprovalDecision | null;
    version: types.RepresentationVersion;
    confidence: types.ConfidenceAssessment;
  }> {
    const currentUserId = await this.getCurrentUserId();
    const proposal = await this.adapter.getProposal(proposalId);
    if (!proposal || proposal.businessRepresentationId !== businessRepresentationId) {
        throw new RepresentationInvalidInputError('Proposal not found');
    }

    if (proposal.expiresAt && proposal.expiresAt.getTime() <= Date.now()) {
      throw new RepresentationConflictError('Proposal expired');
    }
    if (proposal.status === 'rejected') {
      throw new RepresentationConflictError('Proposal rejected');
    }
    if (proposal.status === 'superseded') {
      throw new RepresentationConflictError('Proposal superseded');
    }

    let approval = await this.adapter.getApprovalForProposal(proposalId);
    if (proposal.requiresApproval) {
      if (!approval || approval.decision !== 'approved') {
        throw new RepresentationConflictError('Approval required');
      }
      if (approval.approverUserId !== currentUserId) {
        throw new RepresentationConflictError('Approval required');
      }
    }

    // Step 2: Mark proposal as approved
    if (proposal.status !== 'approved') {
      await this.adapter.updateProposalStatus(proposalId, 'approved');
    }

    // Step 3: Get representation to validate Business relationship for atomic Version creation
    const representation = await this.adapter.getRepresentation(businessRepresentationId);
    if (!representation) {
      throw new RepresentationInvalidInputError('Representation not found');
    }

    // Step 4: Create canonical version (atomic RPC that updates current_version_id)
    const version = await this.adapter.createCanonicalVersion({
      businessId: representation.businessId,
      businessRepresentationId,
      sourceProposalId: proposalId,
      elementValues,
      overallConfidenceScore: confidenceScore,
      actorUserId: currentUserId,
    });

    // CRITICAL: Do NOT call pointElementsToVersion() here.
    // zeya_create_canonical_version_atomic updates both the Business Representation
    // current-Version pointer and matching Element current-value pointers in the same transaction.

    // Step 4: Calculate and store confidence assessment
    const confidenceAssessment = await this.calculateConfidence(
      businessRepresentationId,
      version.id,
      confidenceScore
    );

    return {
      approval,
      version,
      confidence: confidenceAssessment,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // RISK ASSESSMENT
  // ─────────────────────────────────────────────────────────────────────

  async assessProposalRisk(proposal: types.RepresentationProposal): Promise<types.RiskAssessmentResult> {
    // Deterministic risk assessment based on proposal content and classification
    let riskTier: types.RiskTier = 'low';
    let highestSensitivityClass: types.FieldSensitivityClass = 'operational';
    const rules: string[] = [];

    // Check for high-risk fields in proposed changes
    const changeKeys = Object.keys(proposal.proposedChanges);
    for (const key of changeKeys) {
      if (this.isHighRiskField(key)) {
        riskTier = 'high';
        highestSensitivityClass = this.mapFieldToSensitivity(key);
        rules.push(`Field '${key}' is high-risk and requires approval`);
        break;
      } else if (this.isMediumRiskField(key) && riskTier === 'low') {
        riskTier = 'medium';
        highestSensitivityClass = this.mapFieldToSensitivity(key);
        rules.push(`Field '${key}' is medium-risk and requires review`);
      }
    }

    return {
      riskTier,
      highestSensitivityClass,
      requiresApproval: riskTier === 'high',
      reasoning: `Proposal contains ${riskTier}-risk changes; highest sensitivity class: ${highestSensitivityClass}`,
      ruleIdentifiers: rules,
    };
  }

  private isHighRiskField(fieldKey: string): boolean {
    const highRiskFields = ['pricing', 'guarantee', 'legal', 'regulatory', 'commitment', 'capability'];
    return highRiskFields.some((risk) => fieldKey.toLowerCase().includes(risk));
  }

  private isMediumRiskField(fieldKey: string): boolean {
    const mediumRiskFields = ['positioning', 'target_market', 'strategy', 'channel'];
    return mediumRiskFields.some((risk) => fieldKey.toLowerCase().includes(risk));
  }

  private mapFieldToSensitivity(fieldKey: string): types.FieldSensitivityClass {
    if (fieldKey.includes('pricing')) return 'pricing';
    if (fieldKey.includes('guarantee') || fieldKey.includes('warranty')) return 'guarantees';
    if (fieldKey.includes('legal')) return 'legal';
    if (fieldKey.includes('regulatory') || fieldKey.includes('compliance')) return 'regulatory';
    if (fieldKey.includes('capability') || fieldKey.includes('feature')) return 'product_capability';
    if (fieldKey.includes('commitment') || fieldKey.includes('promise')) return 'customer_commitment';
    if (fieldKey.includes('positioning') || fieldKey.includes('strategy')) return 'strategic_positioning';
    if (fieldKey.includes('target') || fieldKey.includes('market')) return 'target_market';
    if (fieldKey.includes('financial') || fieldKey.includes('revenue')) return 'financial';
    return 'operational';
  }

  private hasContradictionSignal(statement: string): boolean {
    return /\b(contradict\w*|conflict\w*|wrong|false|inaccurate|no longer|do not|don't|does not|doesn't|not true|instead)\b/i.test(statement);
  }

  private async handleContradictions(input: {
    businessRepresentationId: string;
    statement: string;
    evidence: types.Evidence;
    observation: types.Observation;
    proposal: types.RepresentationProposal;
    affectedElementIds: string[];
    affectedElementValues: Record<string, unknown>;
    actorUserId: string;
  }): Promise<{
    contradictionDetected: boolean;
    representationRestricted: boolean;
    confidenceReduced: boolean;
    reviewRequired: boolean;
  }> {
    const conflictedElementIds: string[] = [];
    const details: Array<{
      elementId: string;
      elementKey: string;
      priorEligibility: types.ClaimEligibilityState;
      priorValue: unknown;
      newValue: unknown;
    }> = [];

    for (const elementId of input.affectedElementIds) {
      const element = await this.adapter.getElement(elementId);
      if (!element || element.businessRepresentationId !== input.businessRepresentationId) {
        throw new RepresentationInvalidInputError('Invalid affected element');
      }

      const priorValue = await this.adapter.getCurrentElementValue(element);
      if (priorValue === null) continue;

      const newValue = input.affectedElementValues[elementId] ?? input.statement;
      if (!this.valuesConflict(priorValue, newValue)) continue;

      conflictedElementIds.push(element.id);
      details.push({
        elementId: element.id,
        elementKey: element.elementKey,
        priorEligibility: element.claimEligibility,
        priorValue,
        newValue,
      });
    }

    if (conflictedElementIds.length === 0) {
      return {
        contradictionDetected: false,
        representationRestricted: false,
        confidenceReduced: false,
        reviewRequired: false,
      };
    }

    const currentVersion = await this.adapter.getCurrentVersion(input.businessRepresentationId);
    if (!currentVersion) {
      throw new RepresentationConflictError('No current version to evaluate contradiction');
    }

    const priorConfidence = await this.adapter.getConfidenceForVersion(currentVersion.id);
    if (!priorConfidence) {
      throw new RepresentationConflictError('No current confidence to evaluate contradiction');
    }

    const restrictedElements = await this.adapter.restrictElementsByIdForContradiction(
      input.businessRepresentationId,
      conflictedElementIds
    );
    const evidenceCount = await this.adapter.countEvidence(input.businessRepresentationId);
    const newConfidence = await this.adapter.createContradictionConfidenceAssessment(
      input.businessRepresentationId,
      priorConfidence,
      evidenceCount,
      conflictedElementIds
    );

    await this.adapter.createAuditEvent({
      businessRepresentationId: input.businessRepresentationId,
      eventType: 'contradiction_detected',
      evidenceId: input.evidence.id,
      observationId: input.observation.id,
      proposalId: input.proposal.id,
      versionId: currentVersion.id,
      actorUserId: input.actorUserId,
      details: {
        reason: 'targeted_evidence_conflicts_with_current_canonical_value',
        affectedElements: details.map((detail) => ({
          elementId: detail.elementId,
          elementKey: detail.elementKey,
          priorEligibility: detail.priorEligibility,
          newEligibility: 'disputed',
          priorValue: detail.priorValue,
          newValue: detail.newValue,
          priorIsDisputed: false,
          newIsDisputed: true,
        })),
        restrictedElementCount: restrictedElements.length,
        priorConfidenceId: priorConfidence.id,
        priorConfidenceScore: priorConfidence.confidenceScore,
        newConfidenceId: newConfidence.id,
        newConfidenceScore: newConfidence.confidenceScore,
        contradictionPenalty: newConfidence.contradictionPenalty,
        actorUserId: input.actorUserId,
        reviewRequired: true,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      contradictionDetected: true,
      representationRestricted: restrictedElements.length > 0,
      confidenceReduced: newConfidence.confidenceScore < priorConfidence.confidenceScore,
      reviewRequired: true,
    };
  }

  private valuesConflict(currentValue: unknown, newValue: unknown): boolean {
    const normalizedCurrent = this.normalizeComparableValue(currentValue);
    const normalizedNew = this.normalizeComparableValue(newValue);
    return normalizedCurrent.length > 0 && normalizedNew.length > 0 && normalizedCurrent !== normalizedNew;
  }

  private normalizeComparableValue(value: unknown): string {
    const extracted = this.extractValue(value);
    if (Array.isArray(extracted)) {
      return extracted.map((item) => this.normalizeComparableValue(item)).sort().join('|');
    }
    return String(extracted ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private extractValue(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  private async updateProposalRiskAssessment(proposalId: string, assessment: types.RiskAssessmentResult): Promise<void> {
    // This would require UPDATE access to representation_proposals (for risk assessment fields)
    // In practice, this might be handled by the application or a separate service
    // For now, risk assessment is determined at read time
  }

  // ─────────────────────────────────────────────────────────────────────
  // CONFIDENCE ASSESSMENT
  // ─────────────────────────────────────────────────────────────────────

  async calculateConfidence(
    businessRepresentationId: string,
    versionId: string,
    baseScore: number
  ): Promise<types.ConfidenceAssessment> {
    // Get the version to analyze
    const version = await this.adapter.getVersion(versionId);
    if (!version) throw new Error('Version not found');

    const evidenceCount = await this.adapter.countEvidence(businessRepresentationId);

    // Simplified confidence calculation
    const factors = {
      base_score: baseScore,
      evidence_count_boost: 5,
      founder_confirmation_boost: 10,
    };

    const finalScore = Math.min(100, baseScore + (factors.evidence_count_boost + factors.founder_confirmation_boost));
    const band = this.getConfidenceBand(finalScore);

    const assessment: Omit<types.ConfidenceAssessment, 'id' | 'createdAt'> = {
      businessRepresentationId,
      representationVersionId: versionId,
      confidenceScore: finalScore,
      confidenceBand: band,
      evidenceCount,
      sourceDiversityScore: 50,
      sourceQualityScore: 100,
      recencyScore: 100,
      contradictionPenalty: 0,
      calculationMethod: 'founder_statement_initial',
      calculationVersion: '1.0',
      calculationTimestamp: new Date(),
      rationale: `Initial founder statement with direct confirmation. Base confidence ${baseScore}% increased by direct source and founder validation.`,
      factors,
    };

    return this.adapter.createConfidenceAssessment(businessRepresentationId, versionId, assessment);
  }

  private getConfidenceBand(score: number): types.ConfidenceBand {
    if (score < 20) return 'very_low';
    if (score < 40) return 'low';
    if (score < 60) return 'moderate';
    if (score < 80) return 'high';
    return 'very_high';
  }

  // ─────────────────────────────────────────────────────────────────────
  // AGENT CONTEXT RETRIEVAL
  // ─────────────────────────────────────────────────────────────────────

  async getAgentContext(
    businessRepresentationId: string,
    includeProvisional: boolean = false
  ): Promise<types.AgentRepresentationContext | null> {
    return this.adapter.getAgentContext(businessRepresentationId, includeProvisional);
  }

  // ─────────────────────────────────────────────────────────────────────
  // AUDIT LINEAGE
  // ─────────────────────────────────────────────────────────────────────

  async getCompleteAuditLineage(businessRepresentationId: string): Promise<types.AuditEvent[]> {
    return this.adapter.getAuditLineage(businessRepresentationId);
  }

  // ─────────────────────────────────────────────────────────────────────
  // ROLLBACK CAPABILITY
  // ─────────────────────────────────────────────────────────────────────

  async rollbackToVersion(
    businessRepresentationId: string,
    targetVersionId: string
  ): Promise<types.RepresentationVersion> {
    const targetVersion = await this.adapter.getVersion(targetVersionId);
    if (!targetVersion) throw new Error('Target version not found');

    // Create a new version that restores the target version's content
    // This is handled through the database function which manages lineage
    const currentUserId = await this.getCurrentUserId();

    // Get the latest version to use as source proposal
    const current = await this.adapter.getCurrentVersion(businessRepresentationId);
    if (!current) throw new Error('No current version to rollback from');

    // Get representation to obtain businessId for atomic RPC
    const representation = await this.adapter.getRepresentation(businessRepresentationId);
    if (!representation) throw new Error('Representation not found');

    // Create a rollback version through the database function
    const rollbackVersion = await this.adapter.createCanonicalVersion({
      businessId: representation.businessId,
      businessRepresentationId,
      sourceProposalId: current.sourceProposalId,
      elementValues: targetVersion.elementValues,
      overallConfidenceScore: targetVersion.overallConfidenceScore,
      actorUserId: currentUserId,
      rollbackOfVersionId: targetVersionId,
    });
    return rollbackVersion;
  }

  // ─────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────

  private async getCurrentUserId(): Promise<string> {
    const { data, error } = await this.db.auth.getUser();
    if (error || !data.user) throw new Error('Authentication required');
    return data.user.id;
  }

  async getRepresentationState(businessRepresentationId: string): Promise<{
    representation: types.BusinessRepresentation;
    domains: types.RepresentationDomain[];
    elements: types.RepresentationElement[];
    currentVersion: types.RepresentationVersion | null;
    currentConfidence: types.ConfidenceAssessment | null;
  }> {
    const representation = await this.adapter.getRepresentation(businessRepresentationId);
    if (!representation) throw new Error('Representation not found');

    const [domains, elements, currentVersion] = await Promise.all([
      this.adapter.getDomains(businessRepresentationId),
      this.adapter.getElements(businessRepresentationId),
      representation.currentVersionId ? this.adapter.getVersion(representation.currentVersionId) : Promise.resolve(null),
    ]);

    let currentConfidence: types.ConfidenceAssessment | null = null;
    if (currentVersion) {
      currentConfidence = await this.adapter.getConfidenceForVersion(currentVersion.id);
    }

    return {
      representation,
      domains,
      elements,
      currentVersion,
      currentConfidence,
    };
  }
}

export function createRepresentationStateService(
  db: SupabaseClient,
  canonicalVersionDb?: SupabaseClient
): RepresentationStateService {
  return new RepresentationStateService(db, canonicalVersionDb);
}
