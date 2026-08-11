import { describe, expect, it } from 'vitest';
import {
  hasCurrentReasoningSnapshot,
  PREPARATION_DOMAINS,
  type CurrentPreparationHypothesis,
} from '../../lib/onboarding/preparation-intelligence';
import {
  generateReasoningRunFingerprint,
  normalizeEffectivePreparationEvidence,
  toEvidenceInput,
} from '../../lib/onboarding/persist-hypotheses-orchestration';
import type { DatabaseEvidence } from '../../lib/onboarding/persist-hypotheses-types';
import { validateHypothesisReasoningResult } from '../../lib/onboarding/hypothesis-reasoning-validation';

function currentSet(trace: string): CurrentPreparationHypothesis[] {
  return PREPARATION_DOMAINS.map((domain) => ({
    id: `hypothesis-${domain}`,
    constitutionalDomain: domain,
    epistemicState: 'unknown',
    currentBelief: null,
    confidence: 'unknown',
    representationRisk: 'high',
    riskReason: 'Verification required',
    verificationNeed: null,
    sourceEvidenceIds: [],
    hypothesisVersion: 1,
    previousHypothesisId: null,
    ownerDecision: null,
    requestTraceId: trace,
  }));
}

function evidence(overrides: Partial<DatabaseEvidence>): DatabaseEvidence {
  return {
    id: 'evidence-1',
    business_representation_id: 'representation-1',
    direct_hire_onboarding_session_id: 'session-1',
    source_type: 'direct_hire_induction',
    raw_statement: 'Business coaching',
    affected_domains: ['whatYouSell'],
    captured_by_actor: 'owner-1',
    induction_material_type: 'description',
    induction_material_label: 'What the business sells',
    created_at: '2026-08-11T08:00:00.000Z',
    ...overrides,
  };
}

describe('Preparation intelligence snapshot freshness', () => {
  it('accepts seven current hypotheses only when every request trace matches', () => {
    const hypotheses = currentSet('trace-current');
    expect(hasCurrentReasoningSnapshot(hypotheses, 'trace-current')).toBe(true);
    hypotheses[3] = { ...hypotheses[3], requestTraceId: 'trace-stale' };
    expect(hasCurrentReasoningSnapshot(hypotheses, 'trace-current')).toBe(false);
    expect(hasCurrentReasoningSnapshot(hypotheses.slice(0, 6), 'trace-current')).toBe(false);
  });

  it('changes the governed fingerprint when effective induction Evidence changes', () => {
    const websiteTrace = generateReasoningRunFingerprint(
      'session-1',
      'representation-1',
      ['website-evidence'],
      ['website-observation'],
    );
    const inductionTrace = generateReasoningRunFingerprint(
      'session-1',
      'representation-1',
      ['induction-evidence', 'website-evidence'].sort(),
      ['website-observation'],
    );
    expect(inductionTrace).not.toBe(websiteTrace);
  });

  it('selects the latest repeated fixed induction field without mutating history', () => {
    const older = evidence({ id: 'older', raw_statement: 'Business coaching and business architecture' });
    const latest = evidence({
      id: 'latest',
      raw_statement: 'Business coaching and architecture',
      created_at: '2026-08-11T09:00:00.000Z',
    });
    const target = evidence({
      id: 'target',
      induction_material_label: 'Target customer',
      raw_statement: 'Startups in English-speaking developed markets',
      affected_domains: ['whoItIsFor'],
      created_at: '2026-08-11T09:01:00.000Z',
    });
    const immutableHistory = [older, latest, target];
    const effective = normalizeEffectivePreparationEvidence(immutableHistory);
    expect(immutableHistory).toHaveLength(3);
    expect(effective.map(item => item.id)).toEqual(['latest', 'target']);
  });

  it('makes legacy target-customer owner testimony available to whoItIsFor reasoning', () => {
    const target = evidence({
      id: 'target',
      induction_material_label: 'Target customer',
      raw_statement: 'Startups in English-speaking developed markets',
      affected_domains: [],
    });
    const [input] = toEvidenceInput([target]);
    expect(input.sourceType).toBe('direct_hire_induction');
    expect(input.affected_domains).toContain('whoItIsFor');
    expect(input.rawStatement).toBe(target.raw_statement);
  });

  it('keeps owner testimony provisional rather than approved or canonical', () => {
    const target = toEvidenceInput([evidence({
      id: 'target',
      induction_material_label: 'Target customer',
      raw_statement: 'Startups in English-speaking developed markets',
      affected_domains: ['whoItIsFor'],
    })])[0];
    const result = validateHypothesisReasoningResult({
      hypotheses: PREPARATION_DOMAINS.map(domain => domain === 'whoItIsFor'
        ? {
            constitutionalDomain: domain,
            epistemicState: 'partial',
            currentBelief: 'The owner described startups in English-speaking developed markets.',
            confidence: 'medium',
            representationRisk: 'high',
            riskReason: 'If wrong, positioning could target the wrong market.',
            verificationNeed: 'Validate whether this is the complete target profile.',
            sourceEvidenceIds: ['target'],
            evidenceCutoffAt: '2026-08-11T09:00:00.000Z',
          }
        : {
            constitutionalDomain: domain,
            epistemicState: 'unknown',
            currentBelief: null,
            confidence: 'unknown',
            representationRisk: domain === 'authorityBoundaries' ? 'high' : 'low',
            riskReason: domain === 'authorityBoundaries' ? 'Authority remains unverified.' : '',
            verificationNeed: null,
            sourceEvidenceIds: [],
            evidenceCutoffAt: '2026-08-11T09:00:00.000Z',
          }),
      generatedAt: '2026-08-11T09:00:00.000Z',
    }, new Set(['target']), new Map([['target', target]]));
    expect(result.hypotheses.find(item => item.constitutionalDomain === 'whoItIsFor')?.epistemicState)
      .toBe('partial');
  });

  it('excludes historical URL-only rows while preserving substantive notes', () => {
    const link1 = evidence({ id: 'link-1', induction_material_type: 'link', induction_material_label: 'Reference' });
    const link2 = evidence({ id: 'link-2', induction_material_type: 'link', induction_material_label: 'Reference' });
    const note = evidence({ id: 'note', induction_material_type: 'note', induction_material_label: 'Owner notes' });
    expect(normalizeEffectivePreparationEvidence([link1, link2, note]).map(item => item.id)).toEqual(['note']);
  });
});
