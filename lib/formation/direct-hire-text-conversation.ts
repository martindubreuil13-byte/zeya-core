import { createHash } from 'node:crypto';

export type OwnerAnswerClassification =
  | 'confirm'
  | 'correct'
  | 'authority_grant'
  | 'authority_restriction'
  | 'commercial_decision'
  | 'defer'
  | 'unclear'
  | 'nonresponsive';

export type AgendaResolutionState =
  | 'resolved'
  | 'deferred'
  | 'still_unresolved'
  | 'superseded_by_prior_answer';

export type ConversationAgendaItem = {
  id: string;
  rank: number;
  category: string;
  blocking: boolean;
  questionIntent: string;
  suggestedWording: string | null;
};

export type AgendaResolution = { agendaItemId: string; resolutionState: AgendaResolutionState };

export type GovernedDecisionKey =
  | 'primary_target_segment'
  | 'immediate_bd_goal'
  | 'qualification_threshold'
  | 'meeting_objective'
  | 'geography'
  | 'explicit_exclusions'
  | 'authority_pricing'
  | 'authority_discounts'
  | 'authority_negotiation'
  | 'authority_customer_commitments'
  | 'authority_meeting_booking'
  | 'authority_owner_approval_required'
  | 'authority_escalation_rules'
  | 'authority_prohibited_claims';

const GOVERNED_DECISION_KEYS = new Set<GovernedDecisionKey>([
  'primary_target_segment', 'immediate_bd_goal', 'qualification_threshold', 'meeting_objective',
  'geography', 'explicit_exclusions', 'authority_pricing', 'authority_discounts',
  'authority_negotiation', 'authority_customer_commitments', 'authority_meeting_booking',
  'authority_owner_approval_required', 'authority_escalation_rules', 'authority_prohibited_claims',
]);
const COMMERCIAL_DECISION_KEYS = new Set<GovernedDecisionKey>([
  'primary_target_segment', 'immediate_bd_goal', 'qualification_threshold', 'meeting_objective',
  'geography', 'explicit_exclusions',
]);

export function governedDecisionKey(input: {
  classification: OwnerAnswerClassification;
  explicitSemanticKey?: string | null;
  constitutionalDomain: string | null;
  frozenQuestionIntent: string;
}): GovernedDecisionKey | null {
  if (input.explicitSemanticKey) {
    const key = input.explicitSemanticKey as GovernedDecisionKey;
    if (!GOVERNED_DECISION_KEYS.has(key)) return null;
    if (input.classification === 'commercial_decision') return COMMERCIAL_DECISION_KEYS.has(key) ? key : null;
    if (input.classification.startsWith('authority_')) return COMMERCIAL_DECISION_KEYS.has(key) ? null : key;
    return null;
  }
  if (input.classification === 'commercial_decision') {
    if (input.constitutionalDomain === 'whoItIsFor') return 'primary_target_segment';
    if (input.constitutionalDomain === 'whatYouSell') return null;
    const intent = input.frozenQuestionIntent.toLowerCase();
    if (/qualif|worth pursuing/.test(intent)) return 'qualification_threshold';
    if (/meeting objective|hand someone over|seek a meeting/.test(intent)) return 'meeting_objective';
    if (/immediate (?:bd |business-development )?(?:goal|objective)|accomplish first/.test(intent)) return 'immediate_bd_goal';
    if (/exclusion/.test(intent)) return 'explicit_exclusions';
    if (/geograph|territor/.test(intent)) return 'geography';
    return null;
  }
  if (input.classification.startsWith('authority_')) {
    const intent = input.frozenQuestionIntent.toLowerCase();
    if (/discount/.test(intent)) return 'authority_discounts';
    if (/negotiat/.test(intent)) return 'authority_negotiation';
    if (/promise|commit|guarantee/.test(intent)) return 'authority_customer_commitments';
    if (/book|schedule/.test(intent) && /meeting/.test(intent)) return 'authority_meeting_booking';
    if (/escalat/.test(intent)) return 'authority_escalation_rules';
    if (/prohibited claim|must not claim/.test(intent)) return 'authority_prohibited_claims';
    if (/owner approval|required approval/.test(intent)) return 'authority_owner_approval_required';
    if (/pric/.test(intent)) return 'authority_pricing';
    return null;
  }
  return null;
}

const DEFER = /\b(?:defer|later|not now|come back|unsure|don't know yet|do not know yet)\b/i;
const RESTRICT = /\b(?:may not|cannot|can't|must not|do not|don't|not authori[sz]ed|prohibit(?:ed)?|never|owner approval|required approval|requires? my approval|needs? my approval|check with me first|get my approval first|subject to my approval|escalat(?:e|ed|es|ing))\b/i;
const GRANT = /\b(?:may|can|allowed|authori[sz]e|up to|without approval)\b/i;
const CORRECT = /(?:^\s*no\b|\b(?:incorrect|wrong|actually|correction|not accurate)\b)/i;
const CONFIRM = /^(?:yes\b|correct\b|confirmed\b|that's right\b|that is right\b)/i;

export function classifyOwnerAnswer(input: {
  text: string;
  category: string;
  hypothesisBacked?: boolean;
}): OwnerAnswerClassification {
  const text = input.text.trim();
  if (!text || text.length < 2) return 'nonresponsive';
  if (DEFER.test(text)) return 'defer';
  if (input.category === 'authority') {
    if (RESTRICT.test(text)) return 'authority_restriction';
    if (GRANT.test(text)) return 'authority_grant';
    return 'unclear';
  }
  if (CORRECT.test(text)) return 'correct';
  if (input.hypothesisBacked && CONFIRM.test(text)) return 'confirm';
  if (input.category === 'commercial' && text.length >= 12) return 'commercial_decision';
  return 'unclear';
}

export function resolutionForClassification(
  classification: OwnerAnswerClassification,
): AgendaResolutionState {
  if (classification === 'defer') return 'deferred';
  if (classification === 'unclear' || classification === 'nonresponsive') return 'still_unresolved';
  return 'resolved';
}

export function selectNextAgendaItem(input: {
  agenda: ConversationAgendaItem[];
  resolutions: AgendaResolution[];
}): ConversationAgendaItem | null {
  const latest = new Map(input.resolutions.map((item) => [item.agendaItemId, item.resolutionState]));
  const unresolved = input.agenda.filter((item) => {
    const state = latest.get(item.id);
    return !state || state === 'still_unresolved';
  });
  return unresolved.sort((left, right) =>
    Number(right.blocking) - Number(left.blocking) || left.rank - right.rank)[0] ?? null;
}

export function ownerSafeQuestion(item: ConversationAgendaItem, followUpCount = 0): string {
  if (followUpCount > 0) {
    return `I need one clearer boundary before we move on: ${item.questionIntent}`;
  }
  return (item.suggestedWording || item.questionIntent).trim();
}

export function answerOperationId(runId: string, idempotencyKey: string): string {
  const hex = createHash('sha256').update(`${runId}|${idempotencyKey}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function containsForbiddenConversationText(text: string): boolean {
  return /\b(?:chain[- ]of[- ]thought|hidden reasoning|\bE\d+\b|\bH\d+\b)\b/i.test(text)
    || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text);
}
