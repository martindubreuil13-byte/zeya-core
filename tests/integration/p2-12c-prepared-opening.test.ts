/**
 * P2.12C Prepared Opening Tests
 *
 * Verifies that Zeya's Prepared Opening is generated correctly
 * from governed preparation intelligence and maintains epistemic
 * distinctions.
 */

import { describe, it, expect } from 'vitest';
import { buildPreparedOpening } from '../../lib/formation/prepared-opening';
import type { OwnerPreparationProjection } from '../../lib/onboarding/preparation-intelligence';

describe('P2.12C Prepared Opening', () => {
  describe('Opening Generation from Preparation', () => {
    it('generates opening from supported hypotheses', () => {
      const preparation: OwnerPreparationProjection = {
        businessIdentity: {
          ownerName: 'Alice',
          businessName: 'Acme Corp',
          growthPriority: 'Scale',
        },
        domains: {
          whatYouSell: {
            constitutionalDomain: 'whatYouSell',
            provisionalUnderstanding: 'Software solutions',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 3, sourceTypes: ['website'] },
          },
          whoItIsFor: {
            constitutionalDomain: 'whoItIsFor',
            provisionalUnderstanding: 'Mid-market enterprises',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 2, sourceTypes: ['website'] },
          },
          problemOrAspiration: {
            constitutionalDomain: 'problemOrAspiration',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          proposedDescription: {
            constitutionalDomain: 'proposedDescription',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          whyCustomersShouldCare: {
            constitutionalDomain: 'whyCustomersShouldCare',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          authorityBoundaries: {
            constitutionalDomain: 'authorityBoundaries',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          clarificationsNeeded: {
            constitutionalDomain: 'clarificationsNeeded',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
        },
        majorUnknowns: [],
        priorityClarifications: [],
        authorityConstraints: [],
        contradictions: [],
        preparationCompleteness: {
          complete: true,
          domainCount: 7,
          supported: 2,
          partial: 0,
          unknown: 5,
          contradicted: 0,
        },
      };

      const opening = buildPreparedOpening(preparation);

      expect(opening.introduction).toBeDefined();
      expect(opening.segments.length).toBeGreaterThan(0);
      expect(opening.transition).toContain('am I reading');

      // Check that supported segment exists
      const supportedSegment = opening.segments.find(s => s.kind === 'supported');
      expect(supportedSegment).toBeDefined();
    });

    it('includes uncertain segments for unknown domains', () => {
      const preparation: OwnerPreparationProjection = {
        businessIdentity: {
          ownerName: 'Bob',
          businessName: 'Tech Inc',
          growthPriority: 'Profitability',
        },
        domains: {
          whatYouSell: {
            constitutionalDomain: 'whatYouSell',
            provisionalUnderstanding: 'Services',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          whoItIsFor: {
            constitutionalDomain: 'whoItIsFor',
            provisionalUnderstanding: 'Startups',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          problemOrAspiration: {
            constitutionalDomain: 'problemOrAspiration',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          proposedDescription: {
            constitutionalDomain: 'proposedDescription',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          whyCustomersShouldCare: {
            constitutionalDomain: 'whyCustomersShouldCare',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          authorityBoundaries: {
            constitutionalDomain: 'authorityBoundaries',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          clarificationsNeeded: {
            constitutionalDomain: 'clarificationsNeeded',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
        },
        majorUnknowns: [],
        priorityClarifications: [],
        authorityConstraints: [],
        contradictions: [],
        preparationCompleteness: {
          complete: true,
          domainCount: 7,
          supported: 2,
          partial: 0,
          unknown: 5,
          contradicted: 0,
        },
      };

      const opening = buildPreparedOpening(preparation);

      // Should have uncertain segments for unknown domains
      const uncertainSegments = opening.segments.filter(s => s.kind === 'uncertain');
      expect(uncertainSegments.length).toBeGreaterThan(0);
    });
  });

  describe('Opening Content Quality', () => {
    it('opening does not expose governance internals', () => {
      const preparation: OwnerPreparationProjection = {
        businessIdentity: {
          ownerName: 'Owner',
          businessName: 'Business',
          growthPriority: 'Growth',
        },
        domains: {
          whatYouSell: {
            constitutionalDomain: 'whatYouSell',
            provisionalUnderstanding: 'Product',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          whoItIsFor: {
            constitutionalDomain: 'whoItIsFor',
            provisionalUnderstanding: 'Customers',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          problemOrAspiration: {
            constitutionalDomain: 'problemOrAspiration',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          proposedDescription: {
            constitutionalDomain: 'proposedDescription',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          whyCustomersShouldCare: {
            constitutionalDomain: 'whyCustomersShouldCare',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          authorityBoundaries: {
            constitutionalDomain: 'authorityBoundaries',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          clarificationsNeeded: {
            constitutionalDomain: 'clarificationsNeeded',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
        },
        majorUnknowns: [],
        priorityClarifications: [],
        authorityConstraints: [],
        contradictions: [],
        preparationCompleteness: {
          complete: true,
          domainCount: 7,
          supported: 2,
          partial: 0,
          unknown: 5,
          contradicted: 0,
        },
      };

      const opening = buildPreparedOpening(preparation);
      const openingText = JSON.stringify(opening);

      expect(openingText).not.toContain('constitutionalDomain');
      expect(openingText).not.toContain('epistemicState');
      expect(openingText).not.toContain('fingerprint');
      expect(openingText).not.toContain('governance');
    });

    it('opening is conversational not mechanical', () => {
      const preparation: OwnerPreparationProjection = {
        businessIdentity: {
          ownerName: 'Owner',
          businessName: 'Business',
          growthPriority: 'Growth',
        },
        domains: {
          whatYouSell: {
            constitutionalDomain: 'whatYouSell',
            provisionalUnderstanding: 'Software',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          whoItIsFor: {
            constitutionalDomain: 'whoItIsFor',
            provisionalUnderstanding: 'Enterprises',
            epistemicState: 'supported',
            confidence: 'high',
            representationRisk: 'low',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 1, sourceTypes: [] },
          },
          problemOrAspiration: {
            constitutionalDomain: 'problemOrAspiration',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          proposedDescription: {
            constitutionalDomain: 'proposedDescription',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'medium',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          whyCustomersShouldCare: {
            constitutionalDomain: 'whyCustomersShouldCare',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          authorityBoundaries: {
            constitutionalDomain: 'authorityBoundaries',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
          clarificationsNeeded: {
            constitutionalDomain: 'clarificationsNeeded',
            provisionalUnderstanding: null,
            epistemicState: 'unknown',
            confidence: 'unknown',
            representationRisk: 'high',
            riskReason: null,
            verificationNeed: null,
            hypothesisVersion: 1,
            ownerDecision: null,
            evidenceBasis: { citationCount: 0, sourceTypes: [] },
          },
        },
        majorUnknowns: [],
        priorityClarifications: [],
        authorityConstraints: [],
        contradictions: [],
        preparationCompleteness: {
          complete: true,
          domainCount: 7,
          supported: 2,
          partial: 0,
          unknown: 5,
          contradicted: 0,
        },
      };

      const opening = buildPreparedOpening(preparation);

      expect(opening.introduction).toContain('understood');
      expect(opening.transition).toContain('reading');
    });
  });
});
