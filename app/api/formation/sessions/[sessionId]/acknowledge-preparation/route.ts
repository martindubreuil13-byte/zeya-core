// POST /api/formation/sessions/[sessionId]/acknowledge-preparation
// Owner-authorized acknowledgement of Prepared Opening
// Authoritative: inserts formation_events record + sets cache + advances status if needed
// Idempotent: replay returns existing event without duplicate insert

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const ownerId = auth.user.id;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Missing session ID' },
        { status: 400 }
      );
    }

    // Verify Formation Session ownership
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, status, preparation_opening_acknowledged')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // Call authoritative RPC: zeya_acknowledge_prepared_opening
    // This handles:
    // 1. Insert formation_events record (idempotent via unique constraint)
    // 2. Set preparation_opening_acknowledged = true (cache)
    // 3. Advance status if in 'initiated' state
    // 4. All in one transaction
    const supabaseServiceRole = createExperienceServiceClient();

    const { data, error: rpcError } = await supabaseServiceRole.rpc('zeya_acknowledge_prepared_opening', {
      p_session_id: sessionId,
      p_business_representation_id: formationSession.business_representation_id,
      p_owner_id: ownerId,
    });

    if (rpcError) {
      console.error('[formation] zeya_acknowledge_prepared_opening failed:', rpcError);
      return NextResponse.json(
        { success: false, error: 'Failed to acknowledge preparation' },
        { status: 500 }
      );
    }

    if (!data || !data[0]) {
      return NextResponse.json(
        { success: false, error: 'Acknowledgement returned no result' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          status: data[0].status,
          preparationOpeningAcknowledged: data[0].preparation_opening_acknowledged,
          acknowledgedAt: data[0].acknowledged_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/acknowledge-preparation failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
