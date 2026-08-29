// GET /api/formation/sessions/[sessionId]
// Retrieve Formation session status and safe context

import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthenticatedRepresentationContext,
} from '@/lib/representation/api-auth';
import type { FormationSessionStatusResponse } from '@/types/formation';
import { projectFormationSummary } from '@/lib/formation/summary-contract';

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

    if (session.status === 'working_conversation_linked' && !session.first_working_conversation_id) {
      return NextResponse.json(
        { success: false, error: 'Formation conversation lineage is incomplete' },
        { status: 409 },
      );
    }

    let summary: FormationSessionStatusResponse['summary'] = null;
    if (session.status === 'working_conversation_linked') {
      const [proposalResult, evidenceResult, observationsResult] = await Promise.all([
        auth.supabase.from('representation_proposals')
          .select('id,formation_session_id,proposed_changes,status,created_at')
          .eq('formation_session_id', session.id)
          .eq('status', 'draft')
          .maybeSingle(),
        auth.supabase.from('evidence')
          .select('id,statement_hash')
          .eq('business_representation_id', session.business_representation_id),
        auth.supabase.from('observations')
          .select('id,interpreted_meaning')
          .eq('business_representation_id', session.business_representation_id),
      ]);
      if (proposalResult.error || evidenceResult.error || observationsResult.error) {
        return NextResponse.json(
          { success: false, error: 'Failed to retrieve formation review' },
          { status: 500 },
        );
      }
      if (proposalResult.data) {
        summary = projectFormationSummary({
          formationSessionId: session.id,
          proposal: proposalResult.data,
          evidence: evidenceResult.data ?? [],
          observations: observationsResult.data ?? [],
        });
      }
    }

    // Build safe owner-facing response
    const response: FormationSessionStatusResponse = {
      sessionId: session.id,
      businessRepresentationId: session.business_representation_id,
      status: session.status,
      initiatedAt: session.formation_started_at,
      firstWorkingConversationId: session.first_working_conversation_id,
      summary,
      preparationOpeningAcknowledged: session.preparation_opening_acknowledged,
      linkedContextSummary: {
        fromPublicExperience: session.initiated_from === 'public_experience_session',
        fromRepresentationBrief: session.initiated_from === 'representation_brief',
        fromDirectHireOnboarding: session.initiated_from === 'direct_hire_onboarding',
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
