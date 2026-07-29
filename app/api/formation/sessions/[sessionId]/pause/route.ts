// POST /api/formation/sessions/[sessionId]/pause
// "I need more time" - owner requests pause
// Creates NO state change, NO canonical changes
// Returns current Formation state for safe resume

import { NextRequest, NextResponse } from 'next/server';
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

    // Verify Formation Session ownership and fetch current state
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, status, created_at, updated_at')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // No state change - just return resumable status
    return NextResponse.json(
      {
        success: true,
        data: {
          status: formationSession.status,
          message: 'Your Formation session is saved. Come back whenever you\'re ready.',
          createdAt: formationSession.created_at,
          updatedAt: formationSession.updated_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/pause failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
