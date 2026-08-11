// Hypothesis Persistence Orchestration — Evidence-grounded hypothesis versioning

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HypothesisReasoningOutput,
  HypothesisReasoningResult,
  EvidenceInput,
  ObservationInput,
} from './hypothesis-reasoning-types';
import { generateHypotheses } from './hypothesis-reasoning-service';
import type {
  PersistReasonedHypothesesResult,
  HypothesisPersistenceDomainResult,
  HypothesisReadbackVerification,
  DatabaseEvidence,
  DatabaseObservation,
  DatabaseDirectHireSession,
} from './persist-hypotheses-types';
import {
  constitutionalDomainsForInductionMaterial,
  isFixedInductionMaterial,
} from './induction-evidence';

// Reasoning contract version (increment when hypothesis output structure changes)
const REASONING_CONTRACT_VERSION = '1.0';

/**
 * Generate deterministic reasoning-run fingerprint.
 *
 * Same input snapshot + same contract version = same trace ID.
 * Retry using this trace = idempotent persistence.
 */
export function generateReasoningRunFingerprint(
  onboardingSessionId: string,
  businessRepresentationId: string,
  sortedEvidenceIds: string[],
  sortedObservationIds: string[]
): string {
  // Canonical input for hashing
  const canonical = [
    REASONING_CONTRACT_VERSION,
    onboardingSessionId,
    businessRepresentationId,
    ...sortedEvidenceIds,
    ...sortedObservationIds,
  ].join('|');

  const hash = createHash('sha256').update(canonical).digest('hex');
  // Truncate to 64 chars to match RPC VARCHAR(64) constraint
  return hash.substring(0, 64);
}

/**
 * Load Direct Hire onboarding session with tenant isolation validation.
 */
async function loadDirectHireSession(
  client: SupabaseClient,
  onboardingSessionId: string,
  ownerId: string
): Promise<DatabaseDirectHireSession> {
  const { data, error } = await client
    .from('direct_hire_onboarding_sessions')
    .select('id, owner_id, business_id, business_representation_id, preparation_status, created_at')
    .eq('id', onboardingSessionId)
    .eq('owner_id', ownerId)
    .single();

  if (error || !data) {
    throw new Error(`Direct Hire session not found or ownership mismatch: ${error?.message || 'not found'}`);
  }

  return data as DatabaseDirectHireSession;
}

/**
 * Load Evidence scoped to exact Direct Hire onboarding session.
 */
async function loadScopedEvidence(
  client: SupabaseClient,
  onboardingSessionId: string,
  businessRepresentationId: string
): Promise<DatabaseEvidence[]> {
  const { data, error } = await client
    .from('evidence')
    .select(`
      id,
      business_representation_id,
      direct_hire_onboarding_session_id,
      source_type,
      raw_statement,
      affected_domains,
      source_content_hash,
      captured_by_actor,
      induction_material_type,
      induction_material_label,
      created_at
    `)
    .eq('direct_hire_onboarding_session_id', onboardingSessionId)
    .eq('business_representation_id', businessRepresentationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load Evidence: ${error.message}`);
  }

  return normalizeEffectivePreparationEvidence((data || []) as DatabaseEvidence[]);
}

export function normalizeEffectivePreparationEvidence(
  evidence: DatabaseEvidence[],
): DatabaseEvidence[] {
  const effectiveFixedSlots = new Map<string, DatabaseEvidence>();
  const ungrouped: DatabaseEvidence[] = [];

  for (const row of evidence) {
    if (row.source_type !== 'direct_hire_induction'
      || !isFixedInductionMaterial(row.induction_material_label, row.induction_material_type)) {
      ungrouped.push(row);
      continue;
    }
    const slot = [
      row.direct_hire_onboarding_session_id,
      row.captured_by_actor ?? '',
      row.induction_material_type ?? '',
      row.induction_material_label ?? '',
    ].join('|');
    effectiveFixedSlots.set(slot, row);
  }

  return [...ungrouped, ...effectiveFixedSlots.values()]
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

/**
 * Load Observations scoped to supplied Evidence.
 */
async function loadScopedObservations(
  client: SupabaseClient,
  evidenceIds: Set<string>,
  businessRepresentationId: string
): Promise<DatabaseObservation[]> {
  if (evidenceIds.size === 0) {
    return [];
  }

  const { data, error } = await client
    .from('observations')
    .select(`
      id,
      business_representation_id,
      evidence_id,
      interpreted_meaning,
      confidence_in_interpretation,
      affected_domains,
      created_by_actor,
      created_at
    `)
    .eq('business_representation_id', businessRepresentationId)
    .in('evidence_id', Array.from(evidenceIds))
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load Observations: ${error.message}`);
  }

  return (data || []) as DatabaseObservation[];
}

/**
 * Validate Observation scope: each Observation must reference Evidence in supplied set.
 */
function validateObservationScope(
  observations: DatabaseObservation[],
  evidenceIds: Set<string>
): void {
  for (const obs of observations) {
    if (!evidenceIds.has(obs.evidence_id)) {
      throw new Error(
        `Observation ${obs.id} references Evidence ${obs.evidence_id} outside the loaded scope`
      );
    }
  }
}

/**
 * Convert database Evidence rows to EvidenceInput for reasoning service.
 */
export function toEvidenceInput(dbEvidence: DatabaseEvidence[]): EvidenceInput[] {
  return dbEvidence.map(e => ({
    id: e.id,
    sourceType: e.source_type as EvidenceInput['sourceType'],
    rawStatement: e.raw_statement,
    affected_domains: e.source_type === 'direct_hire_induction'
      ? [...new Set([
          ...(e.affected_domains || []),
          ...constitutionalDomainsForInductionMaterial(e.induction_material_label),
        ])]
      : e.affected_domains || [],
  }));
}

/**
 * Convert database Observation rows to ObservationInput for reasoning service.
 */
function toObservationInput(dbObservations: DatabaseObservation[]): ObservationInput[] {
  return dbObservations.map(o => ({
    id: o.id,
    evidenceId: o.evidence_id,
    interpreted_meaning: o.interpreted_meaning,
    confidence_in_interpretation: o.confidence_in_interpretation,
    affected_domains: o.affected_domains || [],
  }));
}

/**
 * Persist single hypothesis through zeya_persist_hypothesis RPC.
 */
async function persistSingleHypothesis(
  client: SupabaseClient,
  ownerId: string,
  onboardingSessionId: string,
  hypothesis: HypothesisReasoningOutput,
  reasoningRunId: string,
  evidenceCutoffAt: string
): Promise<HypothesisPersistenceDomainResult> {
  try {
    const { data, error } = await client.rpc('zeya_persist_hypothesis', {
      p_owner_id: ownerId,
      p_onboarding_session_id: onboardingSessionId,
      p_constitutional_domain: hypothesis.constitutionalDomain,
      p_epistemic_state: hypothesis.epistemicState,
      p_current_belief: hypothesis.currentBelief,
      p_confidence: hypothesis.confidence,
      p_representation_risk: hypothesis.representationRisk,
      p_risk_reason: hypothesis.riskReason || null,
      p_source_evidence_ids: hypothesis.sourceEvidenceIds,
      p_evidence_cutoff_at: evidenceCutoffAt,
      p_request_trace_id: reasoningRunId,
      p_created_by_actor: 'zeya_reasoning_service',
    });

    if (error) {
      return {
        constitutionalDomain: hypothesis.constitutionalDomain,
        persistenceStatus: 'failed',
        errorCode: error.code || 'unknown_error',
      };
    }

    if (!data || data.length === 0) {
      return {
        constitutionalDomain: hypothesis.constitutionalDomain,
        persistenceStatus: 'failed',
        errorCode: 'no_response',
      };
    }

    const result = data[0];
    return {
      constitutionalDomain: hypothesis.constitutionalDomain,
      hypothesisId: result.hypothesis_id,
      hypothesisVersion: result.hypothesis_version,
      isIdempotentReturn: result.is_idempotent_return,
      persistenceStatus: result.is_idempotent_return ? 'idempotent' : 'persisted',
    };
  } catch (error) {
    return {
      constitutionalDomain: hypothesis.constitutionalDomain,
      persistenceStatus: 'failed',
      errorCode: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

/**
 * Read back hypotheses from database to verify durable persistence.
 */
async function readbackHypotheses(
  client: SupabaseClient,
  onboardingSessionId: string
): Promise<HypothesisReadbackVerification[]> {
  const { data, error } = await client
    .from('hypotheses')
    .select(`
      id,
      constitutional_domain,
      hypothesis_version,
      epistemic_state,
      current_belief,
      confidence,
      representation_risk,
      risk_reason,
      source_evidence_ids,
      evidence_cutoff_at
    `)
    .eq('direct_hire_onboarding_session_id', onboardingSessionId);

  if (error) {
    throw new Error(`Failed to readback hypotheses: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Group by constitutional_domain and get highest version for each
  const domainMap = new Map<string, any>();
  for (const row of data) {
    const domain = row.constitutional_domain;
    const existing = domainMap.get(domain);
    if (!existing || row.hypothesis_version > existing.hypothesis_version) {
      domainMap.set(domain, row);
    }
  }

  return Array.from(domainMap.values()).map((row: any) => ({
    constitutionalDomain: row.constitutional_domain,
    hypothesisId: row.id,
    hypothesisVersion: row.hypothesis_version,
    epistemicState: row.epistemic_state,
    currentBelief: row.current_belief,
    confidence: row.confidence,
    representationRisk: row.representation_risk,
    riskReason: row.risk_reason,
    sourceEvidenceIds: row.source_evidence_ids || [],
    evidenceCutoffAt: row.evidence_cutoff_at,
  }));
}

/**
 * Verify readback matches reasoning output.
 */
function verifyReadback(
  readback: HypothesisReadbackVerification[],
  reasoning: HypothesisReasoningOutput[],
  requiredDomains: Set<string>
): boolean {
  // Exactly 7 domains
  if (readback.length !== 7 || reasoning.length !== 7) {
    return false;
  }

  const readbackByDomain = new Map(readback.map(r => [r.constitutionalDomain, r]));

  // Each reasoning result must match readback
  for (const hyp of reasoning) {
    const rb = readbackByDomain.get(hyp.constitutionalDomain);
    if (!rb) {
      return false;
    }

    if (
      rb.epistemicState !== hyp.epistemicState ||
      rb.currentBelief !== hyp.currentBelief ||
      rb.confidence !== hyp.confidence ||
      rb.representationRisk !== hyp.representationRisk ||
      (rb.riskReason || '') !== (hyp.riskReason || '') ||
      JSON.stringify(rb.sourceEvidenceIds.sort()) !==
        JSON.stringify(hyp.sourceEvidenceIds.sort())
    ) {
      return false;
    }

    // All 7 domains must be present
    if (!requiredDomains.has(hyp.constitutionalDomain)) {
      return false;
    }
  }

  return true;
}

/**
 * Main orchestration: Load Evidence/Observations, reason, persist, verify.
 */
export async function persistReasonedHypothesesForPreparation(
  client: SupabaseClient,
  onboardingSessionId: string,
  ownerId: string
): Promise<PersistReasonedHypothesesResult> {
  const snapshot = await loadPreparationReasoningSnapshot(client, onboardingSessionId, ownerId);
  const { session, evidence, observations, reasoningRunId } = snapshot;

  // Validate preparation status
  if (!['ready', 'partial'].includes(session.preparation_status)) {
    throw new Error(
      `Direct Hire preparation must be ready or partial; current status: ${session.preparation_status}`
    );
  }

  // Convert to reasoning service input
  const evidenceInput = toEvidenceInput(evidence);
  const observationInput = toObservationInput(observations);

  // Invoke reasoning service (exactly once)
  let reasoningResult: HypothesisReasoningResult;
  try {
    reasoningResult = await generateHypotheses(
      {
        scope: { mode: 'all_domains' },
        onboardingSessionId,
        businessRepresentationId: session.business_representation_id,
        businessId: session.business_id,
        ownerName: 'Owner', // Placeholder - not used for reasoning
        businessName: 'Business', // Placeholder - not used for reasoning
        requestTraceId: reasoningRunId,
      },
      evidenceInput,
      observationInput
    );
  } catch (error) {
    throw new Error(`Hypothesis reasoning failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  const evidenceCutoffAt = reasoningResult.generatedAt;
  const requiredDomains = new Set([
    'whatYouSell',
    'whoItIsFor',
    'problemOrAspiration',
    'whyCustomersShouldCare',
    'proposedDescription',
    'authorityBoundaries',
    'clarificationsNeeded',
  ]);

  // Persist all seven hypotheses
  const persistResults: HypothesisPersistenceDomainResult[] = [];
  for (const hypothesis of reasoningResult.hypotheses) {
    const result = await persistSingleHypothesis(
      client,
      ownerId,
      onboardingSessionId,
      hypothesis,
      reasoningRunId,
      evidenceCutoffAt
    );
    persistResults.push(result);
  }

  // Check persistence completeness
  const allSuccessful = persistResults.every(
    r => r.persistenceStatus === 'persisted' || r.persistenceStatus === 'idempotent'
  );

  if (!allSuccessful) {
    return {
      onboardingSessionId,
      businessRepresentationId: session.business_representation_id,
      reasoningRunId,
      evidenceCutoffAt,
      status: 'incomplete',
      domains: persistResults,
      readbackVerified: false,
    };
  }

  // Readback verification
  let readbackVerified = false;
  try {
    const readback = await readbackHypotheses(client, onboardingSessionId);
    readbackVerified = verifyReadback(readback, reasoningResult.hypotheses, requiredDomains);
  } catch (error) {
    // Readback failure means we cannot verify, but persistence may have succeeded
    readbackVerified = false;
  }

  return {
    onboardingSessionId,
    businessRepresentationId: session.business_representation_id,
    reasoningRunId,
    evidenceCutoffAt,
    status: readbackVerified && allSuccessful ? 'complete' : 'incomplete',
    domains: persistResults,
    readbackVerified,
  };
}

export interface PreparationReasoningSnapshot {
  session: DatabaseDirectHireSession;
  evidence: DatabaseEvidence[];
  observations: DatabaseObservation[];
  reasoningRunId: string;
}

export async function loadPreparationReasoningSnapshot(
  client: SupabaseClient,
  onboardingSessionId: string,
  ownerId: string,
): Promise<PreparationReasoningSnapshot> {
  const session = await loadDirectHireSession(client, onboardingSessionId, ownerId);
  if (!['ready', 'partial'].includes(session.preparation_status)) {
    throw new Error(
      `Direct Hire preparation must be ready or partial; current status: ${session.preparation_status}`,
    );
  }
  const evidence = await loadScopedEvidence(
    client,
    onboardingSessionId,
    session.business_representation_id,
  );
  if (evidence.length === 0) throw new Error('No Evidence available for reasoning');

  const evidenceIds = new Set(evidence.map(item => item.id));
  const observations = await loadScopedObservations(
    client,
    evidenceIds,
    session.business_representation_id,
  );
  validateObservationScope(observations, evidenceIds);
  const reasoningRunId = generateReasoningRunFingerprint(
    onboardingSessionId,
    session.business_representation_id,
    [...evidenceIds].sort(),
    observations.map(item => item.id).sort(),
  );
  return { session, evidence, observations, reasoningRunId };
}
