// POST /api/formation/sessions/initiate
// Idempotent Formation session initiation

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createFormationService, isFormationError } from '@/lib/formation/formation-service';
import {
  createAuthenticatedRepresentationContext,
  assertVisibleBusiness,
} from '@/lib/representation/api-auth';
import type { InitiateFormationRequest, InitiateFormationResponse } from '@/types/formation';

export async function POST(request: NextRequest): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const body: InitiateFormationRequest = await request.json();

    if (!body.businessId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: businessId' },
        { status: 400 }
      );
    }

    // Verify owner owns the business
    await assertVisibleBusiness(auth.supabase, body.businessId, auth.user.id);

    // Get or create representation for this business
    const { data: representation, error: repError } = await auth.supabase
      .from('business_representations')
      .select('id')
      .eq('business_id', body.businessId)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (repError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check representation' },
        { status: 500 }
      );
    }

    if (!representation) {
      return NextResponse.json(
        { success: false, error: 'Representation not found for business' },
        { status: 404 }
      );
    }

    // Use service role to initiate formation (idempotent)
    const supabaseServiceRole = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    const { data: session, error: sessionError } = await supabaseServiceRole.rpc('zeya_initiate_formation_session', {
      p_business_id: body.businessId,
      p_business_representation_id: representation.id,
      p_owner_id: auth.user.id,
      p_initiated_from: body.initiatedFrom || null,
      p_initiated_from_id: body.initiatedFromId || null,
    });

    if (sessionError) {
      console.error('[formation] initiate failed - RPC error:');
      console.error('  Code:', sessionError.code);
      console.error('  Message:', sessionError.message);
      console.error('  Details:', sessionError.details);
      console.error('  Hint:', sessionError.hint);
      console.error('  Full error:', JSON.stringify(sessionError, null, 2));
      return NextResponse.json(
        { success: false, error: 'Failed to initiate formation session' },
        { status: 500 }
      );
    }

    if (!session || session.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Formation session initiation returned no data' },
        { status: 500 }
      );
    }

    const response: InitiateFormationResponse = {
      sessionId: session[0].session_id,
      businessRepresentationId: session[0].business_representation_id,
      status: session[0].status,
      initiatedAt: session[0].initiated_at,
    };

    return NextResponse.json({ success: true, data: response }, { status: 201 });
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/initiate failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
