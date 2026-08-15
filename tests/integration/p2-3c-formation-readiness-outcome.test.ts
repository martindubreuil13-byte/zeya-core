import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boundedAuthorityDisposition, deriveTelephoneBdReadiness, deterministicOutcomeFingerprint, TELEPHONE_BD_READINESS_CATEGORIES } from '../../lib/formation/direct-hire-formation-readiness';

const completeSources = [
  { key: 'offer', sourceIds: ['offer-event'] },
  { key: 'primary_target_segment', disposition: 'decided' as const, sourceIds: ['target-decision'] },
  { key: 'immediate_bd_goal', disposition: 'decided' as const, sourceIds: ['goal-decision'] },
  { key: 'qualification_threshold', disposition: 'decided' as const, sourceIds: ['qualification-decision'] },
  { key: 'meeting_objective', disposition: 'decided' as const, sourceIds: ['meeting-decision'] },
  { key: 'authority_pricing', disposition: 'owner_approval_required' as const, sourceIds: ['pricing-decision'] },
  { key: 'authority_negotiation', disposition: 'prohibited' as const, sourceIds: ['negotiation-decision'] },
  { key: 'authority_customer_commitments', disposition: 'prohibited' as const, sourceIds: ['commitment-decision'] },
  { key: 'authority_meeting_booking', disposition: 'allowed_within_bounds' as const, sourceIds: ['booking-decision'] },
  { key: 'authority_escalation_rules', disposition: 'owner_approval_required' as const, sourceIds: ['escalation-decision'] },
];

describe('P2.3C telephone-BD readiness and outcome package', () => {
  it('requires exactly the eleven bounded readiness categories', () => {
    expect(TELEPHONE_BD_READINESS_CATEGORIES).toEqual([
      'offer', 'target', 'immediate_bd_objective', 'qualification', 'meeting_objective',
      'pricing_authority', 'negotiation_authority', 'commitment_authority',
      'meeting_booking_authority', 'escalation_owner_approval', 'blocking_contradictions',
    ]);
    expect(deriveTelephoneBdReadiness({ sources: completeSources }).ready).toBe(true);
  });

  it.each([
    ['immediate_bd_goal', 'immediate_bd_objective'], ['qualification_threshold', 'qualification'],
    ['meeting_objective', 'meeting_objective'], ['authority_pricing', 'pricing_authority'],
    ['authority_negotiation', 'negotiation_authority'], ['authority_customer_commitments', 'commitment_authority'],
    ['authority_meeting_booking', 'meeting_booking_authority'], ['authority_escalation_rules', 'escalation_owner_approval'],
  ])('blocks completion when %s is missing', (key, category) => {
    const result = deriveTelephoneBdReadiness({ sources: completeSources.filter((source) => source.key !== key) });
    expect(result.ready).toBe(false);
    expect(result.categories[category as keyof typeof result.categories].state).toBe('unresolved');
  });

  it('fails closed for unknown authority and accepts approval-gated or prohibited boundaries', () => {
    expect(boundedAuthorityDisposition('Use your judgment.')).toBe('unresolved');
    expect(boundedAuthorityDisposition('Owner approval is required.')).toBe('owner_approval_required');
    expect(boundedAuthorityDisposition('Never negotiate price.')).toBe('prohibited');
    expect(boundedAuthorityDisposition('You may offer up to ten percent.')).toBe('allowed_within_bounds');
    const vague = completeSources.map((source) => source.key === 'authority_pricing' ? { ...source, disposition: 'unresolved' as const } : source);
    expect(deriveTelephoneBdReadiness({ sources: vague }).ready).toBe(false);
  });

  it('blocks high-risk contradictions while optional refinements do not participate', () => {
    expect(deriveTelephoneBdReadiness({ sources: completeSources, blockingContradictionSourceIds: ['contradiction'] }).categories.blocking_contradictions.state).toBe('blocked');
    expect(deriveTelephoneBdReadiness({ sources: completeSources }).ready).toBe(true);
  });

  it('fingerprints normalized outcome content deterministically and detects source changes', () => {
    const left = deterministicOutcomeFingerprint({ decisions: [{ key: 'pricing', value: 1 }], ready: true });
    const reordered = deterministicOutcomeFingerprint({ ready: true, decisions: [{ value: 1, key: 'pricing' }] });
    const changed = deterministicOutcomeFingerprint({ ready: true, decisions: [{ value: 2, key: 'pricing' }] });
    expect(left).toBe(reordered);
    expect(changed).not.toBe(left);
  });

  it('adds only the missing durable completion/outcome layer', async () => {
    const sql = await readFile('supabase/migrations/20260816000000_direct_hire_formation_readiness_outcome.sql', 'utf8');
    expect(sql).toContain('direct_hire_formation_outcome_packages');
    expect(sql).toContain('direct-hire-telephone-bd-readiness-v1');
    expect(sql).toContain('authority_meeting_booking');
    expect(sql).toContain('direct_hire_formation_decision_cross_derivation');
    expect(sql).toContain('ON CONFLICT (source_owner_turn_id,decision_key) DO NOTHING');
    expect(sql).toContain('direct_hire_required_agenda_defer_gate');
    expect(sql).toContain("RETURN OLD;");
    expect(sql).toContain('zeya_direct_hire_formation_source_state_fingerprint');
    expect(sql).toContain('zeya_direct_hire_formation_outcome_is_current');
    expect(sql).toContain('Formation outcome package is immutable');
    expect(sql).not.toMatch(/INSERT INTO public\.representation_proposals/i);
    expect(sql).not.toMatch(/INSERT INTO public\.representation_versions/i);
    expect(sql).not.toMatch(/current_version_id\s*=/i);
    expect(sql).not.toMatch(/first_working_conversation_id\s*=/i);
    expect(sql).not.toMatch(/working_conversation_linked/i);
    expect(sql).not.toMatch(/UPDATE public\.direct_hire_first_working_session_(?:briefs|formation_agenda_items)/i);
  });

  it('preserves the existing governed correction and idempotent answer paths', async () => {
    const service = await readFile('lib/formation/direct-hire-text-conversation-service.ts', 'utf8');
    expect(service).toContain('applyOwnerHypothesisDecision');
    expect(service).toContain("classification === 'correct' ? 'rejected'");
    expect(service).toContain('answerOperationId(run.id, input.idempotencyKey)');
    expect(service).toContain('conversation_idempotency_conflict');
    expect(service).toContain('persistedRun');
  });
});
