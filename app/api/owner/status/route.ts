// GET /api/owner/status
// Check authenticated owner's current state:
// - Active Formation session → return for resumption
// - Canonical Representation exists → return for redirect
// - Neither → return "new_owner" status

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const ownerId = auth.user.id;

    // Check for active Formation session
    const { data: activeFormation, error: formationError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, status, business_representation_id')
      .eq('owner_id', ownerId)
      .in('status', ['initiated', 'getting_familiar', 'working_conversation_pending', 'working_conversation_linked'])
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (formationError && formationError.code !== 'PGRST116') {
      console.error('[owner-status] Formation query failed:', formationError);
    }

    // If active Formation exists, return it for resumption
    if (activeFormation) {
      return NextResponse.json(
        {
          success: true,
          data: {
            status: 'active_formation',
            formationSessionId: activeFormation.id,
            formationStatus: activeFormation.status,
            businessRepresentationId: activeFormation.business_representation_id,
          },
        },
        { status: 200 }
      );
    }

    // Check for canonical Representation
    // Query representation_versions directly for canonical versions
    const { data: canonicalVersions, error: repError } = await auth.supabase
      .from('representation_versions')
      .select('id, version_number, business_representation_id')
      .eq('is_canonical', true)
      .limit(1);

    if (repError && repError.code !== 'PGRST116') {
      console.error('[owner-status] Representation query failed:', repError);
    }

    if (canonicalVersions && canonicalVersions.length > 0) {
      const version = canonicalVersions[0];

      // Get the business representation to verify ownership
      const { data: representation, error: repDetailsError } = await auth.supabase
        .from('business_representations')
        .select('id, business_id')
        .eq('id', version.business_representation_id)
        .maybeSingle();

      if (!repDetailsError && representation) {
        return NextResponse.json(
          {
            success: true,
            data: {
              status: 'has_representation',
              businessRepresentationId: representation.id,
              businessId: representation.business_id,
              versionNumber: version.version_number,
            },
          },
          { status: 200 }
        );
      }
    }

    // No active Formation, no canonical Representation
    return NextResponse.json(
      {
        success: true,
        data: {
          status: 'new_owner',
          message: 'Ready to start Representation Experience',
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[owner-status] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check owner status' },
      { status: 500 }
    );
  }
}
