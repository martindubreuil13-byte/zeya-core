// POST /api/formation/sessions/[sessionId]/advance
// State transitions with validation
// Allowed: initiated→getting_familiar, getting_familiar→working_conversation_pending, working_conversation_pending→working_conversation_linked

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const ownerId = auth.user.id;
    const body = await request.json();
    const { nextStatus } = body;

    if (!nextStatus) {
      return NextResponse.json(
        { success: false, error: 'Missing nextStatus' },
        { status: 400 }
      );
    }

    // Verify Formation Session ownership
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    const currentStatus = formationSession.status;

    // Validate state transitions
    const validTransitions: Record<string, string[]> = {
      initiated: ['getting_familiar'],
      getting_familiar: ['working_conversation_pending'],
      working_conversation_pending: ['working_conversation_linked'],
      working_conversation_linked: [],
    };

    if (!validTransitions[currentStatus]?.includes(nextStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid transition from ${currentStatus} to ${nextStatus}`,
        },
        { status: 409 }
      );
    }

    // Call zeya_advance_formation_status RPC
    const supabaseServiceRole = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    const { data, error: rpcError } = await supabaseServiceRole.rpc('zeya_advance_formation_status', {
      p_session_id: sessionId,
      p_expected_current_status: currentStatus,
      p_new_status: nextStatus,
    });

    if (rpcError) {
      console.error('[formation] zeya_advance_formation_status failed:', rpcError);
      return NextResponse.json(
        { success: false, error: `State transition failed: ${rpcError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/advance failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
