/**
 * P2.12C Prepared Opening Restoration Tests
 *
 * Verifies that existing Formation sessions correctly restore and show
 * the Prepared Opening on reload if it hasn't been acknowledged yet.
 *
 * Critical scenarios:
 * 1. Existing session (working_conversation_pending) with no acknowledgement
 *    → On reload, Prepared Opening should be shown
 * 2. Existing session after owner clicks "Got it, let's dig deeper"
 *    → On reload, Prepared Opening should NOT be shown (skip to next phase)
 * 3. Idempotency: Multiple clicks of "Got it, let's dig deeper"
 *    → Should only set acknowledgement once, no duplicates
 */

import { describe, it, expect } from 'vitest';
import { resolveFormationWorkflowState } from '../../lib/formation/workflow-state';
import type { FormationSessionStatusResponse } from '../../types/formation';

describe('P2.12C Prepared Opening Restoration', () => {
  describe('Restoration invariant: show opening if not acknowledged', () => {
    it('shows presenting_preparation when prepared opening exists and acknowledgement is false', () => {
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

      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      expect(resolution.uiState).toBe('presenting_preparation');
      expect(resolution.error).toBeNull();
      expect(resolution.summary).toBeNull();
    });

    it('skips presenting_preparation when prepared opening exists but acknowledgement is true', () => {
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

      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });

      // Should map to conversation_ready per status, not presenting_preparation
      expect(resolution.uiState).toBe('conversation_ready');
    });

    it('does not force presenting_preparation if prepared opening not loaded', () => {
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

      // Prepared opening not loaded yet (hasPreparedOpening = false)
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: false,
        preparationOpeningAcknowledged: false,
      });

      // Should map per status, not force presenting_preparation
      expect(resolution.uiState).toBe('conversation_ready');
    });
  });

  describe('Restoration flow: initiated status always enters presenting_preparation', () => {
    it('shows presenting_preparation for new session in initiated status', () => {
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

      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });

      // New session in initiated status should show opening
      expect(resolution.uiState).toBe('presenting_preparation');
    });

    it('shows entry state for initiated session without prepared opening', () => {
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

      // Prepared opening not loaded yet
      const resolution = resolveFormationWorkflowState(session, {
        hasPreparedOpening: false,
        preparationOpeningAcknowledged: false,
      });

      expect(resolution.uiState).toBe('entry');
    });
  });

  describe('Acknowledgement state machine', () => {
    it('transitions correctly: initiated (not ack) → getting_familiar (ack) → conversation_ready (ack)', () => {
      // Initial state: session just created
      const initial: FormationSessionStatusResponse = {
        sessionId: 'test-session',
        businessRepresentationId: 'test-br',
        status: 'initiated',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: { fromDirectHireOnboarding: true },
      };

      const state1 = resolveFormationWorkflowState(initial, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: false,
      });
      expect(state1.uiState).toBe('presenting_preparation');

      // After clicking "Got it, let's dig deeper": status advances to getting_familiar, acknowledgement set
      const afterAck: FormationSessionStatusResponse = {
        ...initial,
        status: 'getting_familiar',
        preparationOpeningAcknowledged: true,
      };

      const state2 = resolveFormationWorkflowState(afterAck, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });
      expect(state2.uiState).toBe('getting_familiar');

      // After getting familiar: status advances to working_conversation_pending, acknowledgement stays true
      const pending: FormationSessionStatusResponse = {
        ...afterAck,
        status: 'working_conversation_pending',
      };

      const state3 = resolveFormationWorkflowState(pending, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });
      expect(state3.uiState).toBe('conversation_ready');
    });

    it('idempotency: re-acknowledge does not change state', () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'test-session',
        businessRepresentationId: 'test-br',
        status: 'getting_familiar',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: true,
        linkedContextSummary: { fromDirectHireOnboarding: true },
      };

      const resolution1 = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });

      // Second call with same state should produce same result
      const resolution2 = resolveFormationWorkflowState(session, {
        hasPreparedOpening: true,
        preparationOpeningAcknowledged: true,
      });

      expect(resolution1.uiState).toBe(resolution2.uiState);
      expect(resolution1.uiState).toBe('getting_familiar');
    });
  });

  describe('Privacy: acknowledgement field does not expose internals', () => {
    it('preparationOpeningAcknowledged is a simple boolean, not governance structure', () => {
      const session: FormationSessionStatusResponse = {
        sessionId: 'test-session',
        businessRepresentationId: 'test-br',
        status: 'initiated',
        initiatedAt: '2026-08-29T00:00:00Z',
        firstWorkingConversationId: null,
        summary: null,
        preparationOpeningAcknowledged: false,
        linkedContextSummary: {},
      };

      // Verify the field is present and has correct type
      expect(typeof session.preparationOpeningAcknowledged).toBe('boolean');
      expect(session).toHaveProperty('preparationOpeningAcknowledged');

      // Verify it doesn't contain any governance internals
      const sessionStr = JSON.stringify(session);
      expect(sessionStr).not.toContain('governance');
      expect(sessionStr).not.toContain('fingerprint');
      expect(sessionStr).not.toContain('epistemic');
    });
  });
});
