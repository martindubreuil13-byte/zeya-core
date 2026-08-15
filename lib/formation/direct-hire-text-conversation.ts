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

const DEFER = /\b(?:defer|later|not now|come back|unsure|don't know yet|do not know yet)\b/i;
const RESTRICT = /\b(?:cannot|can't|must not|do not|don't|prohibit|never|owner approval|required approval|escalat)\b/i;
const GRANT = /\b(?:may|can|allowed|authori[sz]e|up to|without approval)\b/i;
const CORRECT = /\b(?:incorrect|wrong|actually|correction|not accurate)\b/i;
const CONFIRM = /^(?:yes|correct|confirmed|that's right|that is right)[.!\s]*$/i;

export function classifyOwnerAnswer(input: {
  text: string;
  category: string;
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
  if (CONFIRM.test(text)) return 'confirm';
  if (input.category === 'commercial' && text.length >= 12) return 'commercial_decision';
  return text.length >= 24 ? 'confirm' : 'unclear';
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
