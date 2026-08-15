import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';
import { loadFreshCurrentPreparationHypotheses, PREPARATION_DOMAINS } from '@/lib/onboarding/preparation-intelligence';
import { buildDirectHireFormationAgenda } from '@/lib/formation/direct-hire-agenda';
import type { FirstWorkingSessionBrief } from '@/lib/onboarding/first-working-session-brief';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function success(formationSessionId: string, isNew: boolean) {
  return NextResponse.json({
    success: true,
    data: {
      formationSessionId,
      isNew,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  if (!UUID.test(ownerId)) return failure('invalid_user_id', 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const workingSessionId = (body as { workingSessionId?: unknown })?.workingSessionId;
  if (typeof workingSessionId !== 'string' || !UUID.test(workingSessionId)) {
    return failure('invalid_working_session_id', 400);
  }

  try {
    const workingSessionResult = await auth.supabase
      .from('direct_hire_working_sessions')
      .select('id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,status,preparation_status,preparation_contract_version,preparation_snapshot_fingerprint')
      .eq('id', workingSessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (workingSessionResult.error) return failure('working_session_lookup_failed', 500);
    if (!workingSessionResult.data) return failure('working_session_not_found', 404);
    const workingSession = workingSessionResult.data;
    const serviceClient = createDirectHireServiceClient();

    const briefResult = await serviceClient
      .from('direct_hire_first_working_session_briefs')
      .select('id,brief,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version,current')
      .eq('direct_hire_working_session_id', workingSession.id)
      .eq('current', true)
      .eq('preparation_contract_version', 'first-working-session-preparation-v4')
      .maybeSingle();
    if (briefResult.error) return failure('preparation_brief_lookup_failed', 500);
    if (!briefResult.data) return failure('current_v4_brief_not_found', 409);

    const hypotheses = await loadFreshCurrentPreparationHypotheses(auth.supabase, {
      ownerId,
      businessId: workingSession.business_id,
      businessRepresentationId: workingSession.business_representation_id,
      onboardingSessionId: workingSession.direct_hire_onboarding_session_id,
    });
    if (hypotheses.length !== PREPARATION_DOMAINS.length) {
      return failure('preparation_intelligence_pending', 409);
    }
    const agenda = buildDirectHireFormationAgenda({
      brief: briefResult.data.brief as FirstWorkingSessionBrief,
      hypotheses,
      snapshotFingerprint: briefResult.data.source_snapshot_fingerprint,
    });

    // Use service-role client for SECURITY DEFINER RPC
    // Authenticated user's owner UUID is server-derived and cannot be overridden by request body
    // Call atomic RPC for idempotent formation initiation
    const rpcResult = await serviceClient.rpc(
      'zeya_initiate_direct_hire_first_working_session_formation',
      {
        p_authenticated_owner_id: ownerId,
        p_working_session_id: workingSession.id,
        p_expected_brief_id: briefResult.data.id,
        p_expected_snapshot_fingerprint: briefResult.data.source_snapshot_fingerprint,
        p_expected_hypothesis_trace_fingerprint: briefResult.data.hypothesis_trace_fingerprint,
        p_agenda: agenda,
      },
    );

    if (rpcResult.error) {
      const errorCode = rpcResult.error.message || 'formation_initiation_failed';
      const status = rpcResult.error.code === '42501' ? 403
        : rpcResult.error.code === 'PZ404' ? 404
          : ['PZ409', '22023', '23505'].includes(rpcResult.error.code ?? '') ? 409 : 500;

      return failure(errorCode, status);
    }

    const result = rpcResult.data;
    if (!result || result.length === 0) {
      return failure('empty_rpc_result', 500);
    }

    const row = result[0];
    const formationSessionId = row?.formation_session_id;
    const isNew = row?.created === true;

    if (!formationSessionId || !UUID.test(formationSessionId)) {
      return failure('invalid_formation_id', 500);
    }

    return success(formationSessionId, isNew);
  } catch (err) {
    console.error('[direct-hire-formation]', err);
    return failure('formation_initiation_error', 500);
  }
}
