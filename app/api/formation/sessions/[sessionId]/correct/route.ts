// POST /api/formation/sessions/[sessionId]/correct
// Owner submits correction to Formation review
// Creates new Evidence from correction statement
// Next POST /summary will automatically generate fresh Proposal with updated Evidence
// Old draft Proposal naturally abandoned (stale fingerprint)

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
    const { correctionStatement } = body;

    if (!correctionStatement || typeof correctionStatement !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid correctionStatement' },
        { status: 400 }
      );
    }

    // Verify Formation Session ownership
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, status')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // Create Evidence directly from correction statement via service role
    const supabaseServiceRole = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    // Create Evidence from correction statement
    const { data: newEvidence, error: evidenceError } = await supabaseServiceRole
      .from('evidence')
      .insert({
        business_representation_id: formationSession.business_representation_id,
        statement_content: correctionStatement,
        source: 'formation_owner_correction',
        confidence: 0.9,
      })
      .select('id')
      .single();

    if (evidenceError || !newEvidence) {
      return NextResponse.json(
        { success: false, error: 'Failed to record correction as evidence' },
        { status: 500 }
      );
    }

    // Prior draft Proposal naturally abandoned: next POST /summary will detect stale fingerprint
    // and generate fresh Proposal with updated Evidence. No Proposal mutation needed.

    return NextResponse.json(
      {
        success: true,
        data: {
          evidenceId: newEvidence.id,
          message: 'Correction recorded. Summary will be regenerated with updated evidence.',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/correct failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
