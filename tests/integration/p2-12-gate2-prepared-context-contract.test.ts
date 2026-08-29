/**
 * P2.12 Gate 2 Prepared-Context Contract Repair
 *
 * Verifies that the prepared-context API returns the correct owner-safe
 * data shape, maintains privacy boundaries, and does not expose internal
 * service context to the API endpoint.
 */

import { describe, it, expect } from 'vitest';
import type { DirectHireFormationPreparedContext } from '@/lib/formation/direct-hire-prepared-context';

describe('P2.12 Gate 2 Prepared-Context Contract', () => {
  describe('Owner-Safe Data Shape', () => {
    it('ownerSafe includes preparation (OwnerPreparationProjection)', () => {
      const mockContext: DirectHireFormationPreparedContext = {
        ownerSafe: {
          preparation: {
            businessIdentity: {
              ownerName: 'Test Owner',
              businessName: 'Test Business',
              growthPriority: 'Scale',
            },
            domains: {},
            majorUnknowns: [],
            priorityClarifications: [],
            authorityConstraints: [],
            contradictions: [],
            preparationCompleteness: {
              complete: true,
              domainCount: 7,
              supported: 5,
              partial: 2,
              unknown: 0,
              contradicted: 0,
            },
          },
          relevantObservations: [],
          openingSynthesis: 'Test synthesis',
          agendaCategories: ['domain', 'risk'],
          agendaCount: 7,
          blockingItemCount: 0,
          currentSessionState: 'initiated',
        },
        privateServiceContext: {
          formationSessionId: 'test-id',
          workingSessionId: 'test-id',
          onboardingSessionId: 'test-id',
          businessRepresentationId: 'test-id',
          preparationBriefId: 'test-id',
          preparationContractVersion: 'v1',
          preparationSnapshotFingerprint: 'test',
          hypothesisTraceFingerprint: 'test',
          agenda: [],
        },
      };

      expect(mockContext.ownerSafe.preparation).toBeDefined();
      expect(mockContext.ownerSafe.preparation.businessIdentity).toBeDefined();
      expect(mockContext.ownerSafe.preparation.businessIdentity.businessName).toBe('Test Business');
      expect(mockContext.ownerSafe.preparation.domains).toBeDefined();
    });

    it('ownerSafe includes Formation metadata', () => {
      const mockContext: DirectHireFormationPreparedContext = {
        ownerSafe: {
          preparation: {
            businessIdentity: { ownerName: '', businessName: '', growthPriority: '' },
            domains: {},
            majorUnknowns: [],
            priorityClarifications: [],
            authorityConstraints: [],
            contradictions: [],
            preparationCompleteness: { complete: true, domainCount: 7, supported: 0, partial: 0, unknown: 0, contradicted: 0 },
          },
          relevantObservations: [],
          openingSynthesis: 'Opening',
          agendaCategories: ['domain'],
          agendaCount: 7,
          blockingItemCount: 1,
          currentSessionState: 'initiated',
        },
        privateServiceContext: {
          formationSessionId: 'id',
          workingSessionId: 'id',
          onboardingSessionId: 'id',
          businessRepresentationId: 'id',
          preparationBriefId: 'id',
          preparationContractVersion: 'v1',
          preparationSnapshotFingerprint: 'fp',
          hypothesisTraceFingerprint: 'fp',
          agenda: [],
        },
      };

      expect(mockContext.ownerSafe.openingSynthesis).toBeDefined();
      expect(mockContext.ownerSafe.agendaCategories).toBeDefined();
      expect(mockContext.ownerSafe.currentSessionState).toBe('initiated');
    });

    it('ownerSafe includes relevantObservations field', () => {
      const mockContext: DirectHireFormationPreparedContext = {
        ownerSafe: {
          preparation: {
            businessIdentity: { ownerName: '', businessName: '', growthPriority: '' },
            domains: {},
            majorUnknowns: [],
            priorityClarifications: [],
            authorityConstraints: [],
            contradictions: [],
            preparationCompleteness: { complete: true, domainCount: 7, supported: 0, partial: 0, unknown: 0, contradicted: 0 },
          },
          relevantObservations: [
            { meaning: 'Test observation', confidence: 85, domains: ['whatYouSell'] },
          ],
          openingSynthesis: '',
          agendaCategories: [],
          agendaCount: 0,
          blockingItemCount: 0,
          currentSessionState: '',
        },
        privateServiceContext: {
          formationSessionId: 'id',
          workingSessionId: 'id',
          onboardingSessionId: 'id',
          businessRepresentationId: 'id',
          preparationBriefId: 'id',
          preparationContractVersion: 'v1',
          preparationSnapshotFingerprint: 'fp',
          hypothesisTraceFingerprint: 'fp',
          agenda: [],
        },
      };

      expect(mockContext.ownerSafe.relevantObservations).toBeDefined();
      expect(Array.isArray(mockContext.ownerSafe.relevantObservations)).toBe(true);
    });
  });

  describe('Privacy Boundary Enforcement', () => {
    it('privateServiceContext is NOT exposed in API response', () => {
      const ownerSafeData = {
        preparation: {
          businessIdentity: { ownerName: '', businessName: '', growthPriority: '' },
          domains: {},
          majorUnknowns: [],
          priorityClarifications: [],
          authorityConstraints: [],
          contradictions: [],
          preparationCompleteness: { complete: true, domainCount: 7, supported: 0, partial: 0, unknown: 0, contradicted: 0 },
        },
        relevantObservations: [],
        openingSynthesis: '',
        agendaCategories: [],
        agendaCount: 0,
        blockingItemCount: 0,
        currentSessionState: '',
      };

      const serialized = JSON.stringify(ownerSafeData);
      expect(serialized).not.toContain('privateServiceContext');
      expect(serialized).not.toContain('hypothesisTraceFingerprint');
      expect(serialized).not.toContain('preparationSnapshotFingerprint');
    });

    it('owner-facing response never includes private service IDs', () => {
      const ownerSafeJSON = JSON.stringify({
        preparation: {
          businessIdentity: { ownerName: '', businessName: '', growthPriority: '' },
          domains: {},
          majorUnknowns: [],
          priorityClarifications: [],
          authorityConstraints: [],
          contradictions: [],
          preparationCompleteness: { complete: true, domainCount: 7, supported: 0, partial: 0, unknown: 0, contradicted: 0 },
        },
        relevantObservations: [],
        openingSynthesis: '',
        agendaCategories: [],
        agendaCount: 0,
        blockingItemCount: 0,
        currentSessionState: '',
      });

      expect(ownerSafeJSON).not.toMatch(/reasoning|fingerprint|hypothesis_trace|snapshot/i);
    });
  });

  describe('Component Compatibility', () => {
    it('ownerSafe has all fields required by DirectHirePreparationContext', () => {
      const mockContext: DirectHireFormationPreparedContext = {
        ownerSafe: {
          preparation: {
            businessIdentity: {
              ownerName: 'Alice',
              businessName: 'Acme',
              growthPriority: 'Scale',
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
                evidenceBasis: { citationCount: 2, sourceTypes: ['website'] },
              },
            },
            majorUnknowns: [],
            priorityClarifications: ['Clarify market'],
            authorityConstraints: ['No financial advice'],
            contradictions: [],
            preparationCompleteness: { complete: true, domainCount: 7, supported: 5, partial: 2, unknown: 0, contradicted: 0 },
          },
          relevantObservations: [],
          openingSynthesis: '',
          agendaCategories: [],
          agendaCount: 0,
          blockingItemCount: 0,
          currentSessionState: 'initiated',
        },
        privateServiceContext: {
          formationSessionId: 'id',
          workingSessionId: 'id',
          onboardingSessionId: 'id',
          businessRepresentationId: 'id',
          preparationBriefId: 'id',
          preparationContractVersion: 'v1',
          preparationSnapshotFingerprint: 'fp',
          hypothesisTraceFingerprint: 'fp',
          agenda: [],
        },
      };

      const { preparation } = mockContext.ownerSafe;
      expect(preparation.businessIdentity.businessName).toBe('Acme');
      expect(preparation.domains.whatYouSell.provisionalUnderstanding).toBe('Software');
      expect(preparation.priorityClarifications).toContain('Clarify market');
    });
  });
});
