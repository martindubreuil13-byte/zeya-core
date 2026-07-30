// GET /api/representation/living
// Fetch owner's current canonical Representation Version for workspace display
// Returns representation content, metadata, and business info

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const ownerId = auth.user.id;

    // Get all businesses for this owner
    const { data: businesses, error: businessError } = await auth.supabase
      .from('businesses')
      .select('id, user_id')
      .eq('user_id', ownerId);

    if (businessError) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch businesses' },
        { status: 500 }
      );
    }

    if (!businesses || businesses.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No business found',
          state: 'no_business',
        },
        { status: 404 }
      );
    }

    // If multiple businesses, return selection required state
    if (businesses.length > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Multiple businesses exist. Please select which one to view.',
          state: 'multiple_businesses',
          businessCount: businesses.length,
        },
        { status: 409 }
      );
    }

    const businessId = businesses[0].id;

    // Get representation for this business
    const { data: representation, error: repError } = await auth.supabase
      .from('business_representations')
      .select('id, business_id, user_id, current_version_id')
      .eq('business_id', businessId)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (repError || !representation) {
      return NextResponse.json(
        {
          success: false,
          error: 'No representation found',
          state: 'no_representation',
        },
        { status: 404 }
      );
    }

    // Get canonical version
    const { data: canonicalVersion, error: versionError } = await auth.supabase
      .from('representation_versions')
      .select('id, version_number, overall_confidence_score, created_at, element_values, is_canonical')
      .eq('business_representation_id', representation.id)
      .eq('is_canonical', true)
      .maybeSingle();

    if (versionError || !canonicalVersion) {
      return NextResponse.json(
        {
          success: false,
          error: 'No canonical version found',
          state: 'no_canonical_version',
        },
        { status: 404 }
      );
    }

    // Return workspace data
    return NextResponse.json(
      {
        success: true,
        data: {
          businessId,
          representationId: representation.id,
          version: {
            id: canonicalVersion.id,
            number: canonicalVersion.version_number,
            confidenceScore: canonicalVersion.overall_confidence_score,
            createdAt: canonicalVersion.created_at,
            isCanonical: canonicalVersion.is_canonical,
            elementValues: canonicalVersion.element_values,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[living-representation] Failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load representation' },
      { status: 500 }
    );
  }
}
