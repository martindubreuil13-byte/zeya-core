import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FormationSessionStatusResponse, FormationSummary } from '../../types/formation';
import {
  FormationSessionLoadError,
  loadFormationWorkflowState,
  resolveFormationAuthGate,
} from '../../lib/formation/workflow-state';

const summary: FormationSummary = {
  proposalId: 'proposal-fixture',
  formationSessionId: 'formation-fixture',
  sourceFingerprint: 'fingerprint-fixture',
  generatorVersion: 'formation-summary-v1',
  isCurrent: true,
  createdAt: '2026-08-05T00:00:00.000Z',
  correctionState: 'none',
  sections: [{ title: 'Understanding', content: 'Fixture summary.' }],
};

function linkedSession(
  persistedSummary: FormationSummary | null,
): FormationSessionStatusResponse {
  return {
    sessionId: 'formation-fixture',
    businessRepresentationId: 'representation-fixture',
    status: 'working_conversation_linked',
    initiatedAt: '2026-08-05T00:00:00.000Z',
    firstWorkingConversationId: 'output-fixture',
    summary: persistedSummary,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Formation workflow loading resolution', () => {
  it('resolves linked Formation without a summary to durable summary_pending', async () => {
    const result = await loadFormationWorkflowState(async () =>
      response({ success: true, data: linkedSession(null) }),
    );

    expect(result.uiState).toBe('summary_pending');
    expect(result.summary).toBeNull();
    expect(result.error).toBeNull();
  });

  it('resolves a persisted summary to summary_review', async () => {
    const result = await loadFormationWorkflowState(async () =>
      response({ success: true, data: linkedSession(summary) }),
    );

    expect(result.uiState).toBe('summary_review');
    expect(result.summary).toEqual(summary);
  });

  it('turns session fetch failure into a visible load error', async () => {
    await expect(loadFormationWorkflowState(async () =>
      response({ success: false, error: 'Formation session not found' }, 404),
    )).rejects.toEqual(expect.objectContaining({
      message: 'Formation session not found',
      status: 404,
    }));
  });

  it('turns the combined session-summary lookup failure into a visible error', async () => {
    await expect(loadFormationWorkflowState(async () =>
      response({ success: false, error: 'Failed to retrieve formation review' }, 500),
    )).rejects.toBeInstanceOf(FormationSessionLoadError);
  });

  it('never treats completed unauthenticated resolution as loading', () => {
    expect(resolveFormationAuthGate(false, false)).toBe('unauthenticated');
    expect(resolveFormationAuthGate(false, true)).toBe('ready');
    expect(resolveFormationAuthGate(true, false)).toBe('loading');
  });

  it('renders truthful pending copy without approval, correction, or fake progress controls', () => {
    const source = readFileSync('components/formation/FormationWorkflow.tsx', 'utf8');
    const start = source.indexOf("{uiState === 'summary_pending'");
    const end = source.indexOf("{uiState === 'processing'", start);
    const pendingPanel = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pendingPanel).toContain('Preparing your Representation');
    expect(pendingPanel).toContain('nothing needs your approval');
    expect(pendingPanel).toContain('Refreshing or signing in again');
    expect(pendingPanel).not.toMatch(/approveSummary|submitCorrection|setTimeout|setInterval/);
  });

  it('preserves the exact Formation route across sign-out and sign-in', () => {
    const workflow = readFileSync('components/formation/FormationWorkflow.tsx', 'utf8');
    const login = readFileSync('app/login/page.tsx', 'utf8');

    expect(workflow).toContain('/login?next=');
    expect(login).toContain("new URLSearchParams(window.location.search).get('next')");
    expect(login).toContain('router.replace(safeInternalPath(requestedPath))');
  });
});
