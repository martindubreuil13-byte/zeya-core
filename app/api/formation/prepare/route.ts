// POST /api/formation/prepare
// Authenticate owner, verify public experience session, reuse provisioned Business/Representation
// Initiate Formation Session using existing identities
// No new Business or Representation creation

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import type { FormationInitiationSource } from '@/types/formation';

interface PrepareRequest {
  publicExperienceSessionId: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: AUTHENTICATE OWNER (FROM BEARER TOKEN)
    // ─────────────────────────────────────────────────────────────────────────────
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const ownerId = auth.user.id;
    const body: PrepareRequest = await request.json();

    if (!body.publicExperienceSessionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: publicExperienceSessionId' },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: LOAD AND VALIDATE PUBLIC EXPERIENCE SESSION
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: publicExpSession, error: sessError } = await auth.supabase
      .from('public_experience_sessions')
      .select(
        'id, state, business_id, business_representation_id, expires_at, tenant_user_id'
      )
      .eq('id', body.publicExperienceSessionId)
      .maybeSingle();

    if (sessError || !publicExpSession) {
      return NextResponse.json(
        { success: false, error: 'Public experience session not found' },
        { status: 404 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: VERIFY SESSION EXPIRY
    // ─────────────────────────────────────────────────────────────────────────────
    if (publicExpSession.expires_at && new Date(publicExpSession.expires_at) <= new Date()) {
      return NextResponse.json(
        { success: false, error: 'Public experience session expired' },
        { status: 410 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: VERIFY SESSION STATE (MUST BE reflection_ready)
    // ─────────────────────────────────────────────────────────────────────────────
    if (publicExpSession.state !== 'reflection_ready') {
      return NextResponse.json(
        {
          success: false,
          error: `Public experience not ready for Formation. Current state: ${publicExpSession.state}. Required: reflection_ready`,
        },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: VERIFY CONFIRMED BRIEF RESPONSE EXISTS
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: briefData, error: briefError } = await auth.supabase
      .from('public_experience_representation_briefs')
      .select('id, status')
      .eq('public_experience_session_id', body.publicExperienceSessionId)
      .eq('status', 'confirmed')
      .maybeSingle();

    if (briefError && briefError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: 'Failed to check brief status' },
        { status: 500 }
      );
    }

    if (!briefData) {
      return NextResponse.json(
        {
          success: false,
          error: 'Representation brief has not been reviewed and confirmed',
        },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 6: VERIFY AUTHENTICATED OWNER MATCHES SESSION OWNER
    // ─────────────────────────────────────────────────────────────────────────────
    if (publicExpSession.tenant_user_id !== ownerId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Public experience session belongs to different owner',
        },
        { status: 403 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 7: REUSE EXISTING PROVISIONED BUSINESS AND REPRESENTATION IDS
    // Session already has business_id and business_representation_id populated
    // ─────────────────────────────────────────────────────────────────────────────
    const businessId = publicExpSession.business_id;
    const businessRepresentationId = publicExpSession.business_representation_id;

    if (!businessId || !businessRepresentationId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Public experience session missing provisioned business or representation',
        },
        { status: 500 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 8: INITIATE FORMATION SESSION (IDEMPOTENT VIA RPC)
    // Use initiated_from_id as the lineage anchor (public_experience_session.id)
    // ─────────────────────────────────────────────────────────────────────────────
    const supabaseServiceRole = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    const initiatedFrom: FormationInitiationSource = 'public_experience_session';

    const { data: formationSession, error: formationError } = await supabaseServiceRole.rpc(
      'zeya_initiate_formation_session',
      {
        p_business_id: businessId,
        p_business_representation_id: businessRepresentationId,
        p_owner_id: ownerId,
        p_initiated_from: initiatedFrom,
        p_initiated_from_id: body.publicExperienceSessionId,
      }
    );

    if (formationError) {
      console.error('[formation] initiate failed:', formationError);
      if (formationError.code === 'PZ409') {
        return NextResponse.json(
          {
            success: false,
            error: 'Formation lineage conflict. A Formation with different lineage exists for this representation.',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Failed to initiate formation session' },
        { status: 500 }
      );
    }

    if (!formationSession || formationSession.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Formation session initiation returned no data' },
        { status: 500 }
      );
    }

    const formation = formationSession[0];
    const sessionId = formation.session_id;
    const status = formation.status;

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 9: VERIFY RETURNED FORMATION LINEAGE MATCHES
    // Application-level validation of RPC idempotency
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: verifyFormation, error: verifyError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('business_id, business_representation_id, owner_id, initiated_from, initiated_from_id')
      .eq('id', sessionId)
      .maybeSingle();

    if (verifyError || !verifyFormation) {
      return NextResponse.json(
        { success: false, error: 'Failed to verify formation session' },
        { status: 500 }
      );
    }

    // Verify lineage match
    if (
      verifyFormation.business_id !== businessId ||
      verifyFormation.business_representation_id !== businessRepresentationId ||
      verifyFormation.owner_id !== ownerId ||
      verifyFormation.initiated_from !== 'public_experience_session' ||
      verifyFormation.initiated_from_id !== body.publicExperienceSessionId
    ) {
      console.error('[formation] lineage mismatch on returned Formation', {
        sessionId,
        expected: {
          business_id: businessId,
          business_representation_id: businessRepresentationId,
          owner_id: ownerId,
          initiated_from: 'public_experience_session',
          initiated_from_id: body.publicExperienceSessionId,
        },
        actual: verifyFormation,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Formation lineage verification failed. Internal consistency error.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          sessionId,
          businessId,
          businessRepresentationId,
          status,
          message: 'Formation prepared. Ready for first working conversation.',
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[formation] POST /api/formation/prepare failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
