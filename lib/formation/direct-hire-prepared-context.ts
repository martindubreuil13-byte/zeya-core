import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirstWorkingSessionBrief } from '@/lib/onboarding/first-working-session-brief';

type HandoffRow = {
  id: string;
  formation_session_id: string;
  direct_hire_working_session_id: string;
  direct_hire_onboarding_session_id: string;
  business_representation_id: string;
  preparation_brief_id: string;
  preparation_snapshot_fingerprint: string;
  hypothesis_trace_fingerprint: string;
  preparation_contract_version: string;
};

type AgendaRow = {
  agenda_item_id: string;
  rank: number;
  category: string;
  constitutional_domain: string | null;
  risk: string;
  blocking: boolean;
  resolution_status: 'unresolved';
  source_brief_sections: string[];
  source_hypothesis_ids: string[];
  source_evidence_ids: string[];
  question_intent: string;
  suggested_wording: string | null;
  created_from_snapshot_fingerprint: string;
};

export type DirectHireFormationPreparedContext = {
  ownerSafe: {
    openingSynthesis: string;
    agendaCategories: string[];
    agendaCount: number;
    blockingItemCount: number;
    currentSessionState: string;
  };
  privateServiceContext: {
    formationSessionId: string;
    workingSessionId: string;
    onboardingSessionId: string;
    businessRepresentationId: string;
    preparationBriefId: string;
    preparationContractVersion: string;
    preparationSnapshotFingerprint: string;
    hypothesisTraceFingerprint: string;
    agenda: AgendaRow[];
  };
};

export async function loadDirectHireFormationPreparedContext(input: {
  client: SupabaseClient;
  formationSessionId: string;
  ownerId: string;
}): Promise<DirectHireFormationPreparedContext | null> {
  const formationResult = await input.client
    .from('representation_formation_sessions')
    .select('id,status,owner_id,initiated_from')
    .eq('id', input.formationSessionId)
    .eq('owner_id', input.ownerId)
    .maybeSingle();
  if (formationResult.error) throw new Error('formation_context_lookup_failed');
  if (!formationResult.data || formationResult.data.initiated_from !== 'direct_hire_onboarding') return null;

  const handoffResult = await input.client
    .from('direct_hire_first_working_session_formation_handoffs')
    .select('id,formation_session_id,direct_hire_working_session_id,direct_hire_onboarding_session_id,business_representation_id,preparation_brief_id,preparation_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version')
    .eq('formation_session_id', input.formationSessionId)
    .eq('owner_id', input.ownerId)
    .maybeSingle();
  if (handoffResult.error) throw new Error('formation_handoff_lookup_failed');
  if (!handoffResult.data) throw new Error('formation_handoff_lineage_missing');
  const handoff = handoffResult.data as HandoffRow;

  const [briefResult, agendaResult] = await Promise.all([
    input.client.from('direct_hire_first_working_session_briefs')
      .select('id,brief,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version')
      .eq('id', handoff.preparation_brief_id)
      .eq('direct_hire_working_session_id', handoff.direct_hire_working_session_id)
      .maybeSingle(),
    input.client.from('direct_hire_first_working_session_formation_agenda_items')
      .select('agenda_item_id,rank,category,constitutional_domain,risk,blocking,resolution_status,source_brief_sections,source_hypothesis_ids,source_evidence_ids,question_intent,suggested_wording,created_from_snapshot_fingerprint')
      .eq('formation_session_id', input.formationSessionId)
      .order('rank', { ascending: true }),
  ]);
  if (briefResult.error || !briefResult.data || agendaResult.error) {
    throw new Error('formation_prepared_context_incomplete');
  }
  if (briefResult.data.source_snapshot_fingerprint !== handoff.preparation_snapshot_fingerprint
    || briefResult.data.hypothesis_trace_fingerprint !== handoff.hypothesis_trace_fingerprint
    || briefResult.data.preparation_contract_version !== handoff.preparation_contract_version) {
    throw new Error('formation_handoff_fingerprint_mismatch');
  }
  const brief = briefResult.data.brief as FirstWorkingSessionBrief;
  const agenda = (agendaResult.data ?? []) as AgendaRow[];
  if (agenda.length === 0 || agenda.some((item, index) =>
    item.rank !== index + 1
      || item.created_from_snapshot_fingerprint !== handoff.preparation_snapshot_fingerprint)) {
    throw new Error('formation_agenda_invalid');
  }

  const opening = [brief.businessRead.statement, brief.openingInsights[0]?.statement]
    .filter(Boolean).join(' ').trim();
  return {
    ownerSafe: {
      openingSynthesis: opening,
      agendaCategories: [...new Set(agenda.map((item) => item.category))],
      agendaCount: agenda.length,
      blockingItemCount: agenda.filter((item) => item.blocking).length,
      currentSessionState: formationResult.data.status,
    },
    privateServiceContext: {
      formationSessionId: handoff.formation_session_id,
      workingSessionId: handoff.direct_hire_working_session_id,
      onboardingSessionId: handoff.direct_hire_onboarding_session_id,
      businessRepresentationId: handoff.business_representation_id,
      preparationBriefId: handoff.preparation_brief_id,
      preparationContractVersion: handoff.preparation_contract_version,
      preparationSnapshotFingerprint: handoff.preparation_snapshot_fingerprint,
      hypothesisTraceFingerprint: handoff.hypothesis_trace_fingerprint,
      agenda,
    },
  };
}
