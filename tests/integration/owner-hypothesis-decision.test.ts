import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyOwnerHypothesisDecision,
  OwnerHypothesisDecisionError,
} from '../../lib/onboarding/owner-hypothesis-decision';
import type { HypothesisReasoningResult } from '../../lib/onboarding/hypothesis-reasoning-types';

const ownerId = '10000000-0000-4000-8000-000000000001';
const hypothesisId = '20000000-0000-4000-8000-000000000001';
const operationId = '30000000-0000-4000-8000-000000000001';
const correctionEvidenceId = '40000000-0000-4000-8000-000000000001';
const verificationId = '50000000-0000-4000-8000-000000000001';

const prior = {
  id: hypothesisId,
  owner_id: ownerId,
  business_id: 'business-1',
  business_representation_id: 'representation-1',
  direct_hire_onboarding_session_id: 'session-1',
  constitutional_domain: 'whatYouSell',
  hypothesis_version: 1,
  current_belief: 'Old belief',
  epistemic_state: 'partial',
  confidence: 'medium',
  representation_risk: 'medium',
  request_trace_id: 'old-trace',
  previous_hypothesis_id: null,
};

function action(decision: 'approved' | 'deferred' | 'rejected', state = 'accepted', replayed = false) {
  return {
    operation_id: operationId,
    hypothesis_id: hypothesisId,
    hypothesis_version: 1,
    decision,
    verification_id: verificationId,
    verification_sequence: 1,
    correction_evidence_id: decision === 'rejected' ? correctionEvidenceId : null,
    successor_request_trace_id: decision === 'rejected' ? 'successor-trace' : null,
    operation_state: state,
    replayed,
  };
}

function operation(decision: 'approved' | 'deferred' | 'rejected') {
  return {
    operation_id: operationId,
    owner_id: ownerId,
    business_id: 'business-1',
    business_representation_id: 'representation-1',
    direct_hire_onboarding_session_id: 'session-1',
    hypothesis_id: hypothesisId,
    constitutional_domain: 'whatYouSell',
    decision,
    correction_evidence_id: decision === 'rejected' ? correctionEvidenceId : null,
    verification_id: verificationId,
    successor_request_trace_id: decision === 'rejected' ? 'successor-trace' : null,
  };
}

const successor = {
  ...prior,
  id: '60000000-0000-4000-8000-000000000001',
  hypothesis_version: 2,
  current_belief: 'Corrected belief',
  epistemic_state: 'supported',
  confidence: 'high',
  request_trace_id: 'successor-trace',
  previous_hypothesis_id: hypothesisId,
};

const reasoned: HypothesisReasoningResult = {
  generatedAt: '2026-08-08T12:00:00.000Z',
  hypotheses: [{
    constitutionalDomain: 'whatYouSell',
    epistemicState: 'supported',
    currentBelief: 'Corrected belief',
    confidence: 'high',
    representationRisk: 'medium',
    riskReason: 'Material positioning risk',
    verificationNeed: null,
    sourceEvidenceIds: [correctionEvidenceId],
    evidenceCutoffAt: '2026-08-08T12:00:00.000Z',
  }],
};

class Query {
  constructor(private readonly response: { data: unknown; error: unknown }) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  contains() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.response); }
  then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
    return Promise.resolve(this.response).then(resolve);
  }
}

function clientFixture(options: {
  decision?: 'approved' | 'deferred' | 'rejected';
  state?: 'accepted' | 'reasoning_pending' | 'complete';
  replayed?: boolean;
  actionError?: { code: string; message: string };
  successorError?: { code: string; message: string };
  foreignOperation?: boolean;
  missingCorrection?: boolean;
} = {}) {
  const decision = options.decision ?? 'rejected';
  const tableQueues: Record<string, Array<{ data: unknown; error: unknown }>> = {
    hypotheses: [
      { data: prior, error: null },
      { data: successor, error: null },
    ],
    hypothesis_owner_operations: [{
      data: options.foreignOperation ? { ...operation(decision), owner_id: 'foreign-owner' } : operation(decision),
      error: null,
    }],
    evidence: [{
      data: options.missingCorrection ? [] : [
        { id: correctionEvidenceId, source_type: 'manual', raw_statement: 'Correct it', affected_domains: ['whatYouSell'], created_at: '2026-08-08T10:00:00Z' },
        { id: 'domain-evidence', source_type: 'public_website', raw_statement: 'Relevant', affected_domains: ['whatYouSell'], created_at: '2026-08-08T09:00:00Z' },
      ],
      error: null,
    }],
    observations: [{
      data: [{ id: 'observation-1', evidence_id: correctionEvidenceId, interpreted_meaning: 'Owner correction', confidence_in_interpretation: 100, affected_domains: ['whatYouSell'] }],
      error: null,
    }],
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === 'zeya_apply_hypothesis_owner_action') {
      return options.actionError
        ? { data: null, error: options.actionError }
        : { data: [action(decision, options.state ?? (decision === 'rejected' ? 'reasoning_pending' : 'accepted'), options.replayed)], error: null };
    }
    return options.successorError
      ? { data: null, error: options.successorError }
      : { data: [{ operation_id: operationId, successor_hypothesis_id: successor.id }], error: null };
  });
  const from = vi.fn((table: string) => new Query(tableQueues[table].shift() ?? { data: null, error: null }));
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

describe('owner hypothesis decision orchestration', () => {
  it.each(['approved', 'deferred'] as const)('%s creates only the governed verification path', async decision => {
    const fixture = clientFixture({ decision });
    const provider = vi.fn();
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision,
    }, provider);
    expect(result.operationState).toBe('accepted');
    expect(result.successor).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('approve replay returns the same verification without reasoning', async () => {
    const fixture = clientFixture({ decision: 'approved', replayed: true });
    const provider = vi.fn();
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'approved',
    }, provider);
    expect(result.replayed).toBe(true);
    expect(result.verificationId).toBe(verificationId);
    expect(provider).not.toHaveBeenCalled();
  });

  it('reject calls owner action first, reasons one exact domain, and persists through the wrapper', async () => {
    const fixture = clientFixture();
    const provider = vi.fn(async (_request, evidence, observations) => {
      expect(fixture.rpc.mock.calls[0][0]).toBe('zeya_apply_hypothesis_owner_action');
      expect(evidence.map((item: { id: string }) => item.id)).toContain(correctionEvidenceId);
      expect(observations.every((item: { evidenceId: string }) => evidence.some((e: { id: string }) => e.id === item.evidenceId))).toBe(true);
      return reasoned;
    });
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: ' Correct it ',
    }, provider);
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { mode: 'specific_domain', constitutionalDomain: 'whatYouSell' } }),
      expect.any(Array), expect.any(Array),
    );
    expect(fixture.rpc.mock.calls.map(call => call[0])).toEqual([
      'zeya_apply_hypothesis_owner_action',
      'zeya_persist_hypothesis_owner_correction_successor',
    ]);
    expect(result.operationState).toBe('complete');
    expect(result.successor?.hypothesisVersion).toBe(2);
  });

  it('complete replay reads the existing successor without provider or persistence', async () => {
    const fixture = clientFixture({ state: 'complete', replayed: true });
    const provider = vi.fn();
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, provider);
    expect(result.operationState).toBe('complete');
    expect(result.successor?.hypothesisId).toBe(successor.id);
    expect(provider).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('reasoning-pending replay resumes provider and governed persistence', async () => {
    const fixture = clientFixture({ state: 'reasoning_pending', replayed: true });
    const provider = vi.fn().mockResolvedValue(reasoned);
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, provider);
    expect(provider).toHaveBeenCalledOnce();
    expect(result.replayed).toBe(true);
    expect(result.operationState).toBe('complete');
  });

  it.each([
    [{ code: 'PZ409', message: 'operation_conflict' }, 'operation_conflict'],
    [{ code: 'PZ409', message: 'stale_hypothesis' }, 'stale_hypothesis'],
  ] as const)('returns controlled %s before provider invocation', async (actionError, expected) => {
    const fixture = clientFixture({ actionError });
    const provider = vi.fn();
    await expect(applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, provider)).rejects.toMatchObject({ code: expected });
    expect(provider).not.toHaveBeenCalled();
  });

  it('provider failure preserves a resumable durable operation and skips successor persistence', async () => {
    const fixture = clientFixture();
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, vi.fn().mockRejectedValue(new Error('provider failed')));
    expect(result.operationState).toBe('reasoning_pending');
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it('successor persistence failure returns reasoning_pending for retry', async () => {
    const fixture = clientFixture({ successorError: { code: 'XX000', message: 'failed' } });
    const result = await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, vi.fn().mockResolvedValue(reasoned));
    expect(result.operationState).toBe('reasoning_pending');
  });

  it('fails closed when correction Evidence or lineage is outside the governed scope', async () => {
    const missing = clientFixture({ missingCorrection: true });
    await expect(applyOwnerHypothesisDecision(missing.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, vi.fn())).rejects.toBeInstanceOf(OwnerHypothesisDecisionError);

    const foreign = clientFixture({ foreignOperation: true });
    await expect(applyOwnerHypothesisDecision(foreign.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'rejected', correctionText: 'Correct it',
    }, vi.fn())).rejects.toMatchObject({ code: 'invariant_error' });
  });

  it('never mutates governance or canonical tables directly', async () => {
    const fixture = clientFixture({ decision: 'approved' });
    await applyOwnerHypothesisDecision(fixture.client, {
      authenticatedOwnerId: ownerId, hypothesisId, operationId, decision: 'approved',
    }, vi.fn());
    expect(fixture.from.mock.calls.map(call => call[0])).toEqual(['hypotheses', 'hypothesis_owner_operations']);
    expect(fixture.rpc).toHaveBeenCalledWith('zeya_apply_hypothesis_owner_action', expect.any(Object));
  });

  it('derives owner identity in the authenticated route and exposes no correction logging or direct mutations', () => {
    const route = readFileSync('app/api/onboarding/direct-hire/hypotheses/decision/route.ts', 'utf8');
    const service = readFileSync('lib/onboarding/owner-hypothesis-decision.ts', 'utf8');
    expect(route).toContain('authenticatedOwnerId: auth.user.id');
    expect(route).not.toMatch(/body\.owner|body\.ownerId|service_role|SUPABASE_SERVICE_ROLE_KEY/);
    expect(`${route}\n${service}`).not.toMatch(/console\.(log|info|warn|error)/);
    expect(service).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    expect(service).not.toMatch(/representation_(proposals|versions)|approval_decisions|current_version_id/);
  });
});
