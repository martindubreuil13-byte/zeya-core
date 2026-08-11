import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import {
  buildPrivatePreparationProjection,
  ensurePreparationIntelligence,
  PreparationIntelligenceIncompleteError,
  toOwnerPreparationProjection,
} from '@/lib/onboarding/preparation-intelligence';
import { createDirectHireServiceClient } from '@/lib/onboarding/direct-hire-service-client';

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;

  try {
    // Load Direct Hire onboarding session
    const sessionResult = await auth.supabase
      .from('direct_hire_onboarding_sessions')
      .select(
        `id,
        onboarding_state,
        preparation_status,
        business_id,
        business_representation_id`,
      )
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessionResult.error) return failure('session_lookup_failed', 500);
    if (!sessionResult.data) return failure('no_session', 404);

    const session = sessionResult.data as {
      id: string;
      onboarding_state: string;
      preparation_status: string;
      business_id: string;
      business_representation_id: string;
    };
    const scope = {
      ownerId,
      businessId: session.business_id,
      businessRepresentationId: session.business_representation_id,
      onboardingSessionId: session.id,
    };
    try {
      // Re-entry must be able to resume a stale snapshot (including a reasoning
      // contract upgrade) through the one existing freshness-aware path.
      await ensurePreparationIntelligence(createDirectHireServiceClient(), scope);
    } catch (error) {
      console.error('[preparation-summary] preparation_intelligence_refresh_failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'unknown_failure',
      });
      throw new PreparationIntelligenceIncompleteError('Preparation intelligence refresh failed');
    }
    const projection = await buildPrivatePreparationProjection(auth.supabase, {
      ...scope,
    });

    return NextResponse.json({
      success: true,
      data: {
        onboardingSessionId: session.id,
        onboardingState: session.onboarding_state,
        preparationStatus: session.preparation_status,
        summary: toOwnerPreparationProjection(projection),
      },
    });
  } catch (err) {
    if (err instanceof PreparationIntelligenceIncompleteError) {
      return failure('preparation_intelligence_pending', 409);
    }
    console.error('[preparation-summary]', err);
    return failure('preparation_summary_error', 500);
  }
}
