import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import type { FormationCorrectionRequest } from '@/types/formation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sessionId = (await params).sessionId;
    const body = await request.json() as Partial<FormationCorrectionRequest>;
    if (
      !UUID.test(sessionId)
      || typeof body.proposalId !== 'string'
      || !UUID.test(body.proposalId)
      || typeof body.requestKey !== 'string'
      || !UUID.test(body.requestKey)
      || typeof body.correctionStatement !== 'string'
      || body.correctionStatement.trim().length < 1
      || body.correctionStatement.trim().length > 4000
    ) {
      return NextResponse.json({ success: false, error: 'Invalid correction request' }, { status: 400 });
    }

    const sessionResult = await auth.supabase
      .from('representation_formation_sessions')
      .select('id,business_representation_id,status')
      .eq('id', sessionId)
      .eq('owner_id', auth.user.id)
      .maybeSingle();
    if (sessionResult.error || !sessionResult.data) {
      return NextResponse.json({ success: false, error: 'Formation session not found' }, { status: 404 });
    }
    if (sessionResult.data.status !== 'working_conversation_linked') {
      return NextResponse.json({ success: false, error: 'Formation review is not ready' }, { status: 409 });
    }

    const proposalResult = await auth.supabase
      .from('representation_proposals')
      .select('id,business_representation_id,formation_session_id,status')
      .eq('id', body.proposalId)
      .eq('business_representation_id', sessionResult.data.business_representation_id)
      .eq('formation_session_id', sessionId)
      .maybeSingle();
    if (proposalResult.error || !proposalResult.data) {
      return NextResponse.json({ success: false, error: 'Formation summary not found' }, { status: 404 });
    }

    const service = createExperienceServiceClient();
    const result = await service.rpc('zeya_record_formation_owner_correction', {
      p_session_id: sessionId,
      p_proposal_id: body.proposalId,
      p_owner_id: auth.user.id,
      p_request_key: body.requestKey,
      p_raw_statement: body.correctionStatement.trim(),
    });
    if (result.error) {
      const status = result.error.code === 'PZ404' ? 404
        : ['PZ409', '23505'].includes(result.error.code ?? '') ? 409
          : 500;
      console.error('[formation] correction failed', { code: result.error.code ?? 'unknown' });
      return NextResponse.json(
        { success: false, error: status === 409 ? 'Formation summary changed; refresh and review again' : 'Failed to record correction' },
        { status },
      );
    }
    const row = Array.isArray(result.data) ? result.data[0] : null;
    if (!row?.evidence_id) {
      return NextResponse.json({ success: false, error: 'Correction persistence returned no data' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      data: {
        evidenceId: row.evidence_id,
        replayed: Boolean(row.replayed),
        message: 'Correction recorded as non-canonical Evidence.',
      },
    }, { status: row.replayed ? 200 : 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Correction request failed' }, { status: 500 });
  }
}
