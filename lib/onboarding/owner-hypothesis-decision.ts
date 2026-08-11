import type { SupabaseClient } from '@supabase/supabase-js';
import { generateHypotheses } from './hypothesis-reasoning-service';
import type {
  ConstitutionalDomain,
  EvidenceInput,
  HypothesisReasoningRequest,
  HypothesisReasoningResult,
  ObservationInput,
} from './hypothesis-reasoning-types';

export type OwnerHypothesisDecision = 'approved' | 'deferred' | 'rejected';
export type OwnerOperationState = 'accepted' | 'reasoning_pending' | 'complete';

export type ApplyOwnerHypothesisDecisionInput = {
  authenticatedOwnerId: string;
  hypothesisId: string;
  decision: OwnerHypothesisDecision;
  operationId: string;
  correctionText?: string;
};

export type OwnerHypothesisDecisionResult = {
  operationId: string;
  decision: OwnerHypothesisDecision;
  operationState: OwnerOperationState;
  replayed: boolean;
  priorHypothesisId: string;
  priorHypothesisVersion: number;
  correctionEvidenceId: string | null;
  verificationId: string;
  verificationSequence: number;
  successor: {
    hypothesisId: string;
    hypothesisVersion: number;
    currentBelief: string | null;
    epistemicState: string;
    confidence: string;
    representationRisk: string;
  } | null;
};

type ReasoningFunction = (
  request: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[],
) => Promise<HypothesisReasoningResult>;

type OperationRpcRow = {
  operation_id: string;
  hypothesis_id: string;
  hypothesis_version: number;
  decision: OwnerHypothesisDecision;
  verification_id: string;
  verification_sequence: number;
  correction_evidence_id: string | null;
  successor_request_trace_id: string | null;
  operation_state: OwnerOperationState;
  replayed: boolean;
};

type OperationRow = {
  operation_id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  direct_hire_onboarding_session_id: string;
  hypothesis_id: string;
  constitutional_domain: ConstitutionalDomain;
  decision: OwnerHypothesisDecision;
  correction_evidence_id: string | null;
  verification_id: string;
  successor_request_trace_id: string | null;
};

type HypothesisRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  direct_hire_onboarding_session_id: string;
  constitutional_domain: ConstitutionalDomain;
  hypothesis_version: number;
  current_belief: string | null;
  epistemic_state: string;
  confidence: string;
  representation_risk: string;
  request_trace_id: string | null;
  previous_hypothesis_id: string | null;
};

type EvidenceRow = {
  id: string;
  source_type: EvidenceInput['sourceType'];
  raw_statement: string;
  affected_domains: string[] | null;
  induction_material_type: string | null;
  requested_source_url: string | null;
  canonical_source_url: string | null;
  source_retrieved_at: string | null;
  source_content_hash: string | null;
  source_page_type: string | null;
  source_evidence_kind: string | null;
  source_selector: string | null;
  registered_public_source_id: string | null;
  source_authority_type: EvidenceInput['authority_type'] | null;
  source_authority_key: string | null;
  created_at: string;
};

type ObservationRow = {
  id: string;
  evidence_id: string;
  interpreted_meaning: string;
  confidence_in_interpretation: number;
  affected_domains: string[] | null;
};

export class OwnerHypothesisDecisionError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'not_found' | 'operation_conflict' | 'stale_hypothesis' | 'invariant_error',
    message: string = code,
  ) {
    super(message);
    this.name = 'OwnerHypothesisDecisionError';
  }
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length === 1 ? data[0] as T : null;
}

function databaseErrorCode(error: { code?: string; message?: string }): OwnerHypothesisDecisionError {
  if (error.code === 'PZ404') return new OwnerHypothesisDecisionError('not_found');
  if (error.code === 'PZ409' && error.message === 'stale_hypothesis') {
    return new OwnerHypothesisDecisionError('stale_hypothesis');
  }
  if (error.code === 'PZ409' && error.message === 'operation_conflict') {
    return new OwnerHypothesisDecisionError('operation_conflict');
  }
  return new OwnerHypothesisDecisionError('invariant_error', 'owner action persistence failed');
}

async function loadOwnedHypothesis(
  client: SupabaseClient,
  hypothesisId: string,
  ownerId: string,
): Promise<HypothesisRow> {
  const { data, error } = await client
    .from('hypotheses')
    .select('id, owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id, constitutional_domain, hypothesis_version, current_belief, epistemic_state, confidence, representation_risk, request_trace_id, previous_hypothesis_id')
    .eq('id', hypothesisId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error || !data) throw new OwnerHypothesisDecisionError('not_found');
  return data as HypothesisRow;
}

async function loadOperation(client: SupabaseClient, operationId: string, ownerId: string): Promise<OperationRow> {
  const { data, error } = await client
    .from('hypothesis_owner_operations')
    .select('operation_id, owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id, hypothesis_id, constitutional_domain, decision, correction_evidence_id, verification_id, successor_request_trace_id')
    .eq('operation_id', operationId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error || !data) throw new OwnerHypothesisDecisionError('invariant_error', 'governed operation readback failed');
  return data as OperationRow;
}

async function loadSuccessor(client: SupabaseClient, operation: OperationRow): Promise<HypothesisRow> {
  if (!operation.successor_request_trace_id) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'successor trace missing');
  }
  const { data, error } = await client
    .from('hypotheses')
    .select('id, owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id, constitutional_domain, hypothesis_version, current_belief, epistemic_state, confidence, representation_risk, request_trace_id, previous_hypothesis_id')
    .eq('request_trace_id', operation.successor_request_trace_id)
    .maybeSingle();
  const row = data as HypothesisRow | null;
  if (error || !row || row.owner_id !== operation.owner_id
    || row.business_id !== operation.business_id
    || row.business_representation_id !== operation.business_representation_id
    || row.direct_hire_onboarding_session_id !== operation.direct_hire_onboarding_session_id
    || row.constitutional_domain !== operation.constitutional_domain
    || row.previous_hypothesis_id !== operation.hypothesis_id) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'successor lineage readback failed');
  }
  return row;
}

function resultFrom(
  action: OperationRpcRow,
  successor: HypothesisRow | null,
  state: OwnerOperationState,
): OwnerHypothesisDecisionResult {
  return {
    operationId: action.operation_id,
    decision: action.decision,
    operationState: state,
    replayed: action.replayed,
    priorHypothesisId: action.hypothesis_id,
    priorHypothesisVersion: action.hypothesis_version,
    correctionEvidenceId: action.correction_evidence_id,
    verificationId: action.verification_id,
    verificationSequence: action.verification_sequence,
    successor: successor ? {
      hypothesisId: successor.id,
      hypothesisVersion: successor.hypothesis_version,
      currentBelief: successor.current_belief,
      epistemicState: successor.epistemic_state,
      confidence: successor.confidence,
      representationRisk: successor.representation_risk,
    } : null,
  };
}

export async function applyOwnerHypothesisDecision(
  client: SupabaseClient,
  input: ApplyOwnerHypothesisDecisionInput,
  reasoning: ReasoningFunction = generateHypotheses,
): Promise<OwnerHypothesisDecisionResult> {
  const correction = input.correctionText?.trim();
  if (input.decision === 'rejected' && !correction) {
    throw new OwnerHypothesisDecisionError('invalid_request', 'correction is required');
  }
  if (input.decision !== 'rejected' && input.correctionText !== undefined) {
    throw new OwnerHypothesisDecisionError('invalid_request', 'correction is not allowed');
  }

  const priorHypothesis = await loadOwnedHypothesis(
    client,
    input.hypothesisId,
    input.authenticatedOwnerId,
  );

  const actionResponse = await client.rpc('zeya_apply_hypothesis_owner_action', {
    p_owner_id: input.authenticatedOwnerId,
    p_hypothesis_id: input.hypothesisId,
    p_decision: input.decision,
    p_operation_id: input.operationId,
    p_correction_text: input.decision === 'rejected' ? correction : null,
  });
  if (actionResponse.error) throw databaseErrorCode(actionResponse.error);
  const action = firstRow<OperationRpcRow>(actionResponse.data);
  if (!action || action.operation_id !== input.operationId || action.hypothesis_id !== input.hypothesisId) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'owner action returned invalid lineage');
  }

  const operation = await loadOperation(client, input.operationId, input.authenticatedOwnerId);
  if (operation.owner_id !== input.authenticatedOwnerId
    || operation.hypothesis_id !== input.hypothesisId
    || operation.business_id !== priorHypothesis.business_id
    || operation.business_representation_id !== priorHypothesis.business_representation_id
    || operation.direct_hire_onboarding_session_id !== priorHypothesis.direct_hire_onboarding_session_id
    || operation.constitutional_domain !== priorHypothesis.constitutional_domain
    || operation.decision !== input.decision
    || operation.verification_id !== action.verification_id) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'governed operation lineage mismatch');
  }

  if (input.decision !== 'rejected') return resultFrom(action, null, 'accepted');
  if (!action.correction_evidence_id || !operation.correction_evidence_id
    || action.correction_evidence_id !== operation.correction_evidence_id) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'correction Evidence missing');
  }
  if (action.operation_state === 'complete') {
    return resultFrom(action, await loadSuccessor(client, operation), 'complete');
  }

  const evidenceResponse = await client
    .from('evidence')
    .select(`
      id, source_type, raw_statement, affected_domains, induction_material_type, created_at,
      requested_source_url, canonical_source_url, source_retrieved_at,
      source_content_hash, source_page_type, source_evidence_kind,
      source_selector, registered_public_source_id,
      source_authority_type, source_authority_key
    `)
    .eq('direct_hire_onboarding_session_id', operation.direct_hire_onboarding_session_id)
    .eq('business_representation_id', operation.business_representation_id)
    .contains('affected_domains', [operation.constitutional_domain])
    .order('created_at', { ascending: true });
  if (evidenceResponse.error) throw new OwnerHypothesisDecisionError('invariant_error', 'Evidence scope read failed');
  const evidenceRows = (evidenceResponse.data ?? []) as EvidenceRow[];
  if (!evidenceRows.some(row => row.id === operation.correction_evidence_id)) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'correction Evidence missing from reasoning scope');
  }
  const evidenceIds = evidenceRows.map(row => row.id);
  const observationResponse = await client
    .from('observations')
    .select('id, evidence_id, interpreted_meaning, confidence_in_interpretation, affected_domains')
    .eq('business_representation_id', operation.business_representation_id)
    .in('evidence_id', evidenceIds)
    .contains('affected_domains', [operation.constitutional_domain])
    .order('created_at', { ascending: true });
  if (observationResponse.error) throw new OwnerHypothesisDecisionError('invariant_error', 'Observation scope read failed');
  const observationRows = (observationResponse.data ?? []) as ObservationRow[];
  const evidenceIdSet = new Set(evidenceIds);
  if (observationRows.some(row => !evidenceIdSet.has(row.evidence_id))) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'Observation scope mismatch');
  }

  const evidence: EvidenceInput[] = evidenceRows
    .filter(row => !(row.source_type === 'direct_hire_induction' && row.induction_material_type === 'link'))
    .map(row => {
      const publicUrl = row.canonical_source_url ?? row.requested_source_url;
      let publicHost: string | null = null;
      try {
        publicHost = publicUrl ? new URL(publicUrl).hostname.toLowerCase().replace(/^www\./, '') : null;
      } catch {
        publicHost = null;
      }
      const ownerOrigin = ['direct_hire_induction', 'conversation', 'manual'].includes(row.source_type);
      return {
        id: row.id,
        sourceType: row.source_type,
        rawStatement: row.raw_statement,
        affected_domains: row.affected_domains ?? [],
        requested_source_url: row.requested_source_url ?? undefined,
        canonical_source_url: row.canonical_source_url ?? undefined,
        source_retrieved_at: row.source_retrieved_at ?? undefined,
        source_content_hash: row.source_content_hash ?? undefined,
        source_page_type: row.source_page_type ?? undefined,
        source_evidence_kind: row.source_evidence_kind ?? undefined,
        source_selector: row.source_selector ?? undefined,
        logical_source_key: ownerOrigin
          ? `owner-origin:${row.id}`
          : row.registered_public_source_id
            ? `registered-source:${row.registered_public_source_id}`
            : `webpage:${publicUrl ?? row.id}`,
        authority_type: ownerOrigin
          ? 'owner'
          : row.source_authority_type ?? (publicHost ? 'first_party_company' : 'unknown'),
        authority_key: ownerOrigin
          ? 'owner'
          : row.source_authority_key ?? (publicHost ? `first-party-site:${publicHost}` : `unknown:${row.id}`),
      };
    });
  const observations: ObservationInput[] = observationRows.map(row => ({
    id: row.id,
    evidenceId: row.evidence_id,
    interpreted_meaning: row.interpreted_meaning,
    confidence_in_interpretation: row.confidence_in_interpretation,
    affected_domains: row.affected_domains ?? [],
  }));

  let reasoned: HypothesisReasoningResult;
  try {
    reasoned = await reasoning({
      scope: { mode: 'specific_domain', constitutionalDomain: operation.constitutional_domain },
      onboardingSessionId: operation.direct_hire_onboarding_session_id,
      businessRepresentationId: operation.business_representation_id,
      businessId: operation.business_id,
      ownerName: 'Owner',
      businessName: 'Business',
      requestTraceId: operation.successor_request_trace_id ?? operation.operation_id,
    }, evidence, observations);
  } catch {
    return resultFrom(action, null, 'reasoning_pending');
  }
  if (reasoned.hypotheses.length !== 1
    || reasoned.hypotheses[0].constitutionalDomain !== operation.constitutional_domain) {
    throw new OwnerHypothesisDecisionError('invariant_error', 'reasoning returned invalid domain result');
  }
  const successorCandidate = reasoned.hypotheses[0];

  const successorResponse = await client.rpc('zeya_persist_hypothesis_owner_correction_successor', {
    p_owner_id: input.authenticatedOwnerId,
    p_operation_id: input.operationId,
    p_constitutional_domain: successorCandidate.constitutionalDomain,
    p_epistemic_state: successorCandidate.epistemicState,
    p_current_belief: successorCandidate.currentBelief,
    p_confidence: successorCandidate.confidence,
    p_representation_risk: successorCandidate.representationRisk,
    p_risk_reason: successorCandidate.riskReason || null,
    p_source_evidence_ids: successorCandidate.sourceEvidenceIds,
    p_evidence_cutoff_at: successorCandidate.evidenceCutoffAt || reasoned.generatedAt,
  });
  if (successorResponse.error || !firstRow(successorResponse.data)) {
    return resultFrom(action, null, 'reasoning_pending');
  }

  return resultFrom(action, await loadSuccessor(client, operation), 'complete');
}
