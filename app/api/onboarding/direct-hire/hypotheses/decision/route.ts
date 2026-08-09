import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext, isUuid } from '@/lib/representation/api-auth';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';
import {
  applyOwnerHypothesisDecision,
  OwnerHypothesisDecisionError,
  type OwnerHypothesisDecision,
} from '@/lib/onboarding/owner-hypothesis-decision';

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return failure('invalid_request', 400);
  }
  const hypothesisId = typeof body.hypothesisId === 'string' ? body.hypothesisId : '';
  const operationId = typeof body.operationId === 'string' ? body.operationId : '';
  const decision = body.decision;
  const correctionText = body.correctionText;
  if (!isUuid(hypothesisId) || !isUuid(operationId)
    || !['approved', 'deferred', 'rejected'].includes(String(decision))
    || (correctionText !== undefined && typeof correctionText !== 'string')) {
    return failure('invalid_request', 400);
  }

  try {
    const result = await applyOwnerHypothesisDecision(createDirectHireServiceClient(), {
      authenticatedOwnerId: auth.user.id,
      hypothesisId,
      operationId,
      decision: decision as OwnerHypothesisDecision,
      ...(typeof correctionText === 'string' ? { correctionText } : {}),
    });
    return NextResponse.json({ success: true, data: result }, {
      status: result.operationState === 'reasoning_pending' ? 202 : 200,
    });
  } catch (error) {
    if (error instanceof OwnerHypothesisDecisionError) {
      if (error.code === 'invalid_request') return failure(error.code, 400);
      if (error.code === 'not_found') return failure(error.code, 404);
      if (error.code === 'operation_conflict' || error.code === 'stale_hypothesis') {
        return failure(error.code, 409);
      }
    }
    return failure('owner_action_failed', 500);
  }
}
