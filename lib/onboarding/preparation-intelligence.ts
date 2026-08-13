import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadPreparationReasoningSnapshot,
  persistReasonedHypothesesForPreparation,
} from './persist-hypotheses-orchestration';
import { PreparationReasoningStageError } from './hypothesis-reasoning-service';

export const PREPARATION_DOMAINS = [
  'whatYouSell',
  'whoItIsFor',
  'problemOrAspiration',
  'whyCustomersShouldCare',
  'proposedDescription',
  'authorityBoundaries',
  'clarificationsNeeded',
] as const;

export type PreparationDomain = (typeof PREPARATION_DOMAINS)[number];
export type EpistemicState = 'supported' | 'partial' | 'unknown' | 'contradicted';
export type HypothesisConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type RepresentationRisk = 'high' | 'medium' | 'low';

export interface CurrentPreparationHypothesis {
  id: string;
  constitutionalDomain: PreparationDomain;
  epistemicState: EpistemicState;
  currentBelief: string | null;
  confidence: HypothesisConfidence;
  representationRisk: RepresentationRisk;
  riskReason: string | null;
  verificationNeed: string | null;
  sourceEvidenceIds: string[];
  hypothesisVersion: number;
  previousHypothesisId: string | null;
  ownerDecision: 'approved' | 'rejected' | 'deferred' | null;
  requestTraceId: string | null;
  createdByActor: string;
}

export interface PreparationProjectionDomain {
  constitutionalDomain: PreparationDomain;
  provisionalUnderstanding: string | null;
  epistemicState: EpistemicState;
  confidence: HypothesisConfidence;
  representationRisk: RepresentationRisk;
  riskReason: string | null;
  verificationNeed: string | null;
  hypothesisVersion: number;
  ownerDecision: 'approved' | 'rejected' | 'deferred' | null;
  evidenceBasis: { citationCount: number; sourceTypes: string[] };
}

export interface OwnerPreparationProjection {
  businessIdentity: { ownerName: string; businessName: string; growthPriority: string };
  domains: Record<PreparationDomain, PreparationProjectionDomain>;
  majorUnknowns: string[];
  priorityClarifications: string[];
  authorityConstraints: string[];
  contradictions: Array<{ domain: PreparationDomain; provisionalUnderstanding: string | null; riskReason: string | null }>;
  preparationCompleteness: { complete: true; domainCount: 7; supported: number; partial: number; unknown: number; contradicted: number };
}

export interface PrivatePreparationProjection extends OwnerPreparationProjection {
  privateSourceEvidenceIds: Record<PreparationDomain, string[]>;
}

type Scope = {
  ownerId: string;
  businessId: string;
  businessRepresentationId: string;
  onboardingSessionId: string;
};

type SessionRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  owner_relationship_name: string;
  growth_priority: string;
  preparation_status: string;
};

type HypothesisRow = {
  id: string;
  constitutional_domain: string;
  epistemic_state: EpistemicState;
  current_belief: string | null;
  confidence: HypothesisConfidence;
  representation_risk: RepresentationRisk;
  risk_reason: string | null;
  source_evidence_ids: string[] | null;
  hypothesis_version: number;
  previous_hypothesis_id: string | null;
  request_trace_id: string | null;
  created_by_actor: string;
};

const DOMAIN_LABELS: Record<PreparationDomain, string> = {
  whatYouSell: 'what the business sells',
  whoItIsFor: 'who it is for',
  problemOrAspiration: 'the problem or aspiration it addresses',
  whyCustomersShouldCare: 'why customers should care',
  proposedDescription: 'how the business should be described',
  authorityBoundaries: 'what must never be claimed, promised, or assumed',
  clarificationsNeeded: 'what still needs clarification',
};

export class PreparationIntelligenceIncompleteError extends Error {
  constructor(message = 'The complete seven-domain hypothesis set is not available') {
    super(message);
    this.name = 'PreparationIntelligenceIncompleteError';
  }
}

function isPreparationDomain(value: string): value is PreparationDomain {
  return (PREPARATION_DOMAINS as readonly string[]).includes(value);
}

async function loadSession(client: SupabaseClient, scope: Scope): Promise<SessionRow> {
  const result = await client
    .from('direct_hire_onboarding_sessions')
    .select('id, owner_id, business_id, business_representation_id, owner_relationship_name, growth_priority, preparation_status')
    .eq('id', scope.onboardingSessionId)
    .eq('owner_id', scope.ownerId)
    .eq('business_id', scope.businessId)
    .eq('business_representation_id', scope.businessRepresentationId)
    .maybeSingle();
  if (result.error) throw new Error(`Preparation session lookup failed: ${result.error.message}`);
  if (!result.data) throw new Error('Preparation session lineage mismatch');
  return result.data as SessionRow;
}

export async function loadCurrentPreparationHypotheses(
  client: SupabaseClient,
  scope: Scope,
): Promise<CurrentPreparationHypothesis[]> {
  await loadSession(client, scope);
  const result = await client
    .from('hypotheses')
    .select('id, constitutional_domain, epistemic_state, current_belief, confidence, representation_risk, risk_reason, source_evidence_ids, hypothesis_version, previous_hypothesis_id, request_trace_id, created_by_actor')
    .eq('owner_id', scope.ownerId)
    .eq('business_id', scope.businessId)
    .eq('business_representation_id', scope.businessRepresentationId)
    .eq('direct_hire_onboarding_session_id', scope.onboardingSessionId)
    .order('constitutional_domain', { ascending: true })
    .order('hypothesis_version', { ascending: false });
  if (result.error) throw new Error(`Current hypothesis lookup failed: ${result.error.message}`);

  const allRows = (result.data ?? []) as HypothesisRow[];
  const rowsById = new Map(allRows.map((row) => [row.id, row]));
  const current = new Map<PreparationDomain, HypothesisRow>();
  for (const row of allRows) {
    if (!isPreparationDomain(row.constitutional_domain) || current.has(row.constitutional_domain)) continue;
    current.set(row.constitutional_domain, row);
  }
  if (current.size !== PREPARATION_DOMAINS.length) return [];

  const rows = PREPARATION_DOMAINS.map((domain) => current.get(domain)!);
  for (const row of rows) {
    if ((row.hypothesis_version === 1) !== (row.previous_hypothesis_id === null)) {
      throw new Error(`Invalid current hypothesis lineage for ${row.constitutional_domain}`);
    }
    if (row.previous_hypothesis_id) {
      const predecessor = rowsById.get(row.previous_hypothesis_id);
      if (
        !predecessor
        || predecessor.constitutional_domain !== row.constitutional_domain
        || predecessor.hypothesis_version !== row.hypothesis_version - 1
      ) {
        throw new Error(`Broken current hypothesis predecessor lineage for ${row.constitutional_domain}`);
      }
    }
  }

  const hypothesisIds = rows.map((row) => row.id);
  const verificationResult = await client
    .from('hypothesis_verifications')
    .select('hypothesis_id, verification_sequence, decision')
    .in('hypothesis_id', hypothesisIds)
    .order('verification_sequence', { ascending: false });
  if (verificationResult.error) throw new Error(`Hypothesis verification lookup failed: ${verificationResult.error.message}`);
  const decisions = new Map<string, 'approved' | 'rejected' | 'deferred'>();
  for (const verification of verificationResult.data ?? []) {
    if (!decisions.has(verification.hypothesis_id)) decisions.set(verification.hypothesis_id, verification.decision);
  }

  return rows.map((row) => ({
    id: row.id,
    constitutionalDomain: row.constitutional_domain as PreparationDomain,
    epistemicState: row.epistemic_state,
    currentBelief: row.current_belief,
    confidence: row.confidence,
    representationRisk: row.representation_risk,
    riskReason: row.risk_reason,
    verificationNeed: null,
    sourceEvidenceIds: row.source_evidence_ids ?? [],
    hypothesisVersion: row.hypothesis_version,
    previousHypothesisId: row.previous_hypothesis_id,
    ownerDecision: decisions.get(row.id) ?? null,
    requestTraceId: row.request_trace_id,
    createdByActor: row.created_by_actor,
  }));
}

export async function loadFreshCurrentPreparationHypotheses(
  client: SupabaseClient,
  scope: Scope,
): Promise<CurrentPreparationHypothesis[]> {
  const current = await loadCurrentPreparationHypotheses(client, scope);
  if (current.length !== PREPARATION_DOMAINS.length) return [];
  const snapshot = await loadPreparationReasoningSnapshot(
    client,
    scope.onboardingSessionId,
    scope.ownerId,
  );
  return hasCurrentReasoningSnapshot(current, snapshot.reasoningRunId)
    ? current
    : [];
}

export function hasCurrentReasoningSnapshot(
  hypotheses: CurrentPreparationHypothesis[],
  reasoningRunId: string,
): boolean {
  return hypotheses.length === PREPARATION_DOMAINS.length
    && hypotheses.every(hypothesis => hypothesis.requestTraceId === reasoningRunId);
}

export async function ensurePreparationIntelligence(
  client: SupabaseClient,
  scope: Scope,
): Promise<CurrentPreparationHypothesis[]> {
  let existing: CurrentPreparationHypothesis[];
  try {
    existing = await loadFreshCurrentPreparationHypotheses(client, scope);
  } catch (error) {
    if (error instanceof PreparationReasoningStageError) throw error;
    throw new PreparationReasoningStageError(
      error instanceof Error && error.message.startsWith('Observation ')
        ? 'preparation_reasoning_observation_scope_invalid'
        : 'preparation_reasoning_snapshot_invalid',
    );
  }
  if (existing.length === PREPARATION_DOMAINS.length) return existing;
  let result;
  try {
    result = await persistReasonedHypothesesForPreparation(client, scope.onboardingSessionId, scope.ownerId);
  } catch (error) {
    if (error instanceof PreparationReasoningStageError) throw error;
    throw new PreparationReasoningStageError('preparation_reasoning_snapshot_invalid');
  }
  if (result.status !== 'complete' || !result.readbackVerified || result.domains.length !== PREPARATION_DOMAINS.length) {
    const failedDomains = result.domains
      .filter(domain => domain.persistenceStatus === 'failed')
      .map(domain => `${domain.constitutionalDomain}:${domain.errorCode ?? 'unknown'}`)
      .join(',');
    throw new PreparationReasoningStageError(
      failedDomains
        ? 'preparation_reasoning_persistence_failed'
        : 'preparation_reasoning_readback_failed',
    );
  }
  const current = await loadFreshCurrentPreparationHypotheses(client, scope);
  if (current.length !== PREPARATION_DOMAINS.length) throw new PreparationIntelligenceIncompleteError();
  return current;
}

export async function buildPrivatePreparationProjection(
  client: SupabaseClient,
  scope: Scope,
): Promise<PrivatePreparationProjection> {
  const session = await loadSession(client, scope);
  const hypotheses = await loadFreshCurrentPreparationHypotheses(client, scope);
  if (hypotheses.length !== PREPARATION_DOMAINS.length) throw new PreparationIntelligenceIncompleteError();

  const businessResult = await client.from('businesses').select('business_name').eq('id', scope.businessId).eq('user_id', scope.ownerId).maybeSingle();
  if (businessResult.error) throw new Error(`Business lookup failed: ${businessResult.error.message}`);
  if (!businessResult.data) throw new Error('Business lineage mismatch');

  const evidenceIds = [...new Set(hypotheses.flatMap((hypothesis) => hypothesis.sourceEvidenceIds))];
  const evidenceResult = evidenceIds.length === 0
    ? { data: [], error: null }
    : await client
        .from('evidence')
        .select('id, source_type')
        .eq('business_representation_id', scope.businessRepresentationId)
        .eq('direct_hire_onboarding_session_id', scope.onboardingSessionId)
        .in('id', evidenceIds);
  if (evidenceResult.error) throw new Error(`Scoped Evidence lookup failed: ${evidenceResult.error.message}`);
  const evidenceById = new Map((evidenceResult.data ?? []).map((row) => [row.id, row.source_type]));
  if (evidenceById.size !== evidenceIds.length) throw new Error('Hypothesis cites Evidence outside the exact preparation scope');

  const domains = {} as Record<PreparationDomain, PreparationProjectionDomain>;
  const privateSourceEvidenceIds = {} as Record<PreparationDomain, string[]>;
  for (const hypothesis of hypotheses) {
    const sourceTypes = [...new Set(hypothesis.sourceEvidenceIds.map((id) => evidenceById.get(id)!))].sort();
    domains[hypothesis.constitutionalDomain] = {
      constitutionalDomain: hypothesis.constitutionalDomain,
      provisionalUnderstanding: hypothesis.currentBelief,
      epistemicState: hypothesis.epistemicState,
      confidence: hypothesis.confidence,
      representationRisk: hypothesis.representationRisk,
      riskReason: hypothesis.riskReason,
      verificationNeed: hypothesis.verificationNeed,
      hypothesisVersion: hypothesis.hypothesisVersion,
      ownerDecision: hypothesis.ownerDecision,
      evidenceBasis: { citationCount: hypothesis.sourceEvidenceIds.length, sourceTypes },
    };
    privateSourceEvidenceIds[hypothesis.constitutionalDomain] = [...hypothesis.sourceEvidenceIds];
  }

  const unknownDomains = hypotheses.filter((hypothesis) => hypothesis.epistemicState === 'unknown');
  const uncertainDomains = hypotheses.filter((hypothesis) => ['unknown', 'partial', 'contradicted'].includes(hypothesis.epistemicState));
  const count = (state: EpistemicState) => hypotheses.filter((hypothesis) => hypothesis.epistemicState === state).length;
  return {
    businessIdentity: {
      ownerName: session.owner_relationship_name,
      businessName: businessResult.data.business_name,
      growthPriority: session.growth_priority,
    },
    domains,
    majorUnknowns: unknownDomains.map((hypothesis) => DOMAIN_LABELS[hypothesis.constitutionalDomain]),
    priorityClarifications: uncertainDomains.map((hypothesis) =>
      hypothesis.verificationNeed ?? `Please clarify ${DOMAIN_LABELS[hypothesis.constitutionalDomain]}.`,
    ),
    authorityConstraints: domains.authorityBoundaries.provisionalUnderstanding
      ? [domains.authorityBoundaries.provisionalUnderstanding]
      : [],
    contradictions: hypotheses
      .filter((hypothesis) => hypothesis.epistemicState === 'contradicted')
      .map((hypothesis) => ({
        domain: hypothesis.constitutionalDomain,
        provisionalUnderstanding: hypothesis.currentBelief,
        riskReason: hypothesis.riskReason,
      })),
    preparationCompleteness: {
      complete: true,
      domainCount: 7,
      supported: count('supported'),
      partial: count('partial'),
      unknown: count('unknown'),
      contradicted: count('contradicted'),
    },
    privateSourceEvidenceIds,
  };
}

export function toOwnerPreparationProjection(projection: PrivatePreparationProjection): OwnerPreparationProjection {
  const { privateSourceEvidenceIds: _privateSourceEvidenceIds, ...ownerProjection } = projection;
  return ownerProjection;
}
