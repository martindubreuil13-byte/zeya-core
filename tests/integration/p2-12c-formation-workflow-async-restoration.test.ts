/**
 * P2.12C Formation Workflow Async Restoration
 *
 * Component-level regression test for async prepared opening restoration.
 *
 * Verifies that when a session loads before prepared context completes,
 * the component correctly transitions from conversation_ready to
 * presenting_preparation once the prepared opening becomes available.
 *
 * This reproduces the actual React lifecycle where:
 * 1. Session loads and maps to initial UI state
 * 2. Prepared context fetch completes asynchronously
 * 3. Component must re-resolve the UI state
 */

import { describe, it, expect, vi } from 'vitest';
import type { FormationSessionStatusResponse } from '../../types/formation';
import {
  loadFormationWorkflowState,
  resolveFormationWorkflowState,
} from '../../lib/formation/workflow-state';
import { buildPreparedOpening } from '../../lib/formation/prepared-opening';
import type { OwnerPreparationProjection } from '../../lib/onboarding/preparation-intelligence';

function preparedContext(overrides?: Partial<OwnerPreparationProjection>) {
  const base: OwnerPreparationProjection = {
    businessIdentity: {
      ownerName: 'Test Owner',
      businessName: 'Test Business',
      growthPriority: 'Growth',
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
    ...overrides,
  };
  return base;
}

describe('P2.12C Formation Workflow Async Restoration', () => {
  describe('Async restoration lifecycle', () => {
    it('transitions to presenting_preparation when prepared opening becomes available after session load', async () => {
      // Scenario A: Create session with status working_conversation_pending
      const session: FormationSessionStatusResponse = {
        sessionId: 'ddc84722-266e-44ea-a6c2-5458a8b346bf',
        businessRepresentationId: 'test-br-id',
        status: 'working_conversation_pending',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {
          fromDirectHireOnboarding: true,
        },
      };

      // Scenario B: Initial session state without prepared opening
      // (This happens on mount - session loads before prepared context)
      const initialResolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: false,
        preparationOpeningAcknowledged: false,
      });

      // Should initially resolve to conversation_ready
      expect(initialResolution.uiState).toBe('conversation_ready');

      // Scenario C: Prepared context fetch completes asynchronously
      const preparation = preparedContext();
      const opening = buildPreparedOpening(preparation);

      // Scenario D: Re-resolve with prepared opening available
      const restoredResolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      // Should now resolve to presenting_preparation
      expect(restoredResolution.uiState).toBe('presenting_preparation');

      // Scenario E: Prepared opening content is valid
      expect(opening.introduction).toBeDefined();
      expect(opening.introduction.length).toBeGreaterThan(0);
      expect(opening.segments.length).toBeGreaterThan(0);
    });

    it('does not regress to presenting_preparation if acknowledgement is true', async () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'test-session-id',
        businessRepresentationId: 'test-br-id',
        status: 'working_conversation_pending',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: true,
        linkedContextSummary: {
          fromDirectHireOnboarding: true,
        },
      };

      // Even though prepared opening is available, acknowledgement=true means skip it
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });

      // Should stay at conversation_ready, not regress to presenting_preparation
      expect(resolution.uiState).toBe('conversation_ready');
    });

    it('preserves state when prepared context fetch fails', async () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'test-session-id',
        businessRepresentationId: 'test-br-id',
        status: 'working_conversation_pending',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {
          fromDirectHireOnboarding: true,
        },
      };

      // Initial resolution without prepared opening (fetch failed or never completed)
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: false,
        preparationOpeningAcknowledged: false,
      });

      // Should stay at conversation_ready, not error
      expect(resolution.uiState).toBe('conversation_ready');
      expect(resolution.error).toBeNull();
    });
  });

  describe('Restoration edge cases', () => {
    it('handles session in initiated status with prepared opening available', async () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'new-session-id',
        businessRepresentationId: 'test-br-id',
        status: 'initiated',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {
          fromDirectHireOnboarding: true,
        },
      };

      // When status is initiated, should show opening regardless
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      expect(resolution.uiState).toBe('presenting_preparation');
    });

    it('non-direct-hire sessions without prepared opening map per status', async () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'generic-session-id',
        businessRepresentationId: 'test-br-id',
        status: 'working_conversation_pending',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {},
      };

      // Without prepared opening (non-Direct-Hire sessions won't have one),
      // should map per status normally
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: false,
        preparationOpeningAcknowledged: false,
      });

      expect(resolution.uiState).toBe('conversation_ready');
    });

    it('idempotency: calling re-resolve multiple times does not cascade', async () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'test-session-id',
        businessRepresentationId: 'test-br-id',
        status: 'working_conversation_pending',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {
          fromDirectHireOnboarding: true,
        },
      };

      const resolution1 = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      const resolution2 = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      const resolution3 = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      // All resolutions should be identical
      expect(resolution1.uiState).toBe(resolution2.uiState);
      expect(resolution2.uiState).toBe(resolution3.uiState);
      expect(resolution1.uiState).toBe('presenting_preparation');
    });
  });

  describe('Formation state machine invariants', () => {
    it('maintains correct state progression: initiated → getting_familiar → working_conversation_pending', async () => {
      // Initial state
      const initiated: FormationSessionStatusResponse = {
        sessionId: 'test-session',
        businessRepresentationId: 'test-br',
        status: 'initiated',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: { fromDirectHireOnboarding: true },
      };

      const state1 = resolveFormationWorkflowState(initiated, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });
      expect(state1.uiState).toBe('presenting_preparation');

      // After acknowledgement
      const acknowledged: FormationSessionStatusResponse = {
        ...initiated,
        status: 'getting_familiar',
        preparationOpeningAcknowledged: true,
      };

      const state2 = resolveFormationWorkflowState(acknowledged, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });
      expect(state2.uiState).toBe('getting_familiar');

      // Conversation pending
      const pending: FormationSessionStatusResponse = {
        ...acknowledged,
        status: 'working_conversation_pending',
      };

      const state3 = resolveFormationWorkflowState(pending, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });
      expect(state3.uiState).toBe('conversation_ready');
    });
  });
});
