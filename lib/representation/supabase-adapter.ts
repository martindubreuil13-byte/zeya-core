// Supabase Database Adapter for Canonical Representation State
// Direct database access with minimal transformation

import { SupabaseClient } from '@supabase/supabase-js';
import * as types from '@/types/representation-state';
import { RepresentationNotFoundError } from './errors';

export class RepresentationStateAdapter {
  constructor(private db: SupabaseClient) {}

  // ─────────────────────────────────────────────────────────────────────
  // EVIDENCE (Immutable)
  // ─────────────────────────────────────────────────────────────────────

  async createEvidence(cmd: types.CreateEvidenceCommand): Promise<types.Evidence> {
    const { data, error } = await this.db
      .from('evidence')
      .insert({
        business_representation_id: cmd.businessRepresentationId,
        source_type: cmd.sourceType,
        source_description: cmd.sourceDescription || null,
        raw_statement: cmd.rawStatement,
        affected_domains: cmd.affectedDomains || [],
        captured_by_actor: cmd.capturedByActor || null,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapEvidenceRowToEntity(data as types.EvidenceRow);
  }

  async getEvidence(evidenceId: string): Promise<types.Evidence | null> {
    const { data, error } = await this.db
      .from('evidence')
      .select()
      .eq('id', evidenceId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapEvidenceRowToEntity(data as types.EvidenceRow);
  }

  async countEvidence(businessRepresentationId: string): Promise<number> {
    const { count, error } = await this.db
      .from('evidence')
      .select('id', { count: 'exact', head: true })
      .eq('business_representation_id', businessRepresentationId);

    if (error) throw error;
    return count ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────
  // OBSERVATIONS
  // ─────────────────────────────────────────────────────────────────────

  async createObservation(cmd: types.CreateObservationCommand): Promise<types.Observation> {
    const { data, error } = await this.db
      .from('observations')
      .insert({
        business_representation_id: cmd.businessRepresentationId,
        evidence_id: cmd.evidenceId,
        interpreted_meaning: cmd.interpretedMeaning,
        confidence_in_interpretation: cmd.confidenceInInterpretation,
        affected_domains: cmd.affectedDomains || [],
        affected_elements: cmd.affectedElements || [],
        created_by_actor: cmd.createdByActor || null,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapObservationRowToEntity(data as types.ObservationRow);
  }

  async getObservation(observationId: string): Promise<types.Observation | null> {
    const { data, error } = await this.db
      .from('observations')
      .select()
      .eq('id', observationId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapObservationRowToEntity(data as types.ObservationRow);
  }

  // ─────────────────────────────────────────────────────────────────────
  // REPRESENTATION PROPOSALS
  // ─────────────────────────────────────────────────────────────────────

  async createProposal(cmd: types.CreateProposalCommand): Promise<types.RepresentationProposal> {
    const { data: proposalData, error: proposalError } = await this.db
      .from('representation_proposals')
      .insert({
        business_representation_id: cmd.businessRepresentationId,
        proposed_changes: cmd.proposedChanges,
        risk_tier: cmd.riskTier || null,
        highest_sensitivity_class: cmd.highestSensitivityClass || null,
        requires_approval: cmd.requiresApproval || false,
        proposed_by_actor: cmd.proposedByActor,
        rationale: cmd.rationale || null,
        expires_at: cmd.expiresAt?.toISOString() || null,
      })
      .select()
      .single();

    if (proposalError) throw proposalError;
    const proposal = this.mapProposalRowToEntity(proposalData as types.RepresentationProposalRow);

    // Add observations
    if (cmd.supportingObservationIds.length > 0) {
      const { error: obsError } = await this.db.from('proposal_observations').insert(
        cmd.supportingObservationIds.map((obsId) => ({
          proposal_id: proposal.id,
          observation_id: obsId,
          business_representation_id: cmd.businessRepresentationId,
        }))
      );
      if (obsError) throw obsError;
    }

    // Add evidence
    if (cmd.supportingEvidenceIds && cmd.supportingEvidenceIds.length > 0) {
      const { error: evError } = await this.db.from('proposal_evidence').insert(
        cmd.supportingEvidenceIds.map((evId) => ({
          proposal_id: proposal.id,
          evidence_id: evId,
          business_representation_id: cmd.businessRepresentationId,
        }))
      );
      if (evError) throw evError;
    }

    // Add elements
    if (cmd.affectedElementIds.length > 0) {
      const { error: elemError } = await this.db.from('proposal_elements').insert(
        cmd.affectedElementIds.map((elemId) => ({
          proposal_id: proposal.id,
          element_id: elemId,
          business_representation_id: cmd.businessRepresentationId,
        }))
      );
      if (elemError) throw elemError;
    }

    return proposal;
  }

  async getProposal(proposalId: string): Promise<types.RepresentationProposal | null> {
    const { data, error } = await this.db
      .from('representation_proposals')
      .select()
      .eq('id', proposalId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapProposalRowToEntity(data as types.RepresentationProposalRow);
  }

  async updateProposalStatus(proposalId: string, status: types.ProposalStatus): Promise<types.RepresentationProposal> {
    const { data, error } = await this.db
      .from('representation_proposals')
      .update({ status })
      .eq('id', proposalId)
      .select()
      .single();

    if (error) throw error;
    return this.mapProposalRowToEntity(data as types.RepresentationProposalRow);
  }

  // ─────────────────────────────────────────────────────────────────────
  // APPROVAL DECISIONS
  // ─────────────────────────────────────────────────────────────────────

  async createApprovalDecision(cmd: types.CreateApprovalCommand): Promise<types.ApprovalDecision> {
    const { data, error } = await this.db
      .from('approval_decisions')
      .insert({
        business_representation_id: cmd.businessRepresentationId,
        representation_proposal_id: cmd.representationProposalId,
        decision: cmd.decision,
        approver_user_id: cmd.approverUserId,
        approval_reason: cmd.approvalReason || null,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapApprovalRowToEntity(data as types.ApprovalDecisionRow);
  }

  async getApprovalForProposal(proposalId: string): Promise<types.ApprovalDecision | null> {
    const { data, error } = await this.db
      .from('approval_decisions')
      .select()
      .eq('representation_proposal_id', proposalId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapApprovalRowToEntity(data as types.ApprovalDecisionRow);
  }

  // ─────────────────────────────────────────────────────────────────────
  // REPRESENTATION VERSIONS (created via database function only)
  // ─────────────────────────────────────────────────────────────────────

  async createCanonicalVersion(cmd: types.CreateCanonicalVersionCommand): Promise<types.RepresentationVersion> {
    const { data, error } = await this.db.rpc('zeya_create_canonical_version', {
      p_business_representation_id: cmd.businessRepresentationId,
      p_source_proposal_id: cmd.sourceProposalId,
      p_element_values: cmd.elementValues,
      p_overall_confidence_score: cmd.overallConfidenceScore,
      p_actor_user_id: cmd.actorUserId,
      p_rollback_of_version_id: cmd.rollbackOfVersionId || null,
    });

    if (error) throw error;
    return this.mapVersionRowToEntity(data as types.RepresentationVersionRow);
  }

  async getVersion(versionId: string): Promise<types.RepresentationVersion | null> {
    const { data, error } = await this.db
      .from('representation_versions')
      .select()
      .eq('id', versionId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapVersionRowToEntity(data as types.RepresentationVersionRow);
  }

  async getCurrentVersion(businessRepresentationId: string): Promise<types.RepresentationVersion | null> {
    const { data: repData, error: repError } = await this.db
      .from('business_representations')
      .select('current_version_id')
      .eq('id', businessRepresentationId)
      .single();

    if (repError) throw repError;
    if (!repData.current_version_id) return null;

    return this.getVersion(repData.current_version_id);
  }

  async getVersionLineage(versionId: string): Promise<types.RepresentationVersion[]> {
    const lineage: types.RepresentationVersion[] = [];
    let current = await this.getVersion(versionId);

    while (current) {
      lineage.unshift(current);
      if (!current.previousVersionId) break;
      current = await this.getVersion(current.previousVersionId);
    }

    return lineage;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CONFIDENCE ASSESSMENTS
  // ─────────────────────────────────────────────────────────────────────

  async createConfidenceAssessment(
    businessRepresentationId: string,
    versionId: string,
    assessment: Omit<types.ConfidenceAssessment, 'id' | 'createdAt'>
  ): Promise<types.ConfidenceAssessment> {
    const { data, error } = await this.db
      .from('confidence_assessments')
      .insert({
        business_representation_id: businessRepresentationId,
        representation_version_id: versionId,
        confidence_score: assessment.confidenceScore,
        confidence_band: assessment.confidenceBand,
        evidence_count: assessment.evidenceCount,
        source_diversity_score: assessment.sourceDiversityScore,
        source_quality_score: assessment.sourceQualityScore,
        recency_score: assessment.recencyScore,
        contradiction_penalty: assessment.contradictionPenalty,
        calculation_method: assessment.calculationMethod,
        calculation_version: assessment.calculationVersion,
        calculation_timestamp: assessment.calculationTimestamp.toISOString(),
        rationale: assessment.rationale,
        factors: assessment.factors,
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapConfidenceRowToEntity(data as types.ConfidenceAssessmentRow);
  }

  async createContradictionConfidenceAssessment(
    businessRepresentationId: string,
    currentConfidence: types.ConfidenceAssessment,
    evidenceCount: number,
    affectedElementIds: string[]
  ): Promise<types.ConfidenceAssessment> {
    const nextPenalty = Math.min(100, Math.max(currentConfidence.contradictionPenalty, 20));
    const nextScore = Math.max(0, currentConfidence.confidenceScore - nextPenalty);
    const assessment: Omit<types.ConfidenceAssessment, 'id' | 'createdAt'> = {
      businessRepresentationId,
      representationVersionId: currentConfidence.representationVersionId,
      confidenceScore: nextScore,
      confidenceBand: this.getConfidenceBandForScore(nextScore),
      evidenceCount,
      sourceDiversityScore: currentConfidence.sourceDiversityScore,
      sourceQualityScore: currentConfidence.sourceQualityScore,
      recencyScore: currentConfidence.recencyScore,
      contradictionPenalty: nextPenalty,
      calculationMethod: 'contradiction_penalty_v1',
      calculationVersion: '1.1',
      calculationTimestamp: new Date(),
      rationale: 'Contradictory evidence targeted an active canonical claim. The claim was restricted from external representation and confidence was reduced pending human review.',
      factors: {
        ...currentConfidence.factors,
        previous_confidence_score: currentConfidence.confidenceScore,
        contradiction_penalty: nextPenalty,
        affected_element_ids: affectedElementIds,
        review_required: true,
      },
    };

    return this.createConfidenceAssessment(businessRepresentationId, currentConfidence.representationVersionId, assessment);
  }

  async applyContradictionConfidencePenalty(businessRepresentationId: string): Promise<void> {
    const currentVersion = await this.getCurrentVersion(businessRepresentationId);
    if (!currentVersion) return;

    const currentConfidence = await this.getConfidenceForVersion(currentVersion.id);
    if (!currentConfidence) return;

    const nextPenalty = Math.min(100, currentConfidence.contradictionPenalty + 20);
    const nextScore = Math.max(0, currentConfidence.confidenceScore - 20);

    const { error } = await this.db
      .from('confidence_assessments')
      .update({
        confidence_score: nextScore,
        confidence_band: this.getConfidenceBandForScore(nextScore),
        contradiction_penalty: nextPenalty,
        rationale: `${currentConfidence.rationale} Contradictory evidence reduced confidence and restricted affected claims.`,
        factors: {
          ...currentConfidence.factors,
          contradiction_adjustment: -20,
        },
      })
      .eq('id', currentConfidence.id);

    if (error) throw error;
  }

  private getConfidenceBandForScore(score: number): types.ConfidenceBand {
    if (score < 20) return 'very_low';
    if (score < 40) return 'low';
    if (score < 60) return 'moderate';
    if (score < 80) return 'high';
    return 'very_high';
  }

  async getConfidenceForVersion(versionId: string): Promise<types.ConfidenceAssessment | null> {
    const { data, error } = await this.db
      .from('confidence_assessments')
      .select()
      .eq('representation_version_id', versionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return this.mapConfidenceRowToEntity(data as types.ConfidenceAssessmentRow);
  }

  // ─────────────────────────────────────────────────────────────────────
  // BUSINESS REPRESENTATION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────

  async initializeRepresentation(businessId: string): Promise<string> {
    // Get current user from auth context
    const { data: { user }, error: authError } = await this.db.auth.getUser();
    if (authError || !user) {
      throw new Error('User not authenticated');
    }

    const { data: business, error: businessError } = await this.db
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .maybeSingle();

    if (businessError || !business?.id) {
      throw new RepresentationNotFoundError();
    }

    // Check if representation already exists (idempotent)
    const { data: existing } = await this.db
      .from('business_representations')
      .select('id')
      .eq('business_id', businessId)
      .single();

    if (existing?.id) {
      return existing.id;
    }

    // Create business representation directly
    const { data: rep, error: repError } = await this.db
      .from('business_representations')
      .insert({
        business_id: businessId,
        user_id: user.id,
        current_phase: 'surface',
      })
      .select('id')
      .single();

    if (repError) throw repError;

    // Initialize domains
    const domains = [
      'business_identity', 'offer', 'customer', 'market', 'positioning',
      'differentiation', 'objections', 'trust', 'qualification',
      'commercial_objectives', 'operational_constraints', 'channel_expression'
    ];

    const domainRecords = domains.map(name => ({
      business_representation_id: rep.id,
      domain_name: name,
      current_phase: 'surface',
      confidence_score: 0,
    }));

    const { error: domainsError } = await this.db
      .from('representation_domains')
      .insert(domainRecords);

    if (domainsError) throw domainsError;

    return rep.id;
  }

  async getRepresentation(repId: string): Promise<types.BusinessRepresentation | null> {
    const { data, error } = await this.db
      .from('business_representations')
      .select()
      .eq('id', repId)
      .single();

    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return this.mapRepresentationRowToEntity(data as types.BusinessRepresentationRow);
  }

  async getDomains(repId: string): Promise<types.RepresentationDomain[]> {
    const { data, error } = await this.db
      .from('representation_domains')
      .select()
      .eq('business_representation_id', repId);

    if (error) throw error;
    return (data as types.RepresentationDomainRow[]).map((row) => this.mapDomainRowToEntity(row));
  }

  async getElements(repId: string): Promise<types.RepresentationElement[]> {
    const { data, error } = await this.db
      .from('representation_elements')
      .select()
      .eq('business_representation_id', repId);

    if (error) throw error;
    return (data as types.RepresentationElementRow[]).map((row) => this.mapElementRowToEntity(row));
  }

  async getElement(elementId: string): Promise<types.RepresentationElement | null> {
    const { data, error } = await this.db
      .from('representation_elements')
      .select()
      .eq('id', elementId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return this.mapElementRowToEntity(data as types.RepresentationElementRow);
  }

  async getCurrentElementValue(element: types.RepresentationElement): Promise<unknown | null> {
    if (!element.currentValueVersionId) return null;

    const version = await this.getVersion(element.currentValueVersionId);
    if (!version) return null;
    // Canonical payloads are keyed by the stable element key. Older callers may
    // have used the UUID, so retain that lookup as a backwards-compatible fallback.
    return version.elementValues[element.elementKey] ?? version.elementValues[element.id] ?? null;
  }

  async restrictElementsByIdForContradiction(
    businessRepresentationId: string,
    elementIds: string[]
  ): Promise<types.RepresentationElement[]> {
    if (elementIds.length === 0) return [];

    const { data, error } = await this.db
      .from('representation_elements')
      .update({ is_disputed: true, claim_eligibility: 'disputed' })
      .eq('business_representation_id', businessRepresentationId)
      .in('id', elementIds)
      .select();

    if (error) throw error;
    const restricted = (data ?? []).map((row) => this.mapElementRowToEntity(row as types.RepresentationElementRow));
    if (restricted.length !== elementIds.length) {
      throw new RepresentationNotFoundError();
    }
    return restricted;
  }

  async pointElementsToVersion(
    businessRepresentationId: string,
    version: types.RepresentationVersion
  ): Promise<void> {
    const keys = Object.keys(version.elementValues);
    if (keys.length === 0) return;
    const { error } = await this.db
      .from('representation_elements')
      .update({ current_value_version_id: version.id })
      .eq('business_representation_id', businessRepresentationId)
      .in('element_key', keys);
    if (error) throw error;
  }

  async restrictElementsForContradiction(
    businessRepresentationId: string,
    affectedDomains: string[],
    actorUserId: string
  ): Promise<number> {
    const domainsQuery = this.db
      .from('representation_domains')
      .select('id')
      .eq('business_representation_id', businessRepresentationId);

    const { data: domains, error: domainsError } = affectedDomains.length > 0
      ? await domainsQuery.in('domain_name', affectedDomains)
      : await domainsQuery;

    if (domainsError) throw domainsError;

    const domainIds = (domains ?? []).map((domain) => domain.id);
    if (domainIds.length === 0) return 0;

    const { data, error } = await this.db
      .from('representation_elements')
      .update({ is_disputed: true, claim_eligibility: 'disputed' })
      .eq('business_representation_id', businessRepresentationId)
      .in('representation_domain_id', domainIds)
      .select('id');

    if (error) throw error;

    const affectedCount = data?.length ?? 0;
    if (affectedCount > 0) {
      await this.createAuditEvent({
        businessRepresentationId,
        eventType: 'proposal_assessed',
        actorUserId,
        details: {
          action: 'contradiction_restricted_elements',
          affectedDomains,
          affectedElementCount: affectedCount,
        },
      });
    }

    return affectedCount;
  }

  // ─────────────────────────────────────────────────────────────────────
  // AGENT CONTEXT RETRIEVAL
  // ─────────────────────────────────────────────────────────────────────

  async getAgentContext(
    businessRepresentationId: string,
    includeProvisional: boolean = false
  ): Promise<types.AgentRepresentationContext | null> {
    const { data, error } = await this.db.rpc('get_agent_representation_context', {
      p_business_representation_id: businessRepresentationId,
      p_include_provisional: includeProvisional,
    });

    if (error) throw error;
    if (!data || data.length === 0) {
      return {
        businessRepresentationId,
        elements: [],
        retrievedAt: new Date(),
      };
    }

    const elements = await Promise.all((data as Array<any>).map(async (row) => {
      let currentValue = row.current_value;
      if (currentValue === null) {
        const element = await this.getElement(row.element_id);
        if (element) currentValue = await this.getCurrentElementValue(element);
      }
      return {
        elementId: row.element_id,
        elementKey: row.element_key,
        elementType: row.element_type as types.RepresentationElementType,
        currentValue,
        overallConfidenceScore: row.overall_confidence_score,
        claimEligibility: row.claim_eligibility as types.ClaimEligibilityState,
        fieldSensitivity: row.field_sensitivity as types.FieldSensitivityClass,
      };
    }));

    return {
      businessRepresentationId,
      elements,
      retrievedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // AUDIT EVENTS (Immutable)
  // ─────────────────────────────────────────────────────────────────────

  async getAuditLineage(businessRepresentationId: string): Promise<types.AuditEvent[]> {
    const { data, error } = await this.db
      .from('audit_events')
      .select()
      .eq('business_representation_id', businessRepresentationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as types.AuditEventRow[]).map((row) => this.mapAuditRowToEntity(row));
  }

  async createAuditEvent(cmd: {
    businessRepresentationId: string;
    eventType: types.AuditEventType;
    evidenceId?: string | null;
    observationId?: string | null;
    proposalId?: string | null;
    versionId?: string | null;
    approvalId?: string | null;
    actorUserId?: string | null;
    details?: Record<string, any>;
  }): Promise<void> {
    const { error } = await this.db
      .from('audit_events')
      .insert({
        business_representation_id: cmd.businessRepresentationId,
        event_type: cmd.eventType,
        evidence_id: cmd.evidenceId ?? null,
        observation_id: cmd.observationId ?? null,
        proposal_id: cmd.proposalId ?? null,
        version_id: cmd.versionId ?? null,
        approval_id: cmd.approvalId ?? null,
        actor_user_id: cmd.actorUserId ?? null,
        details: cmd.details ?? {},
      });

    if (error) throw error;
  }

  // ─────────────────────────────────────────────────────────────────────
  // ROW TO ENTITY MAPPERS
  // ─────────────────────────────────────────────────────────────────────

  private mapRepresentationRowToEntity(row: types.BusinessRepresentationRow): types.BusinessRepresentation {
    return {
      id: row.id,
      businessId: row.business_id,
      userId: row.user_id,
      currentPhase: row.current_phase,
      currentVersionId: row.current_version_id,
      overallConfidenceScore: row.overall_confidence_score,
      overallConfidenceUpdatedAt: row.overall_confidence_updated_at ? new Date(row.overall_confidence_updated_at) : null,
      fidelityLastAssessedAt: row.fidelity_last_assessed_at ? new Date(row.fidelity_last_assessed_at) : null,
      fidelityScore: row.fidelity_score,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapDomainRowToEntity(row: types.RepresentationDomainRow): types.RepresentationDomain {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      domainName: row.domain_name,
      currentPhase: row.current_phase,
      confidenceScore: row.confidence_score,
      confidenceUpdatedAt: row.confidence_updated_at ? new Date(row.confidence_updated_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapElementRowToEntity(row: types.RepresentationElementRow): types.RepresentationElement {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      representationDomainId: row.representation_domain_id,
      elementKey: row.element_key,
      elementType: row.element_type,
      currentValueVersionId: row.current_value_version_id,
      isDisputed: row.is_disputed,
      claimEligibility: row.claim_eligibility,
      fieldSensitivity: row.field_sensitivity,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapEvidenceRowToEntity(row: types.EvidenceRow): types.Evidence {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      sourceType: row.source_type,
      sourceDescription: row.source_description,
      rawStatement: row.raw_statement,
      statementHash: row.statement_hash,
      affectedDomains: row.affected_domains,
      capturedByActor: row.captured_by_actor,
      createdAt: new Date(row.created_at),
    };
  }

  private mapObservationRowToEntity(row: types.ObservationRow): types.Observation {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      evidenceId: row.evidence_id,
      interpretedMeaning: row.interpreted_meaning,
      confidenceInInterpretation: row.confidence_in_interpretation,
      affectedDomains: row.affected_domains,
      affectedElements: row.affected_elements,
      createdByActor: row.created_by_actor,
      createdAt: new Date(row.created_at),
    };
  }

  private mapProposalRowToEntity(row: types.RepresentationProposalRow): types.RepresentationProposal {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      proposedChanges: row.proposed_changes,
      riskTier: row.risk_tier,
      highestSensitivityClass: row.highest_sensitivity_class,
      requiresApproval: row.requires_approval,
      status: row.status,
      statusUpdatedAt: new Date(row.status_updated_at),
      proposedByActor: row.proposed_by_actor,
      rationale: row.rationale,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  private mapApprovalRowToEntity(row: types.ApprovalDecisionRow): types.ApprovalDecision {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      representationProposalId: row.representation_proposal_id,
      decision: row.decision,
      approverUserId: row.approver_user_id,
      approvalReason: row.approval_reason,
      createdAt: new Date(row.created_at),
    };
  }

  private mapVersionRowToEntity(row: types.RepresentationVersionRow): types.RepresentationVersion {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      previousVersionId: row.previous_version_id,
      sourceProposalId: row.source_proposal_id,
      sourceApprovalId: row.source_approval_id,
      elementValues: row.element_values,
      versionNumber: row.version_number,
      overallConfidenceScore: row.overall_confidence_score,
      createdByActor: row.created_by_actor,
      createdAt: new Date(row.created_at),
      contentHash: row.content_hash,
    };
  }

  private mapConfidenceRowToEntity(row: types.ConfidenceAssessmentRow): types.ConfidenceAssessment {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      representationVersionId: row.representation_version_id,
      confidenceScore: row.confidence_score,
      confidenceBand: row.confidence_band,
      evidenceCount: row.evidence_count,
      sourceDiversityScore: row.source_diversity_score,
      sourceQualityScore: row.source_quality_score,
      recencyScore: row.recency_score,
      contradictionPenalty: row.contradiction_penalty,
      calculationMethod: row.calculation_method,
      calculationVersion: row.calculation_version,
      calculationTimestamp: new Date(row.calculation_timestamp),
      rationale: row.rationale,
      factors: row.factors,
      createdAt: new Date(row.created_at),
    };
  }

  private mapAuditRowToEntity(row: types.AuditEventRow): types.AuditEvent {
    return {
      id: row.id,
      businessRepresentationId: row.business_representation_id,
      eventType: row.event_type,
      evidenceId: row.evidence_id,
      observationId: row.observation_id,
      proposalId: row.proposal_id,
      versionId: row.version_id,
      approvalId: row.approval_id,
      actorUserId: row.actor_user_id,
      actorSystem: row.actor_system,
      details: row.details,
      createdAt: new Date(row.created_at),
    };
  }
}

export function createRepresentationStateAdapter(db: SupabaseClient): RepresentationStateAdapter {
  return new RepresentationStateAdapter(db);
}
