// POST /api/formation/sessions/[sessionId]/link-conversation
// Link first working conversation to Formation session

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedRepresentationContext,
} from '@/lib/representation/api-auth';
import type { LinkConversationRequest, LinkConversationResponse } from '@/types/formation';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const body: LinkConversationRequest = await request.json();

    if (!UUID.test(sessionId) || !UUID.test(body.conversationId)) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: sessionId, conversationId' },
        { status: 400 }
      );
    }

    // Verify session exists and belongs to owner
    const { data: session, error: sessionError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, owner_id, status, first_working_conversation_id')
      .eq('id', sessionId)
      .eq('owner_id', auth.user.id)
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

    if (!['working_conversation_pending', 'working_conversation_linked'].includes(session.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot link conversation when session is in ${session.status} state`
        },
        { status: 409 }
      );
    }

    // Link conversation via service role function
    const supabaseServiceRole = createExperienceServiceClient();

    const { data: result, error: linkError } = await supabaseServiceRole.rpc('zeya_link_formation_conversation', {
      p_session_id: sessionId,
      p_business_representation_id: session.business_representation_id,
      p_conversation_id: body.conversationId,
      p_conversation_type: body.conversationType || 'voice_conversation_output',
    });

    if (linkError) {
      console.error('[formation] link conversation failed', { code: linkError.code ?? 'unknown' });
      const errorCode = linkError.code || '';
      if (['23505', '23503', '22023', 'PZ409'].includes(errorCode)) {
        return NextResponse.json(
          { success: false, error: linkError.message || 'Cannot link conversation in current state' },
          { status: 409 }
        );
      }
      if (errorCode === 'PZ404') {
        return NextResponse.json(
          { success: false, error: linkError.message || 'Formation session not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Failed to link conversation' },
        { status: 500 }
      );
    }

    if (!result || result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Conversation linkage returned no data' },
        { status: 500 }
      );
    }

    const response: LinkConversationResponse = {
      sessionId: result[0].session_id,
      status: result[0].status,
      linkedAt: result[0].linked_at,
    };

    return NextResponse.json({ success: true, data: response }, { status: 200 });
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/link-conversation failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
