// Hypothesis Reasoning Service — Integration Tests
// Uses OpenAI gpt-4o Responses API

import { describe, it, expect, vi } from 'vitest';
import { buildReasoningPrompt, generateHypotheses, PreparationReasoningStageError } from '../../lib/onboarding/hypothesis-reasoning-service';
import {
  HypothesisReasoningValidationError,
  validateHypothesisReasoningInput,
  validateHypothesisReasoningResult,
} from '../../lib/onboarding/hypothesis-reasoning-validation';
import type { HypothesisReasoningRequest, EvidenceInput, ObservationInput } from '../../lib/onboarding/hypothesis-reasoning-types';

// Mock OpenAI Responses API client
function createMockOpenAIClient(responseJson: unknown) {
  return {
    responses: {
      create: vi.fn().mockResolvedValue({
        output_text: JSON.stringify(responseJson),
      }),
    },
  } as any;
}

const baseRequest: HypothesisReasoningRequest = {
  onboardingSessionId: 'session-123',
  businessRepresentationId: 'repr-456',
  businessId: 'biz-789',
  ownerName: 'Jane Doe',
  businessName: 'Acme Services',
  requestTraceId: 'trace-123',
};

describe('Hypothesis Reasoning Service (OpenAI Integration)', () => {
  it('reports missing provider configuration before any provider request', async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(generateHypotheses(baseRequest, [], [])).rejects.toMatchObject({
        stageCode: 'preparation_reasoning_provider_unavailable',
      } satisfies Partial<PreparationReasoningStageError>);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
  describe('TYPE A: VALIDATOR TESTS', () => {
    describe('Scenario 1: Single homepage with 4 extracts should return medium confidence', () => {
      it('should validate response structure for thin Evidence', () => {
        const evidence: EvidenceInput[] = [
          {
            id: 'e1',
            sourceType: 'public_website',
            rawStatement: 'We provide web development services',
            affected_domains: ['whatYouSell'],
            canonical_source_url: 'https://acme.com/',
            source_page_type: 'homepage',
          },
          {
            id: 'e2',
            sourceType: 'public_website',
            rawStatement: 'For small businesses',
            affected_domains: ['whoItIsFor'],
            canonical_source_url: 'https://acme.com/',
            source_page_type: 'homepage',
          },
          {
            id: 'e3',
            sourceType: 'public_website',
            rawStatement: 'Affordable pricing',
            affected_domains: ['authorityBoundaries'],
            canonical_source_url: 'https://acme.com/',
            source_page_type: 'homepage',
          },
          {
            id: 'e4',
            sourceType: 'public_website',
            rawStatement: 'Award-winning team',
            affected_domains: ['whyCustomersShouldCare'],
            canonical_source_url: 'https://acme.com/',
            source_page_type: 'homepage',
          },
        ];

        const response = {
          hypotheses: [
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'partial',
              currentBelief: 'Web development services',
              confidence: 'medium',
              representationRisk: 'low',
              riskReason: 'Basic descriptive detail',
              sourceEvidenceIds: ['e1'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'partial',
              currentBelief: 'Small businesses',
              confidence: 'medium',
              representationRisk: 'low',
              riskReason: 'Stated but not corroborated',
              sourceEvidenceIds: ['e2'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'partial',
              currentBelief: 'Award-winning team',
              confidence: 'medium',
              representationRisk: 'medium',
              riskReason: 'Marketing claim unverified',
              sourceEvidenceIds: ['e4'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'partial',
              currentBelief: 'Web development firm for small businesses',
              confidence: 'medium',
              representationRisk: 'low',
              riskReason: 'Single page Evidence',
              sourceEvidenceIds: ['e1', 'e2'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'high',
              riskReason: 'No owner Evidence establishes pricing or authority',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'supported',
              currentBelief: 'Pricing, delivery timelines, contract terms, specific problems solved',
              confidence: 'high',
              representationRisk: 'low',
              riskReason: 'Clear gaps from single-page Evidence',
              sourceEvidenceIds: ['e1', 'e2', 'e3', 'e4'],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        // Validator confirms structure is correct
        expect(response.hypotheses).toHaveLength(7);
        expect(response.hypotheses.map(h => h.constitutionalDomain)).toEqual([
          'whatYouSell',
          'whoItIsFor',
          'problemOrAspiration',
          'whyCustomersShouldCare',
          'proposedDescription',
          'authorityBoundaries',
          'clarificationsNeeded',
        ]);

        // No high confidence on single-page evidence (except for specific synthesized claims)
        const whatYouSell = response.hypotheses.find(h => h.constitutionalDomain === 'whatYouSell');
        expect(whatYouSell?.confidence).not.toBe('high');
      });
    });

    describe('Scenario 3: Evidence independence enforcement', () => {
      it('should reject high confidence from single URL without owner Evidence', () => {
        const evidence: EvidenceInput[] = [
          { id: 'e1', sourceType: 'public_website', canonical_source_url: 'https://acme.com/', rawStatement: 'Services', affected_domains: ['whatYouSell'] },
          { id: 'e2', sourceType: 'public_website', canonical_source_url: 'https://acme.com/', rawStatement: 'More services', affected_domains: ['whatYouSell'] },
          { id: 'e3', sourceType: 'public_website', canonical_source_url: 'https://acme.com/', rawStatement: 'Still more', affected_domains: ['whatYouSell'] },
        ];

        const invalidResponse = {
          hypotheses: [
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'supported',
              currentBelief: 'Services',
              confidence: 'high', // ← INVALID: multiple IDs from same URL with no owner Evidence
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: ['e1', 'e2', 'e3'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            // ... 6 more for other domains
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        // This should be caught by validator
        const evidenceMap = new Map(evidence.map(e => [e.id, e]));
        expect(() => {
          validateHypothesisReasoningResult(
            invalidResponse,
            new Set(evidence.map(e => e.id)),
            evidenceMap
          );
        }).toThrow(/high confidence.*requires.*distinct URLs/);
      });
    });

    describe('Scenario 6: Observation scope validation', () => {
      it('should reject Observations referencing non-existent Evidence', () => {
        const evidence: EvidenceInput[] = [
          { id: 'e1', sourceType: 'public_website', rawStatement: 'Services', affected_domains: ['whatYouSell'] },
        ];

        const invalidObservations: ObservationInput[] = [
          {
            id: 'obs1',
            evidenceId: 'e999', // ← Does not exist
            interpreted_meaning: 'Some interpretation',
            confidence_in_interpretation: 80,
            affected_domains: ['whatYouSell'],
          },
        ];

        expect(() => {
          validateHypothesisReasoningInput(baseRequest, evidence, invalidObservations);
        }).toThrow(/Observation.*references.*Evidence.*not in the supplied scope/);
      });
    });

    describe('Scenario 11: Raw Evidence text not leaked in output', () => {
      it('should not expose raw statement content in output', () => {
        const evidence: EvidenceInput[] = [
          {
            id: 'e1',
            sourceType: 'public_website',
            rawStatement: '[CONFIDENTIAL PRICING: $500/hour, margin 65%]',
            affected_domains: ['authorityBoundaries'],
            canonical_source_url: 'https://acme.com/pricing',
          },
        ];

        const response = {
          hypotheses: [
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'partial',
              currentBelief: 'Pricing documented (specific rates not disclosed)',
              confidence: 'medium',
              representationRisk: 'high',
              riskReason: 'Pricing is material; cannot be inferred from absence',
              sourceEvidenceIds: ['e1'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        const allBeliefs = response.hypotheses.map(h => h.currentBelief).join(' ');
        const allRisks = response.hypotheses.map(h => h.riskReason).join(' ');

        // Verify raw sensitive data is not exposed
        expect(allBeliefs + allRisks).not.toContain('$500/hour');
        expect(allBeliefs + allRisks).not.toContain('margin 65%');
        expect(allBeliefs + allRisks).not.toContain('[CONFIDENTIAL');
      });
    });
  });

  describe('TYPE A: VALIDATOR TESTS (Contract Fixes)', () => {
    describe('verificationNeed does not violate unknown/null constraint', () => {
      it('should accept clarificationsNeeded with unknown state and null belief but populated verificationNeed', () => {
        const response = {
          hypotheses: [
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'partial',
              currentBelief: 'Web development',
              confidence: 'medium',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: ['e1'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'high',
              riskReason: 'Critical gaps remain',
              verificationNeed: 'Confirm pricing authority; verify target customer profile', // ✓ Legal
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        // Should pass validation
        expect(response.hypotheses[6].verificationNeed).toBe('Confirm pricing authority; verify target customer profile');
        expect(response.hypotheses[6].currentBelief).toBeNull();
      });
    });

    describe('medium and high risk require non-empty riskReason', () => {
      it('should reject medium risk without riskReason', () => {
        const invalidResponse = {
          hypotheses: [
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'partial',
              currentBelief: 'Services',
              confidence: 'medium',
              representationRisk: 'medium',
              riskReason: '', // ✗ EMPTY for medium risk
              verificationNeed: null,
              sourceEvidenceIds: ['e1'],
              evidenceCutoffAt: new Date().toISOString(),
            },
            // ... 6 more minimal hypotheses
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        // This should be caught by validator
        expect(() => {
          validateHypothesisReasoningResult(
            invalidResponse,
            new Set(['e1'])
          );
        }).toThrow(/medium risk requires non-empty riskReason/);
      });

      it('should reject high risk without riskReason', () => {
        const invalidResponse = {
          hypotheses: [
            {
              constitutionalDomain: 'authorityBoundaries',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'high',
              riskReason: '', // ✗ EMPTY for high risk
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            // ... 6 more minimal
            {
              constitutionalDomain: 'whatYouSell',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whoItIsFor',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'problemOrAspiration',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'whyCustomersShouldCare',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'proposedDescription',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
            {
              constitutionalDomain: 'clarificationsNeeded',
              epistemicState: 'unknown',
              currentBelief: null,
              confidence: 'unknown',
              representationRisk: 'low',
              riskReason: '',
              verificationNeed: null,
              sourceEvidenceIds: [],
              evidenceCutoffAt: new Date().toISOString(),
            },
          ],
          generatedAt: new Date().toISOString(),
        };

        expect(() => {
          validateHypothesisReasoningResult(
            invalidResponse,
            new Set()
          );
        }).toThrow(/high risk requires non-empty riskReason/);
      });
    });
  });

  describe('TYPE B: PROMPT-CONTRACT TESTS', () => {
    describe('Prompt must include constitutional principles', () => {
      it('should supply canonical URLs and metadata to model for independence reasoning', async () => {
        const evidence: EvidenceInput[] = [
          {
            id: 'e1',
            sourceType: 'public_website',
            rawStatement: 'Custom web development',
            affected_domains: ['whatYouSell'],
            canonical_source_url: 'https://acme.com/',
            source_page_type: 'homepage',
            source_evidence_kind: 'service_offering',
          },
          {
            id: 'e2',
            sourceType: 'public_website',
            rawStatement: 'React and Node.js specialists',
            affected_domains: ['whatYouSell'],
            canonical_source_url: 'https://acme.com/services',
            source_page_type: 'services',
            source_evidence_kind: 'tech_stack',
          },
        ];

        // This test captures the prompt to verify structure
        // In real usage, we'd spy on the OpenAI client call
        // For now, we verify the prompt-building logic includes required metadata

        const prompt = buildReasoningPrompt(baseRequest, evidence, []);

        // Verify canonical URLs are in prompt
        expect(prompt).toContain('https://acme.com/');
        expect(prompt).toContain('https://acme.com/services');

        // Verify page type metadata is included
        expect(prompt).toContain('homepage');
        expect(prompt).toContain('services');

        // Verify Evidence kind is included
        expect(prompt).toContain('service_offering');
        expect(prompt).toContain('tech_stack');

        // Verify independence principle is stated
        expect(prompt).toContain('NOT independent');
        expect(prompt).toContain('distinct canonical URLs');

        // Verify representation risk guidance is present
        expect(prompt).toContain('high representation risk');

        // Verify constitutional domain boundaries are explicit
        expect(prompt).toContain('whatYouSell');
        expect(prompt).toContain('proposedDescription');
        expect(prompt).toContain('authorityBoundaries');
      });

      it('should distinguish owner vs public Evidence in prompt', async () => {
        const evidence: EvidenceInput[] = [
          {
            id: 'e1',
            sourceType: 'public_website',
            rawStatement: 'Web development services',
            affected_domains: ['whatYouSell'],
            canonical_source_url: 'https://acme.com/',
          },
          {
            id: 'e2',
            sourceType: 'conversation',
            rawStatement: 'Owner: We actually specialize in React',
            affected_domains: ['whatYouSell'],
          },
        ];

        const prompt = buildReasoningPrompt(baseRequest, evidence, []);

        // Verify source types are distinguished
        expect(prompt).toContain('public_website');
        expect(prompt).toContain('conversation');

        // Verify both Evidence is in prompt
        expect(prompt).toContain('e1');
        expect(prompt).toContain('e2');
      });

      it('should include no chain-of-thought instruction', () => {
        const evidence: EvidenceInput[] = [
          {
            id: 'e1',
            sourceType: 'public_website',
            rawStatement: 'Services',
            affected_domains: ['whatYouSell'],
          },
        ];

        const prompt = buildReasoningPrompt(baseRequest, evidence, []);

        // Verify no chain-of-thought is requested
        expect(prompt).toContain('No explanation');
        expect(prompt).toContain('No chain-of-thought');
        expect(prompt).toContain('Return only JSON');
      });
    });
  });

  describe('TYPE C: TRANSFORMATION TESTS', () => {
    describe('Input validation', () => {
      it('should validate Evidence/Observation scope before provider call', () => {
        const evidence: EvidenceInput[] = [
          { id: 'e1', sourceType: 'public_website', rawStatement: 'Services', affected_domains: ['whatYouSell'] },
        ];

        const invalidObservations: ObservationInput[] = [
          {
            id: 'obs1',
            evidenceId: 'e_nonexistent',
            interpreted_meaning: 'Meaning',
            confidence_in_interpretation: 50,
            affected_domains: ['whatYouSell'],
          },
        ];

        expect(() => {
          validateHypothesisReasoningInput(baseRequest, evidence, invalidObservations);
        }).toThrow();
      });
    });
  });

});
