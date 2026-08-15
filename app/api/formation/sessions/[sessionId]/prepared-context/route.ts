import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { loadDirectHireFormationPreparedContext } from '@/lib/formation/direct-hire-prepared-context';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const sessionId = (await params).sessionId;
  if (!sessionId || !UUID.test(sessionId)) return failure('invalid_session_id', 400);

  try {
    const context = await loadDirectHireFormationPreparedContext({
      client: createDirectHireServiceClient(),
      formationSessionId: sessionId,
      ownerId: auth.user.id,
    });
    if (!context) return NextResponse.json({ success: true, data: null });
    return NextResponse.json({ success: true, data: context.ownerSafe });
  } catch (err) {
    console.error('[prepared-context]', err);
    return failure('prepared_context_error', 500);
  }
}
