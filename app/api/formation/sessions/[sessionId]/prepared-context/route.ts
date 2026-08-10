import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import {
  buildPrivatePreparationProjection,
  PreparationIntelligenceIncompleteError,
  toOwnerPreparationProjection,
} from '@/lib/onboarding/preparation-intelligence';

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
    const sessionResult = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, initiated_from, initiated_from_id, business_id, business_representation_id, owner_id')
      .eq('id', sessionId)
      .eq('owner_id', auth.user.id)
      .maybeSingle();
    if (sessionResult.error) return failure('session_lookup_failed', 500);
    if (!sessionResult.data) return failure('session_not_found', 404);

    const session = sessionResult.data as {
      initiated_from: string;
      initiated_from_id: string | null;
      business_id: string;
      business_representation_id: string;
      owner_id: string;
    };
    if (session.initiated_from !== 'direct_hire_onboarding' || !session.initiated_from_id) {
      return NextResponse.json({ success: true, data: null });
    }

    const scope = {
      ownerId: auth.user.id,
      businessId: session.business_id,
      businessRepresentationId: session.business_representation_id,
      onboardingSessionId: session.initiated_from_id,
    };
    const projection = await buildPrivatePreparationProjection(auth.supabase, scope);

    const scopedEvidenceIds = [...new Set(Object.values(projection.privateSourceEvidenceIds).flat())];
    let observations: Array<{ meaning: string; confidence: number; domains: string[] }> = [];
    if (scopedEvidenceIds.length > 0) {
      const observationResult = await auth.supabase
        .from('observations')
        .select('evidence_id, interpreted_meaning, confidence_in_interpretation, affected_domains')
        .eq('business_representation_id', scope.businessRepresentationId)
        .in('evidence_id', scopedEvidenceIds)
        .order('created_at', { ascending: true });
      if (observationResult.error) return failure('observation_lookup_failed', 500);
      observations = (observationResult.data ?? []).map((observation) => ({
        meaning: observation.interpreted_meaning,
        confidence: observation.confidence_in_interpretation,
        domains: observation.affected_domains ?? [],
      }));
    }

    return NextResponse.json({
      success: true,
      data: {
        preparation: toOwnerPreparationProjection(projection),
        relevantObservations: observations,
      },
    });
  } catch (err) {
    if (err instanceof PreparationIntelligenceIncompleteError) {
      return failure('preparation_intelligence_pending', 409);
    }
    console.error('[prepared-context]', err);
    return failure('prepared_context_error', 500);
  }
}
