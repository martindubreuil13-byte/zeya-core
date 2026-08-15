import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boundedAuthorityDisposition, deriveTelephoneBdReadiness, deterministicOutcomeFingerprint, TELEPHONE_BD_READINESS_CATEGORIES } from '../../lib/formation/direct-hire-formation-readiness';
import { governedDecisionKey } from '../../lib/formation/direct-hire-text-conversation';

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

  it('maps the exact live target reproduction from governed domain, never display wording', () => {
    const key = governedDecisionKey({
      classification: 'commercial_decision', constitutionalDomain: 'whoItIsFor',
      frozenQuestionIntent: 'If wrong about this, it could lead to targeting the wrong market',
    });
    expect(key).toBe('primary_target_segment');
    expect(key).not.toBe('immediate_bd_goal');
    if (!key) throw new Error('expected governed target key');
    const readiness = deriveTelephoneBdReadiness({ sources: [
      ...completeSources.filter((source) => !['primary_target_segment', 'immediate_bd_goal'].includes(source.key)),
      { key, disposition: 'decided', sourceIds: ['replacement'] },
    ] });
    expect(readiness.categories.target.state).toBe('satisfied');
    expect(readiness.categories.immediate_bd_objective.state).toBe('unresolved');
  });

  it('routes the exact live whatYouSell affirmative through hypothesis confirmation', async () => {
    const answer = 'Yes. We sell business coaching and business architecture services.';
    const { classifyOwnerAnswer } = await import('../../lib/formation/direct-hire-text-conversation');
    const classification = classifyOwnerAnswer({ category: 'commercial', hypothesisBacked: true, text: answer });
    expect(classification).toBe('confirm');
    expect(governedDecisionKey({
      classification,
      constitutionalDomain: 'whatYouSell',
      frozenQuestionIntent: 'If wrong about this, customer expectations may not align with service delivery',
    })).toBeNull();
    const service = await readFile('lib/formation/direct-hire-text-conversation-service.ts', 'utf8');
    expect(service).toContain('hypothesisBacked: item.source_hypothesis_ids.length > 0');
    expect(service).toContain("classification === 'confirm' ? 'approved'");
  });

  it('uses metadata despite adversarial conversational wording and fails closed when unmappable', () => {
    expect(governedDecisionKey({ classification: 'commercial_decision', constitutionalDomain: 'whoItIsFor', frozenQuestionIntent: 'Who should we focus on first?' })).toBe('primary_target_segment');
    expect(governedDecisionKey({ classification: 'commercial_decision', constitutionalDomain: null, frozenQuestionIntent: 'What makes someone worth pursuing?' })).toBe('qualification_threshold');
    expect(governedDecisionKey({ classification: 'commercial_decision', explicitSemanticKey: 'meeting_objective', constitutionalDomain: null, frozenQuestionIntent: 'Unrelated display prose' })).toBe('meeting_objective');
    expect(governedDecisionKey({ classification: 'commercial_decision', explicitSemanticKey: 'immediate_bd_goal', constitutionalDomain: null, frozenQuestionIntent: 'Unrelated display prose' })).toBe('immediate_bd_goal');
    expect(governedDecisionKey({ classification: 'commercial_decision', constitutionalDomain: null, frozenQuestionIntent: 'What do you think?' })).toBeNull();
    expect(governedDecisionKey({ classification: 'authority_grant', constitutionalDomain: 'authorityBoundaries', frozenQuestionIntent: 'Use your judgment.' })).toBeNull();
  });

  it('provides append-only semantic recovery and excludes the bad row from readiness', async () => {
    const sql = await readFile('supabase/migrations/20260816010000_direct_hire_formation_decision_semantic_recovery.sql', 'utf8');
    expect(sql).toContain('direct_hire_formation_decision_supersessions');
    expect(sql).toContain('corrected_application_semantic_mapping');
    expect(sql).toContain("v_bad.decision_key<>'immediate_bd_goal'");
    expect(sql).toContain("agenda.constitutional_domain='whoItIsFor'");
    expect(sql).toContain("'commercial','primary_target_segment','decided'");
    expect(sql).toContain('supersession.erroneous_decision_id=d.id');
    expect(sql).toContain('direct_hire_formation_outcome_supersession_sanitize');
    expect(sql).not.toMatch(/UPDATE public\.direct_hire_formation_decisions/i);
    expect(sql).not.toMatch(/DELETE FROM public\.direct_hire_formation_decisions/i);
  });

  it('persists every synthetic readiness key and inherits it across follow-ups', async () => {
    const sql = await readFile('supabase/migrations/20260816020000_direct_hire_readiness_semantic_propagation.sql', 'utf8');
    for (const key of [
      'authority_pricing', 'authority_negotiation', 'authority_customer_commitments',
      'authority_meeting_booking', 'authority_escalation_rules', 'primary_target_segment',
      'immediate_bd_goal', 'qualification_threshold', 'meeting_objective',
    ]) expect(sql).toContain(key);
    expect(sql).toContain('governed_semantic_key)');
    expect(sql).toContain("NEW.turn_type='follow_up_question'");
    expect(sql).toContain('SELECT prior.governed_semantic_key INTO NEW.governed_semantic_key');
    expect(sql).toContain('zeya_reissue_direct_hire_readiness_question');
    expect(sql).toContain("v_latest.turn_type<>'follow_up_question'");
    expect(sql).not.toMatch(/INSERT INTO public\.representation_proposals|INSERT INTO public\.representation_versions|current_version_id\s*=|first_working_conversation_id\s*=/i);
  });

  it('classifies the exact natural pricing boundary without deriving negotiation', async () => {
    const { classifyOwnerAnswer } = await import('../../lib/formation/direct-hire-text-conversation');
    const answer = 'Zeya may explain the published pricing, but any discount, custom price, or change to the commercial terms requires my approval.';
    expect(classifyOwnerAnswer({ category: 'authority', hypothesisBacked: false, text: answer })).toBe('authority_restriction');
    expect(governedDecisionKey({ classification: 'authority_restriction', explicitSemanticKey: 'authority_pricing', constitutionalDomain: 'authorityBoundaries', frozenQuestionIntent: 'unrelated' })).toBe('authority_pricing');
    const sql = await readFile('supabase/migrations/20260816020000_direct_hire_readiness_semantic_propagation.sql', 'utf8');
    expect(sql).toContain("CASE WHEN v_text~*'discount' THEN 'authority_discounts'");
    expect(answer).not.toMatch(/negotiat/i);
  });
});
