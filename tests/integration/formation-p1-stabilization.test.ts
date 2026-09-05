import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  computeFormationSummaryFingerprint,
  projectFormationSummary,
} from '../../lib/formation/summary-contract';

const read = (path: string) => readFile(path, 'utf8');

describe('Formation P1 stabilization', () => {
  it('reserves linked state for the governed linkage endpoint', async () => {
    const [advance, workflow, migration] = await Promise.all([
      read('app/api/formation/sessions/[sessionId]/advance/route.ts'),
      read('components/formation/FormationWorkflow.tsx'),
      read('supabase/migrations/20260806000000_formation_p1_stabilization.sql'),
    ]);
    expect(advance).toContain('working_conversation_pending: []');
    expect(advance).toContain('p_business_representation_id');
    expect(advance).toContain('p_transition_details');
    expect(workflow).not.toContain("onClick={() => advanceState('working_conversation_linked')}");
    expect(migration).toContain("output.tenant_user_id = v_session.owner_id");
    expect(migration).toContain("output.business_representation_id = v_session.business_representation_id");
    expect(migration).toContain("output.transcript_status = 'finalized'");
    expect(migration).toContain("v_session.first_working_conversation_id = p_conversation_id");
  });

  it('replaces the linkage RPC transactionally when its OUT row type changes', async () => {
    const migration = await read(
      'supabase/migrations/20260806000000_formation_p1_stabilization.sql',
    );
    const revoke = migration.indexOf(
      'REVOKE ALL ON FUNCTION public.zeya_link_formation_conversation',
    );
    const drop = migration.indexOf(
      'DROP FUNCTION IF EXISTS public.zeya_link_formation_conversation',
    );
    const create = migration.indexOf(
      'CREATE FUNCTION public.zeya_link_formation_conversation',
    );
    expect(revoke).toBeGreaterThan(migration.indexOf('BEGIN;'));
    expect(drop).toBeGreaterThan(revoke);
    expect(create).toBeGreaterThan(drop);
    expect(create).toBeLessThan(migration.lastIndexOf('COMMIT;'));
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.zeya_link_formation_conversation',
    );
    expect(migration).toContain(
      ') FROM PUBLIC, anon, authenticated, service_role;',
    );
  });

  it('restores only a durable persisted summary projection', async () => {
    const [sessionRoute, summaryRoute, workflow, workflowState] = await Promise.all([
      read('app/api/formation/sessions/[sessionId]/route.ts'),
      read('app/api/formation/sessions/[sessionId]/summary/route.ts'),
      read('components/formation/FormationWorkflow.tsx'),
      read('lib/formation/workflow-state.ts'),
    ]);
    expect(sessionRoute).toContain('projectFormationSummary');
    expect(sessionRoute).toContain('summary,');
    expect(summaryRoute).toContain(".eq('formation_session_id', sessionId)");
    expect(summaryRoute).toContain(".eq('status', 'draft')");
    expect(summaryRoute).toContain("if (existing?.isCurrent)");
    expect(summaryRoute).toContain("status: 'superseded'");
    expect(workflow).toContain('resolveFormationWorkflowState(sess, {');
    expect(workflow).toContain('preparationOpeningAcknowledged: sess.preparationOpeningAcknowledged');
    expect(workflowState).toContain("uiState: 'summary_pending'");
    expect(workflowState).toContain("uiState: 'summary_review'");
    expect(workflowState).toContain('Failed to load Formation session.');
  });

  it('records corrections through an owner-scoped idempotent immutable Evidence RPC', async () => {
    const [route, migration] = await Promise.all([
      read('app/api/formation/sessions/[sessionId]/correct/route.ts'),
      read('supabase/migrations/20260806000000_formation_p1_stabilization.sql'),
    ]);
    expect(route).toContain('zeya_record_formation_owner_correction');
    expect(route).toContain(".eq('owner_id', auth.user.id)");
    expect(route).toContain('p_request_key: body.requestKey');
    expect(route).not.toContain('statement_content');
    expect(route).not.toContain("source: 'formation_owner_correction'");
    expect(migration).toContain('source_formation_session_id');
    expect(migration).toContain('source_formation_proposal_id');
    expect(migration).toContain('source_correction_request_key');
    expect(migration).toContain("'conversation'::public.evidence_source_type");
    expect(migration).toContain("SET status = 'superseded'");
  });

  it('computes stable fingerprints from exact persisted identifiers and inputs', () => {
    const base = {
      formationSessionId: 'formation-a',
      proposalId: 'proposal-a',
      generatorVersion: 'rf-b-v2',
      evidence: [{ id: 'evidence-a', statement_hash: 'hash-a' }],
      observations: [{ id: 'observation-a', interpreted_meaning: 'Provisional meaning' }],
      elementUpdates: {},
    };
    const first = computeFormationSummaryFingerprint(base);
    expect(computeFormationSummaryFingerprint(base)).toBe(first);
    expect(computeFormationSummaryFingerprint({ ...base, proposalId: 'proposal-b' })).not.toBe(first);
    expect(computeFormationSummaryFingerprint({
      ...base,
      evidence: [...base.evidence, { id: 'evidence-b', statement_hash: 'hash-b' }],
    })).not.toBe(first);
  });

  it('projects an unchanged persisted summary as current and changed input as stale', () => {
    const evidence = [{ id: 'evidence-a', statement_hash: 'hash-a' }];
    const observations = [{ id: 'observation-a', interpreted_meaning: 'Meaning' }];
    const fingerprint = computeFormationSummaryFingerprint({
      formationSessionId: 'formation-a', proposalId: 'proposal-a',
      generatorVersion: 'rf-b-v2', evidence, observations,
    });
    const proposal = {
      id: 'proposal-a', formation_session_id: 'formation-a', status: 'draft',
      created_at: '2026-08-04T00:00:00.000Z',
      proposed_changes: {
        _metadata: {
          formationSessionId: 'formation-a', reviewType: 'formation_initial_review',
          sourceFingerprint: fingerprint, generatorVersion: 'rf-b-v2',
          reviewedAt: '2026-08-04T00:00:00.000Z', reviewedByOwnerId: 'owner-a',
        },
        _review: { sections: [{ title: 'Review', content: 'Content' }] },
        elementUpdates: {},
      },
    };
    expect(projectFormationSummary({ formationSessionId: 'formation-a', proposal, evidence, observations })?.isCurrent).toBe(true);
    expect(projectFormationSummary({
      formationSessionId: 'formation-a', proposal,
      evidence: [...evidence, { id: 'evidence-b', statement_hash: 'hash-b' }], observations,
    })?.isCurrent).toBe(false);
  });

  it('gives a canonical pointer precedence without changing multiple-Business behavior', async () => {
    const route = await read('app/api/owner/status/route.ts');
    expect(route.indexOf('if (representation.current_version_id)')).toBeLessThan(
      route.indexOf(".from('representation_formation_sessions')"),
    );
    expect(route).toContain("error: 'business_selection_required'");
    expect(route).toContain("return newOwnerResponse();");
  });

  it('does not introduce Direct Hire handoff or canonical automation', async () => {
    const migration = await read('supabase/migrations/20260806000000_formation_p1_stabilization.sql');
    expect(migration).not.toContain('direct_hire_onboarding');
    expect(migration).not.toContain('representation_versions');
    expect(migration).not.toContain('current_version_id');
    expect(migration).not.toContain('public_experience_sessions');
  });
});
