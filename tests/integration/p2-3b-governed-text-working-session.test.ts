import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyOwnerAnswer, containsForbiddenConversationText, governedDecisionKey, ownerSafeQuestion, resolutionForClassification, selectNextAgendaItem } from '../../lib/formation/direct-hire-text-conversation';

describe('P2.3B governed text working session', () => {
  it('selects blocking work first and otherwise preserves deterministic rank', () => {
    const agenda = [
      { id: 'a', rank: 1, category: 'commercial', blocking: false, questionIntent: 'Goal?', suggestedWording: null },
      { id: 'b', rank: 4, category: 'authority', blocking: true, questionIntent: 'Pricing authority?', suggestedWording: null },
      { id: 'c', rank: 2, category: 'clarification', blocking: false, questionIntent: 'Target?', suggestedWording: null },
    ];
    expect(selectNextAgendaItem({ agenda, resolutions: [] })?.id).toBe('b');
    expect(selectNextAgendaItem({ agenda, resolutions: [{ agendaItemId: 'b', resolutionState: 'resolved' }] })?.id).toBe('a');
    expect(selectNextAgendaItem({ agenda, resolutions: [{ agendaItemId: 'b', resolutionState: 'superseded_by_prior_answer' }] })?.id).toBe('a');
  });

  it('classifies bounded owner outcomes and allows only one explicit follow-up wording', () => {
    expect(classifyOwnerAnswer({ category: 'authority', text: 'You may quote pricing up to $2,000.' })).toBe('authority_grant');
    expect(classifyOwnerAnswer({ category: 'authority', text: 'Never promise a delivery date without owner approval.' })).toBe('authority_restriction');
    expect(classifyOwnerAnswer({ category: 'commercial', text: 'Our immediate goal is ten qualified meetings.' })).toBe('commercial_decision');
    expect(classifyOwnerAnswer({ category: 'clarification', text: 'Actually, that is incorrect.', hypothesisBacked: true })).toBe('correct');
    expect(classifyOwnerAnswer({ category: 'clarification', text: 'later' })).toBe('defer');
    expect(resolutionForClassification('unclear')).toBe('still_unresolved');
    expect(ownerSafeQuestion({ id: 'x', rank: 1, category: 'authority', blocking: true, questionIntent: 'Set a boundary.', suggestedWording: null }, 1)).toContain('one clearer boundary');
  });

  it('recognizes natural affirmative confirmation only with hypothesis lineage', () => {
    const backed = { category: 'commercial', hypothesisBacked: true };
    expect(classifyOwnerAnswer({ ...backed, text: 'Yes.' })).toBe('confirm');
    expect(classifyOwnerAnswer({ ...backed, text: "Correct — that's what we offer." })).toBe('confirm');
    expect(classifyOwnerAnswer({ ...backed, text: 'Yes, that description is accurate.' })).toBe('confirm');
    expect(classifyOwnerAnswer({ ...backed, text: 'Yes. We sell business coaching and business architecture services.' })).toBe('confirm');
    expect(classifyOwnerAnswer({ ...backed, text: 'Yes, but actually we mostly sell consulting to SMEs.' })).toBe('correct');
    expect(classifyOwnerAnswer({ ...backed, text: "No, that's wrong." })).toBe('correct');
    expect(classifyOwnerAnswer({ ...backed, text: "Let's come back to that later." })).toBe('defer');
    expect(classifyOwnerAnswer({ category: 'commercial', hypothesisBacked: false, text: "Yes, let's target Canada." })).toBe('commercial_decision');
    expect(classifyOwnerAnswer({ category: 'clarification', hypothesisBacked: false, text: 'This is a long but non-affirmative generic answer.' })).toBe('unclear');
  });

  it('rejects internal identifiers, aliases, and hidden-reasoning language from durable prose', () => {
    expect(containsForbiddenConversationText('Use E2 and H1')).toBe(true);
    expect(containsForbiddenConversationText('chain-of-thought follows')).toBe(true);
    expect(containsForbiddenConversationText('You may discuss pricing within the published range.')).toBe(false);
  });

  it('never defaults unknown commercial or authority semantics to a permission-bearing key', () => {
    expect(governedDecisionKey({ classification: 'commercial_decision', constitutionalDomain: null, frozenQuestionIntent: 'Discuss this.' })).toBeNull();
    expect(governedDecisionKey({ classification: 'authority_grant', constitutionalDomain: 'authorityBoundaries', frozenQuestionIntent: 'Clarify authority.' })).toBeNull();
  });

  it('makes persistence additive, isolated, append-only, service-only, idempotent, and noncanonical', async () => {
    const sql = await readFile('supabase/migrations/20260815010000_direct_hire_governed_text_working_session.sql', 'utf8');
    expect(sql).toContain('direct_hire_formation_conversation_runs');
    expect(sql).toContain('direct_hire_formation_conversation_turns');
    expect(sql).toContain('direct_hire_formation_agenda_resolution_events');
    expect(sql).toContain('direct_hire_formation_decisions');
    expect(sql).toContain('WHERE status IN (\'active\',\'paused\')');
    expect(sql).toContain('UNIQUE (run_id, idempotency_key)');
    expect(sql).toContain('Formation conversation history is append-only');
    expect(sql).toMatch(/REVOKE ALL ON TABLE[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain('noncanonical boolean NOT NULL CHECK (noncanonical)');
    expect(sql).not.toMatch(/INSERT INTO public\.representation_proposals/i);
    expect(sql).not.toMatch(/INSERT INTO public\.representation_versions/i);
    expect(sql).not.toMatch(/current_version_id\s*=/i);
    expect(sql).not.toMatch(/first_working_conversation_id\s*=/i);
    expect(sql).not.toMatch(/SET status='working_conversation_linked'/i);
  });

  it('keeps P2.3A agenda immutable and derives status from latest events', async () => {
    const sql = await readFile('supabase/migrations/20260815010000_direct_hire_governed_text_working_session.sql', 'utf8');
    expect(sql).not.toMatch(/UPDATE public\.direct_hire_first_working_session_formation_agenda_items/i);
    expect(sql).toContain("latest.resolution_state IS NULL OR latest.resolution_state='still_unresolved'");
    expect(sql).toContain("v_followups>=1");
    expect(sql).toContain('other.source_hypothesis_ids @> ARRAY[');
    expect(sql).toContain("'superseded_by_prior_answer'");
  });

  it('keeps the API owner-safe', async () => {
    const [route, service] = await Promise.all([
      readFile('app/api/formation/sessions/[sessionId]/conversation/route.ts', 'utf8'),
      readFile('lib/formation/direct-hire-text-conversation-service.ts', 'utf8'),
    ]);
    expect(route).not.toMatch(/hypothesisIds|evidenceIds|fingerprint/i);
    expect(service).toContain('blockingItemsRemaining');
    expect(service).toContain('applyOwnerHypothesisDecision');
  });
});
