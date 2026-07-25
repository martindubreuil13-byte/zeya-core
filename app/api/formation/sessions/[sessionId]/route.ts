// GET /api/formation/sessions/[sessionId]
// Retrieve Formation session status and safe context

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedRepresentationContext,
} from '@/lib/representation/api-auth';
import type { FormationSessionStatusResponse } from '@/types/formation';

export async function GET(
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

    // Fetch session with RLS (owner_id = auth.uid())
    const { data: session, error } = await auth.supabase
      .from('representation_formation_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      console.error('[formation] session retrieval failed:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve formation session' },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // Build safe owner-facing response
    const response: FormationSessionStatusResponse = {
      sessionId: session.id,
      businessRepresentationId: session.business_representation_id,
      status: session.status,
      initiatedAt: session.formation_started_at,
      linkedContextSummary: {
        fromPublicExperience: !!session.public_experience_session_id,
        fromRepresentationBrief: !!session.representation_brief_id,
        workingConversationLinked: !!session.first_working_conversation_id,
      },
      nextAction: getNextAction(session.status),
    };

    return NextResponse.json({ success: true, data: response }, { status: 200 });
  } catch (error) {
    console.error('[formation] GET /api/formation/sessions/[sessionId] failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}

function getNextAction(status: string): string {
  switch (status) {
    case 'initiated':
      return 'Begin preparing to understand your business';
    case 'getting_familiar':
      return 'Schedule your first working conversation';
    case 'working_conversation_pending':
      return 'Waiting to link your first working conversation';
    case 'working_conversation_linked':
      return 'Formation preparation is complete';
    default:
      return 'Unknown state';
  }
}
