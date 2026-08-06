import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

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

  const partialAcknowledged = (body as any)?.partialAcknowledged === true;

  try {
    // Call atomic RPC for idempotent formation initiation
    const rpcResult = await auth.supabase.rpc(
      'zeya_initiate_direct_hire_formation',
      {
        p_authenticated_user_id: ownerId,
        p_partial_acknowledged: partialAcknowledged,
      },
    );

    if (rpcResult.error) {
      const errorCode = rpcResult.error.message || 'formation_initiation_failed';
      const status = errorCode === 'user_not_authenticated' ? 401
        : errorCode === 'no_direct_hire_session' ? 404
        : errorCode === 'preparation_not_ready' ? 409
        : errorCode === 'active_formation_exists' ? 409
        : errorCode === 'canonical_version_exists' ? 409
        : errorCode === 'no_website_evidence' ? 409
        : errorCode === 'partial_not_acknowledged' ? 409
        : errorCode === 'preparation_in_progress' ? 409
        : 500;

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
