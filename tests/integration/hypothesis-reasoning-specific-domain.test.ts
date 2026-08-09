import { describe, expect, it } from 'vitest';
import {
  buildHypothesisSchema,
  buildReasoningPrompt,
  scopeReasoningInputs,
} from '../../lib/onboarding/hypothesis-reasoning-service';
import {
  validateHypothesisReasoningInput,
  validateHypothesisReasoningResult,
} from '../../lib/onboarding/hypothesis-reasoning-validation';
import type {
  EvidenceInput,
  HypothesisReasoningRequest,
  ObservationInput,
} from '../../lib/onboarding/hypothesis-reasoning-types';

const generatedAt = '2026-08-08T00:00:00.000Z';
const specificRequest: HypothesisReasoningRequest = {
  scope: { mode: 'specific_domain', constitutionalDomain: 'whatYouSell' },
  onboardingSessionId: 'session-1',
  businessRepresentationId: 'representation-1',
  businessId: 'business-1',
  ownerName: 'Owner',
  businessName: 'Business',
  requestTraceId: 'trace-1',
};

function hypothesis(domain = 'whatYouSell') {
  return {
    constitutionalDomain: domain,
    epistemicState: 'partial',
    currentBelief: 'The owner says the business provides advisory services.',
    confidence: 'medium',
    representationRisk: 'low',
    riskReason: '',
    verificationNeed: null,
    sourceEvidenceIds: ['correction-evidence'],
    evidenceCutoffAt: generatedAt,
  };
}

describe('single-domain hypothesis reasoning contract', () => {
  it('keeps all-domains schema at exactly seven outputs', () => {
    const schema = buildHypothesisSchema({ mode: 'all_domains' });
    expect(schema.properties.hypotheses.minItems).toBe(7);
    expect(schema.properties.hypotheses.maxItems).toBe(7);
    expect(schema.properties.hypotheses.items.properties.constitutionalDomain.enum).toHaveLength(7);
  });

  it('requests exactly one requested-domain output in structured schema', () => {
    const schema = buildHypothesisSchema(specificRequest.scope!);
    expect(schema.properties.hypotheses.minItems).toBe(1);
    expect(schema.properties.hypotheses.maxItems).toBe(1);
    expect(schema.properties.hypotheses.items.properties.constitutionalDomain.enum).toEqual(['whatYouSell']);
  });

  it('accepts exactly one output matching the requested domain', () => {
    const result = validateHypothesisReasoningResult(
      { hypotheses: [hypothesis()], generatedAt },
      new Set(['correction-evidence']),
      undefined,
      specificRequest.scope
    );
    expect(result.hypotheses).toHaveLength(1);
  });

  it('rejects an output for another domain', () => {
    expect(() => validateHypothesisReasoningResult(
      { hypotheses: [hypothesis('whoItIsFor')], generatedAt },
      new Set(['correction-evidence']),
      undefined,
      specificRequest.scope
    )).toThrow(/Expected constitutional domain/);
  });

  it('rejects multiple outputs', () => {
    expect(() => validateHypothesisReasoningResult(
      { hypotheses: [hypothesis(), hypothesis()], generatedAt },
      new Set(['correction-evidence']),
      undefined,
      specificRequest.scope
    )).toThrow(/Expected exactly 1 hypothesis/);
  });

  it('includes affected-domain correction Evidence and excludes unrelated Evidence and Observations', () => {
    const evidence: EvidenceInput[] = [
      { id: 'correction-evidence', sourceType: 'manual', rawStatement: 'We provide advisory services.', affected_domains: ['whatYouSell'] },
      { id: 'unrelated-evidence', sourceType: 'public_website', rawStatement: 'For retailers.', affected_domains: ['whoItIsFor'] },
    ];
    const observations: ObservationInput[] = [
      { id: 'relevant-observation', evidenceId: 'correction-evidence', interpreted_meaning: 'Owner described the offer.', confidence_in_interpretation: 90, affected_domains: ['whatYouSell'] },
      { id: 'unrelated-observation', evidenceId: 'unrelated-evidence', interpreted_meaning: 'Audience statement.', confidence_in_interpretation: 80, affected_domains: ['whoItIsFor'] },
    ];
    const scoped = scopeReasoningInputs(specificRequest.scope!, evidence, observations);
    expect(scoped.evidence.map(item => item.id)).toEqual(['correction-evidence']);
    expect(scoped.observations.map(item => item.id)).toEqual(['relevant-observation']);
  });

  it('retains Observation scope validation before reasoning', () => {
    expect(() => validateHypothesisReasoningInput(specificRequest, [], [{
      id: 'observation-1', evidenceId: 'missing', interpreted_meaning: 'Unsupported',
      confidence_in_interpretation: 50, affected_domains: ['whatYouSell'],
    }])).toThrow(/not in the supplied scope/);
  });

  it('retains the same-page high-confidence independence guard', () => {
    const evidence: EvidenceInput[] = [
      { id: 'e1', sourceType: 'public_website', rawStatement: 'Advisory', affected_domains: ['whatYouSell'], canonical_source_url: 'https://example.com/' },
      { id: 'e2', sourceType: 'public_website', rawStatement: 'Consulting', affected_domains: ['whatYouSell'], canonical_source_url: 'https://example.com/' },
    ];
    expect(() => validateHypothesisReasoningResult({
      hypotheses: [{ ...hypothesis(), confidence: 'high', sourceEvidenceIds: ['e1', 'e2'] }],
      generatedAt,
    }, new Set(['e1', 'e2']), new Map(evidence.map(item => [item.id, item])), specificRequest.scope))
      .toThrow(/distinct URLs|single page/);
  });

  it('retains high-risk governance for authorityBoundaries correction', () => {
    const scope = { mode: 'specific_domain' as const, constitutionalDomain: 'authorityBoundaries' as const };
    expect(() => validateHypothesisReasoningResult({
      hypotheses: [{ ...hypothesis('authorityBoundaries'), representationRisk: 'low' }], generatedAt,
    }, new Set(['correction-evidence']), undefined, scope)).toThrow(/requires high representationRisk/);
  });

  it('states the ONLY-domain and Evidence-constitution prompt contract', () => {
    const prompt = buildReasoningPrompt(specificRequest, [{
      id: 'correction-evidence', sourceType: 'manual', rawStatement: 'Owner correction', affected_domains: ['whatYouSell'],
    }], []);
    expect(prompt).toContain('re-evaluating ONLY whatYouSell');
    expect(prompt).toContain('Do not make or revise conclusions for any other constitutional domain');
    expect(prompt).toContain('not objective truth');
    expect(prompt).toContain('Generate exactly 1 hypothesis for whatYouSell');
  });

  it('contains no persistence operation', () => {
    expect(scopeReasoningInputs.toString()).not.toMatch(/\.from\(|\.rpc\(|insert|update|delete/i);
  });
});
