import type { SupabaseClient } from '@supabase/supabase-js';
import { applyOwnerHypothesisDecision } from '@/lib/onboarding/owner-hypothesis-decision';
import {
  answerOperationId,
  classifyOwnerAnswer,
  containsForbiddenConversationText,
  governedDecisionKey,
  resolutionForClassification,
} from './direct-hire-text-conversation';

type AgendaRow = {
  id: string; agenda_item_id: string; rank: number; category: string; blocking: boolean;
  constitutional_domain: string | null; question_intent: string; suggested_wording: string | null;
  source_hypothesis_ids: string[];
};
type RunRow = { id: string; status: 'active' | 'paused' | 'completed' | 'abandoned'; formation_session_id: string };

export type OwnerSafeConversationState = {
  status: RunRow['status'];
  message: string;
  currentTopic: string | null;
  progress: { answered: number; total: number };
  blockingItemsRemaining: number;
  complete: boolean;
};

async function ownedRun(client: SupabaseClient, formationSessionId: string, ownerId: string): Promise<RunRow | null> {
  const result = await client.from('direct_hire_formation_conversation_runs')
    .select('id,status,formation_session_id').eq('formation_session_id', formationSessionId)
    .eq('owner_id', ownerId).in('status', ['active', 'paused', 'completed']).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error('conversation_lookup_failed');
  return result.data as RunRow | null;
}

async function loadState(client: SupabaseClient, run: RunRow): Promise<OwnerSafeConversationState> {
  const [agendaResult, eventResult, turnResult] = await Promise.all([
    client.from('direct_hire_first_working_session_formation_agenda_items').select('id,agenda_item_id,rank,category,blocking,constitutional_domain,question_intent,suggested_wording,source_hypothesis_ids').eq('formation_session_id', run.formation_session_id).order('rank'),
    client.from('direct_hire_formation_agenda_resolution_events').select('agenda_item_id,resolution_state,created_at').eq('run_id', run.id).order('created_at'),
    client.from('direct_hire_formation_conversation_turns').select('owner_safe_text,agenda_item_id,speaker,sequence').eq('run_id', run.id).order('sequence', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (agendaResult.error || eventResult.error || turnResult.error) throw new Error('conversation_state_failed');
  const agenda = (agendaResult.data ?? []) as AgendaRow[];
  const latest = new Map<string, string>();
  for (const event of eventResult.data ?? []) latest.set(event.agenda_item_id, event.resolution_state);
  const remaining = agenda.filter((item) => !latest.has(item.id) || latest.get(item.id) === 'still_unresolved');
  const current = agenda.find((item) => item.id === turnResult.data?.agenda_item_id) ?? remaining[0] ?? null;
  return {
    status: run.status,
    message: run.status === 'completed'
      ? 'Our first working session is complete. I have enough governed information to prepare how I will represent the business.'
      : (turnResult.data?.owner_safe_text ?? 'Let’s begin.'),
    currentTopic: current?.category ?? null,
    progress: { answered: agenda.length - remaining.length, total: agenda.length },
    blockingItemsRemaining: remaining.filter((item) => item.blocking).length,
    complete: run.status === 'completed',
  };
}

export async function startOrResumeTextConversation(client: SupabaseClient, formationSessionId: string, ownerId: string) {
  const response = await client.rpc('zeya_start_or_resume_direct_hire_formation_conversation', { p_owner_id: ownerId, p_formation_session_id: formationSessionId });
  if (response.error) throw new Error('conversation_start_failed');
  const run = await ownedRun(client, formationSessionId, ownerId);
  if (!run) throw new Error('conversation_lineage_missing');
  return loadState(client, run);
}

export async function getTextConversationState(client: SupabaseClient, formationSessionId: string, ownerId: string) {
  const run = await ownedRun(client, formationSessionId, ownerId);
  return run ? loadState(client, run) : null;
}

export async function pauseTextConversation(client: SupabaseClient, formationSessionId: string, ownerId: string) {
  const run = await ownedRun(client, formationSessionId, ownerId);
  if (!run) throw new Error('conversation_not_found');
  const response = await client.rpc('zeya_pause_direct_hire_formation_conversation', { p_owner_id: ownerId, p_run_id: run.id });
  if (response.error) throw new Error('conversation_pause_failed');
  return { ...(await loadState(client, { ...run, status: 'paused' })), status: 'paused' as const };
}

export async function submitTextConversationAnswer(client: SupabaseClient, input: {
  formationSessionId: string; ownerId: string; idempotencyKey: string; answer: string;
}) {
  const answer = input.answer.trim();
  if (containsForbiddenConversationText(answer)) throw new Error('unsafe_conversation_text');
  const run = await ownedRun(client, input.formationSessionId, input.ownerId);
  if (!run) throw new Error('conversation_not_active');
  const replay = await client.from('direct_hire_formation_conversation_turns').select('id,owner_safe_text')
    .eq('run_id', run.id).eq('idempotency_key', input.idempotencyKey).maybeSingle();
  if (replay.error) throw new Error('conversation_replay_lookup_failed');
  if (replay.data) {
    if (replay.data.owner_safe_text !== answer) throw new Error('conversation_idempotency_conflict');
    return loadState(client, run);
  }
  if (run.status !== 'active') throw new Error('conversation_not_active');
  const turn = await client.from('direct_hire_formation_conversation_turns').select('agenda_item_id,owner_safe_text,governed_semantic_key').eq('run_id', run.id).eq('speaker', 'zeya').order('sequence', { ascending: false }).limit(1).single();
  if (turn.error || !turn.data) throw new Error('conversation_question_missing');
  const agendaResult = await client.from('direct_hire_first_working_session_formation_agenda_items')
    .select('id,agenda_item_id,rank,category,blocking,constitutional_domain,question_intent,suggested_wording,source_hypothesis_ids')
    .eq('id', turn.data.agenda_item_id).eq('formation_session_id', run.formation_session_id).single();
  if (agendaResult.error || !agendaResult.data) throw new Error('conversation_agenda_missing');
  const item = agendaResult.data as AgendaRow;
  let classification = classifyOwnerAnswer({ text: answer, category: item.category });
  const prior = await client.from('direct_hire_formation_agenda_resolution_events').select('id').eq('run_id', run.id).eq('agenda_item_id', item.id).eq('resolution_state', 'still_unresolved');
  if (prior.error) throw new Error('conversation_resolution_lookup_failed');
  if ((classification === 'unclear' || classification === 'nonresponsive') && (prior.data?.length ?? 0) >= 1) classification = 'defer';
  const key = governedDecisionKey({
    classification,
    explicitSemanticKey: turn.data.governed_semantic_key,
    constitutionalDomain: item.constitutional_domain,
    frozenQuestionIntent: item.question_intent,
  });
  if ((classification === 'commercial_decision' || classification.startsWith('authority_')) && !key) {
    classification = 'unclear';
  }
  if (classification === 'commercial_decision' && item.constitutional_domain === 'whatYouSell') {
    classification = item.source_hypothesis_ids[0] ? 'confirm' : 'unclear';
  }
  let hypothesisOperationId: string | null = null;
  if (['confirm', 'correct', 'defer'].includes(classification) && item.source_hypothesis_ids[0]) {
    hypothesisOperationId = answerOperationId(run.id, input.idempotencyKey);
    await applyOwnerHypothesisDecision(client, {
      authenticatedOwnerId: input.ownerId, hypothesisId: item.source_hypothesis_ids[0], operationId: hypothesisOperationId,
      decision: classification === 'confirm' ? 'approved' : classification === 'correct' ? 'rejected' : 'deferred',
      ...(classification === 'correct' ? { correctionText: answer } : {}),
    });
  }
  const response = await client.rpc('zeya_record_direct_hire_formation_answer', {
    p_owner_id: input.ownerId, p_run_id: run.id, p_agenda_item_id: item.id, p_idempotency_key: input.idempotencyKey,
    p_owner_text: answer, p_classification: classification, p_resolution_state: resolutionForClassification(classification),
    p_decision_key: key, p_decision_value: key ? { statement: answer } : null, p_hypothesis_operation_id: hypothesisOperationId,
  });
  if (response.error) throw new Error('conversation_answer_failed');
  const persistedRun = await ownedRun(client, input.formationSessionId, input.ownerId);
  if (!persistedRun) throw new Error('conversation_completion_readback_failed');
  return { ...(await loadState(client, persistedRun)), answerClassification: classification };
}
