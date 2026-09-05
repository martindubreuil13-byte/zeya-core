import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';
import { loadFreshCurrentPreparationHypotheses, PREPARATION_DOMAINS } from '@/lib/onboarding/preparation-intelligence';
import { buildDirectHireFormationAgenda } from '@/lib/formation/direct-hire-agenda';
import { buildFirstWorkingSessionHypothesisTraceFingerprint } from '@/lib/onboarding/first-working-session-brief';
import type { FirstWorkingSessionBrief } from '@/lib/onboarding/first-working-session-brief';
import { HYPOTHESIS_REASONING_CONTRACT_VERSION } from '@/lib/onboarding/hypothesis-reasoning-service';
import {
  ensureImmutablePreparedContext,
  IMMUTABLE_SNAPSHOT_V6_MODE,
  SnapshotBindingConflictError,
  type PreparedContextIdentity,
} from '@/lib/formation/prepared-context-binding';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREPARATION_CONTRACT_VERSION = 'first-working-session-preparation-v6';

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function success(formationSessionId: string, isNew: boolean) {
  return NextResponse.json({ success: true, data: { formationSessionId, isNew } });
}

type WorkingSession = {
  id: string;
  business_id: string;
  business_representation_id: string;
  direct_hire_onboarding_session_id: string;
  formation_session_id: string | null;
};

type PreparedInputs = {
  brief: {
    id: string;
    brief: FirstWorkingSessionBrief;
    source_snapshot_fingerprint: string;
    hypothesis_trace_fingerprint: string;
    preparation_contract_version: string;
  };
  hypotheses: Awaited<ReturnType<typeof loadFreshCurrentPreparationHypotheses>>;
  agenda: ReturnType<typeof buildDirectHireFormationAgenda>;
  reasoningContractVersion: string;
};

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const ownerId = auth.user.id;
  if (!UUID.test(ownerId)) return failure('invalid_user_id', 400);

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const workingSessionId = (body as { workingSessionId?: unknown })?.workingSessionId;
  if (typeof workingSessionId !== 'string' || !UUID.test(workingSessionId)) {
    return failure('invalid_working_session_id', 400);
  }

  try {
    const workingSessionResult = await auth.supabase
      .from('direct_hire_working_sessions')
      .select('id,business_id,business_representation_id,direct_hire_onboarding_session_id,formation_session_id')
      .eq('id', workingSessionId).eq('owner_id', ownerId).maybeSingle();
    if (workingSessionResult.error) return failure('working_session_lookup_failed', 500);
    if (!workingSessionResult.data) return failure('working_session_not_found', 404);
    const workingSession = workingSessionResult.data as WorkingSession;
    const serviceClient = createDirectHireServiceClient();
    let preparedInputs: PreparedInputs | null = null;

    const resolvePreparedInputs = async (): Promise<PreparedInputs> => {
      if (preparedInputs) return preparedInputs;
      const briefResult = await serviceClient.from('direct_hire_first_working_session_briefs')
        .select('id,brief,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version,current')
        .eq('direct_hire_working_session_id', workingSession.id).eq('current', true)
        .eq('preparation_contract_version', PREPARATION_CONTRACT_VERSION).maybeSingle();
      if (briefResult.error) throw new Error('preparation_brief_lookup_failed');
      if (!briefResult.data) throw new Error('current_v6_brief_not_found');

      const hypotheses = await loadFreshCurrentPreparationHypotheses(auth.supabase, {
        ownerId,
        businessId: workingSession.business_id,
        businessRepresentationId: workingSession.business_representation_id,
        onboardingSessionId: workingSession.direct_hire_onboarding_session_id,
      });
      if (hypotheses.length !== PREPARATION_DOMAINS.length) throw new Error('preparation_intelligence_pending');
      if (buildFirstWorkingSessionHypothesisTraceFingerprint(hypotheses)
          !== briefResult.data.hypothesis_trace_fingerprint) {
        throw new Error('hypothesis_lineage_mismatch');
      }
      const brief = { ...briefResult.data, brief: briefResult.data.brief as FirstWorkingSessionBrief };
      preparedInputs = {
        brief,
        hypotheses,
        agenda: buildDirectHireFormationAgenda({
          brief: brief.brief,
          hypotheses,
          snapshotFingerprint: brief.source_snapshot_fingerprint,
        }),
        reasoningContractVersion: HYPOTHESIS_REASONING_CONTRACT_VERSION,
      };
      return preparedInputs;
    };

    let formationSessionId = workingSession.formation_session_id;
    let isNew = false;
    if (!formationSessionId) {
      const current = await resolvePreparedInputs();
      const rpcResult = await serviceClient.rpc('zeya_initiate_direct_hire_first_working_session_formation', {
        p_authenticated_owner_id: ownerId,
        p_working_session_id: workingSession.id,
        p_expected_brief_id: current.brief.id,
        p_expected_snapshot_fingerprint: current.brief.source_snapshot_fingerprint,
        p_expected_hypothesis_trace_fingerprint: current.brief.hypothesis_trace_fingerprint,
        p_agenda: current.agenda,
      });
      if (rpcResult.error) {
        const message = rpcResult.error.message || 'formation_initiation_failed';
        const status = rpcResult.error.code === '42501' ? 403 : rpcResult.error.code === 'PZ404' ? 404
          : ['PZ409', '22023', '23505'].includes(rpcResult.error.code ?? '') ? 409 : 500;
        return failure(message, status);
      }
      const row = rpcResult.data?.[0];
      formationSessionId = row?.formation_session_id;
      isNew = row?.created === true;
    }
    if (!formationSessionId || !UUID.test(formationSessionId)) return failure('invalid_formation_id', 500);

    // This persisted field is the exclusive snapshot/legacy discriminator.
    const formationResult = await serviceClient.from('representation_formation_sessions')
      .select('id,business_representation_id,prepared_context_mode')
      .eq('id', formationSessionId).eq('owner_id', ownerId).maybeSingle();
    if (formationResult.error) return failure('formation_mode_lookup_failed', 500);
    if (!formationResult.data) return failure('formation_not_found', 404);
    const mode = formationResult.data.prepared_context_mode;
    if (mode === null) return success(formationSessionId, isNew);
    if (mode !== IMMUTABLE_SNAPSHOT_V6_MODE) return failure('unsupported_prepared_context_mode', 409);

    const current = await resolvePreparedInputs();
    const expected: PreparedContextIdentity = {
      formationSessionId,
      businessRepresentationId: formationResult.data.business_representation_id,
      preparationBriefId: current.brief.id,
      hypothesisSnapshotIds: current.hypotheses.map((hypothesis) => hypothesis.id),
      preparationContractVersion: current.brief.preparation_contract_version,
      reasoningContractVersion: current.reasoningContractVersion,
    };
    const loadSnapshot = async (): Promise<PreparedContextIdentity | null> => {
      const result = await serviceClient.from('direct_hire_formation_prepared_context')
        .select('formation_session_id,business_representation_id,preparation_brief_id,hypothesis_snapshot_ids,preparation_contract_version,reasoning_contract_version')
        .eq('formation_session_id', formationSessionId).maybeSingle();
      if (result.error) throw new Error('formation_snapshot_lookup_failed');
      if (!result.data) return null;
      return {
        formationSessionId: result.data.formation_session_id,
        businessRepresentationId: result.data.business_representation_id,
        preparationBriefId: result.data.preparation_brief_id,
        hypothesisSnapshotIds: result.data.hypothesis_snapshot_ids,
        preparationContractVersion: result.data.preparation_contract_version,
        reasoningContractVersion: result.data.reasoning_contract_version,
      };
    };

    await ensureImmutablePreparedContext({
      expected,
      load: loadSnapshot,
      create: async () => {
        const result = await serviceClient.rpc('zeya_create_formation_prepared_context_snapshot', {
          p_formation_session_id: formationSessionId,
          p_working_session_id: workingSession.id,
          p_business_representation_id: expected.businessRepresentationId,
          p_preparation_brief_id: expected.preparationBriefId,
          p_hypothesis_snapshot_ids: expected.hypothesisSnapshotIds,
          p_preparation_contract_version: expected.preparationContractVersion,
          p_reasoning_contract_version: expected.reasoningContractVersion,
        });
        if (!result.error) {
          if (!result.data?.length) throw new Error('snapshot_empty_result');
          return 'created';
        }
        if (result.error.message === 'formation_prepared_context_already_bound') return 'already_bound';
        const error = new Error(result.error.message || 'snapshot_creation_failed');
        Object.assign(error, { code: result.error.code });
        throw error;
      },
    });
    return success(formationSessionId, isNew);
  } catch (error) {
    if (error instanceof SnapshotBindingConflictError) return failure('snapshot_binding_conflict', 409);
    const message = error instanceof Error ? error.message : 'formation_initiation_error';
    console.error('[direct-hire-formation]', error);
    if (message === 'current_v6_brief_not_found') return failure('current_v6_brief_not_found', 409);
    if (message === 'preparation_intelligence_pending') return failure('preparation_intelligence_pending', 409);
    if (message === 'hypothesis_lineage_mismatch') return failure('hypothesis_lineage_mismatch', 409);
    return failure(message, 500);
  }
}
