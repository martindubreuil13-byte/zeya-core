import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext, isUuid } from '@/lib/representation/api-auth';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';
import { getTextConversationState, pauseTextConversation, startOrResumeTextConversation, submitTextConversationAnswer } from '@/lib/formation/direct-hire-text-conversation-service';

const failure = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const sessionId = (await params).sessionId;
  if (!isUuid(sessionId)) return failure('invalid_session_id', 400);
  try { return NextResponse.json({ success: true, data: await getTextConversationState(createDirectHireServiceClient(), sessionId, auth.user.id) }); }
  catch { return failure('conversation_state_failed', 500); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const sessionId = (await params).sessionId;
  if (!isUuid(sessionId)) return failure('invalid_session_id', 400);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return failure('invalid_request', 400); }
  const action = body.action;
  try {
    const client = createDirectHireServiceClient();
    if (action === 'start' || action === 'resume') return NextResponse.json({ success: true, data: await startOrResumeTextConversation(client, sessionId, auth.user.id) });
    if (action === 'pause') return NextResponse.json({ success: true, data: await pauseTextConversation(client, sessionId, auth.user.id) });
    if (action === 'answer' && typeof body.answer === 'string' && isUuid(String(body.idempotencyKey))) {
      return NextResponse.json({ success: true, data: await submitTextConversationAnswer(client, { formationSessionId: sessionId, ownerId: auth.user.id, idempotencyKey: String(body.idempotencyKey), answer: body.answer }) });
    }
    return failure('invalid_request', 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('not_active') || message.includes('not_found')) return failure(message, 409);
    if (message === 'unsafe_conversation_text') return failure(message, 400);
    return failure('conversation_operation_failed', 500);
  }
}
