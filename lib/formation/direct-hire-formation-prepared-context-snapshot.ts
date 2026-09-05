// Formation Prepared Context Snapshot Service
// Loads immutable context bound at Formation entry time
// Both prepared opening and conversation consume the same snapshot

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirstWorkingSessionBrief } from '@/lib/onboarding/first-working-session-brief';
import type { OwnerPreparationProjection } from '@/lib/onboarding/preparation-intelligence';
import { buildPrivatePreparationProjection, toOwnerPreparationProjection } from '@/lib/onboarding/preparation-intelligence';

export type DirectHireFormationPreparedContextSnapshot = {
  ownerSafe: {
    preparation: OwnerPreparationProjection;
    relevantObservations: Array<{ meaning: string; confidence: number; domains: string[] }>;
    openingSynthesis: string;
    agendaCategories: string[];
    agendaCount: number;
    blockingItemCount: number;
    currentSessionState: string;
  };
  privateServiceContext: {
    formationSessionId: string;
    workingSessionId: string;
    businessRepresentationId: string;
    preparationBriefId: string;
    preparationContractVersion: string;
    reasoningContractVersion: string;
    hypothesisSnapshotIds: string[];
    agenda: Array<{
      agenda_item_id: string;
      rank: number;
      category: string;
      constitutional_domain: string | null;
      risk: string;
      blocking: boolean;
      resolution_status: string;
      source_brief_sections: string[];
      source_hypothesis_ids: string[];
      source_evidence_ids: string[];
      question_intent: string;
      suggested_wording: string | null;
    }>;
  };
};

type ContextSnapshotRow = {
  formation_session_id: string;
  preparation_brief_id: string;
  hypothesis_snapshot_ids: string[];
  preparation_contract_version: string;
  reasoning_contract_version: string;
};

export async function loadDirectHireFormationPreparedContextSnapshot(input: {
  client: SupabaseClient;
  formationSessionId: string;
  ownerId: string;
}): Promise<DirectHireFormationPreparedContextSnapshot | null> {
  // Verify Formation exists and belongs to direct-hire onboarding
  const formationResult = await input.client
    .from('representation_formation_sessions')
    .select('id,status,owner_id,business_id,business_representation_id,initiated_from')
    .eq('id', input.formationSessionId)
    .eq('owner_id', input.ownerId)
    .eq('initiated_from', 'direct_hire_onboarding')
    .maybeSingle();

  if (formationResult.error) throw new Error('formation_context_lookup_failed');
  if (!formationResult.data) return null;

  const formation = formationResult.data;

  // Load immutable prepared-context snapshot
  const snapshotResult = await input.client.rpc('zeya_load_formation_prepared_context', {
    p_formation_session_id: input.formationSessionId,
  });

  if (snapshotResult.error) throw new Error('formation_snapshot_lookup_failed');
  if (!snapshotResult.data || snapshotResult.data.length === 0) {
    return null; // No snapshot yet (pre-entry Formation)
  }

  const snapshot = snapshotResult.data[0] as ContextSnapshotRow;

  // Load current brief and agenda using snapshot IDs
  const [briefResult, agendaResult, preparationResult] = await Promise.all([
    input.client.from('direct_hire_first_working_session_briefs')
      .select('id,brief,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version')
      .eq('id', snapshot.preparation_brief_id)
      .maybeSingle(),
    input.client.from('direct_hire_first_working_session_formation_agenda_items')
      .select('agenda_item_id,rank,category,constitutional_domain,risk,blocking,resolution_status,source_brief_sections,source_hypothesis_ids,source_evidence_ids,question_intent,suggested_wording')
      .eq('formation_session_id', input.formationSessionId)
      .order('rank', { ascending: true }),
    buildPrivatePreparationProjection(input.client, {
      ownerId: input.ownerId,
      businessId: formation.business_id,
      businessRepresentationId: formation.business_representation_id,
      onboardingSessionId: '', // Will be resolved from working session in caller
    }),
  ]);

  if (briefResult.error || !briefResult.data || agendaResult.error) {
    throw new Error('formation_snapshot_context_incomplete');
  }

  const brief = briefResult.data.brief as FirstWorkingSessionBrief;
  const agenda = (agendaResult.data ?? []);

  const opening = [brief.businessRead.statement, brief.openingInsights[0]?.statement]
    .filter(Boolean).join(' ').trim();
  const ownerPreparation = toOwnerPreparationProjection(preparationResult);

  return {
    ownerSafe: {
      preparation: ownerPreparation,
      relevantObservations: brief.openingInsights.map((insight) => ({
        meaning: insight.statement,
        confidence: 75, // Synthesized observations are high-confidence
        domains: [],
      })),
      openingSynthesis: opening,
      agendaCategories: [...new Set(agenda.map((item) => item.category))],
      agendaCount: agenda.length,
      blockingItemCount: agenda.filter((item) => item.blocking).length,
      currentSessionState: formation.status,
    },
    privateServiceContext: {
      formationSessionId: snapshot.formation_session_id,
      workingSessionId: '', // Caller provides this
      businessRepresentationId: formation.business_representation_id,
      preparationBriefId: snapshot.preparation_brief_id,
      preparationContractVersion: snapshot.preparation_contract_version,
      reasoningContractVersion: snapshot.reasoning_contract_version,
      hypothesisSnapshotIds: snapshot.hypothesis_snapshot_ids,
      agenda,
    },
  };
}
