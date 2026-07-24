// POST /api/formation/sessions/[sessionId]/complete
// Mark Formation session as complete

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedRepresentationContext,
} from '@/lib/representation/api-auth';
import type { CompleteFormationResponse } from '@/types/formation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Missing session ID' },
        { status: 400 }
      );
    }

    // Verify session exists and belongs to owner
    const { data: session, error: sessionError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check formation session' },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // Idempotent: if already complete, return success
    if (session.status === 'formation_complete') {
      const response: CompleteFormationResponse = {
        sessionId: session.id,
        status: 'formation_complete',
        completedAt: new Date().toISOString(),
      };
      return NextResponse.json({ success: true, data: response }, { status: 200 });
    }

    // Only allow completion from working_conversation_linked state
    if (session.status !== 'working_conversation_linked') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot complete formation from ${session.status} state; must be working_conversation_linked`
        },
        { status: 409 }
      );
    }

    // Mark complete via service role function
    const { data: result, error: completeError } = await auth.supabase.rpc('zeya_advance_formation_status', {
      p_session_id: sessionId,
      p_business_representation_id: session.business_representation_id,
      p_expected_current_status: 'working_conversation_linked',
      p_new_status: 'formation_complete',
      p_transition_details: { completedAt: new Date().toISOString() },
    });

    if (completeError) {
      console.error('[formation] mark complete failed:', completeError);
      if (completeError.code === '23505') {
        return NextResponse.json(
          { success: false, error: completeError.message || 'Cannot complete formation in current state' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Failed to complete formation' },
        { status: 500 }
      );
    }

    if (!result || result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Formation completion returned no data' },
        { status: 500 }
      );
    }

    const response: CompleteFormationResponse = {
      sessionId: result[0].session_id,
      status: result[0].status,
      completedAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: response }, { status: 200 });
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/complete failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
