import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import {
  buildPrivatePreparationProjection,
  PreparationIntelligenceIncompleteError,
  toOwnerPreparationProjection,
} from '@/lib/onboarding/preparation-intelligence';

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
    const projection = await buildPrivatePreparationProjection(auth.supabase, {
      ownerId,
      businessId: session.business_id,
      businessRepresentationId: session.business_representation_id,
      onboardingSessionId: session.id,
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
