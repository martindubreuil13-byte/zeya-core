// POST /api/representation/versions
// Create canonical representation version after approval

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRepresentationStateService } from '@/lib/representation/representation-service';
import {
  assertVisibleBusinessRepresentation,
  assertVisibleProposalForRepresentation,
  createAuthenticatedRepresentationContext,
  logRepresentationRouteError,
  sanitizeRepresentationError,
} from '@/lib/representation/api-auth';

interface CreateVersionRequest {
  businessRepresentationId: string;
  proposalId: string;
  elementValues: Record<string, any>;
  confidenceScore: number;
}

interface CreateVersionResponse {
  success: boolean;
  data?: {
    versionId: string;
    versionNumber: number;
    approvalId: string | null;
    confidenceAssessmentId: string;
    overallConfidenceScore: number;
  };
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<CreateVersionResponse>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    // Parse request body
    const body: CreateVersionRequest = await request.json();

    if (!body.businessRepresentationId || !body.proposalId || !body.elementValues) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: businessRepresentationId, proposalId, elementValues' },
        { status: 400 }
      );
    }

    if (body.confidenceScore < 0 || body.confidenceScore > 100) {
      return NextResponse.json({ success: false, error: 'confidenceScore must be between 0 and 100' }, { status: 400 });
    }

    await assertVisibleBusinessRepresentation(auth.supabase, body.businessRepresentationId);
    await assertVisibleProposalForRepresentation(auth.supabase, body.proposalId, body.businessRepresentationId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Canonical Version authority is unavailable');
    }
    const canonicalVersionDb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const service = createRepresentationStateService(auth.supabase, canonicalVersionDb);

    // Approve and create canonical version
    const result = await service.approveAndCreateCanonicalVersion(
      body.businessRepresentationId,
      body.proposalId,
      body.elementValues,
      body.confidenceScore
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          versionId: result.version.id,
          versionNumber: result.version.versionNumber,
          approvalId: result.approval?.id ?? null,
          confidenceAssessmentId: result.confidence.id,
          overallConfidenceScore: result.version.overallConfidenceScore,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logRepresentationRouteError('POST /api/representation/versions', error);
    return sanitizeRepresentationError(error);
  }
}

// GET /api/representation/versions
// Retrieve current canonical version for a representation

interface GetVersionsResponse {
  success: boolean;
  data?: {
    currentVersion: any | null;
    confidenceAssessment: any | null;
    lineage: any[];
  };
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<GetVersionsResponse>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const businessRepresentationId = searchParams.get('businessRepresentationId');

    if (!businessRepresentationId) {
      return NextResponse.json({ success: false, error: 'Missing required query parameter: businessRepresentationId' }, { status: 400 });
    }

    await assertVisibleBusinessRepresentation(auth.supabase, businessRepresentationId);

    const service = createRepresentationStateService(auth.supabase);

    // Get representation state
    const state = await service.getRepresentationState(businessRepresentationId);

    // Get version lineage if current version exists
    let lineage: any[] = [];
    if (state.currentVersion) {
      // Simplified lineage - just return current version and previous if exists
      if (state.currentVersion.previousVersionId) {
        const prevVersion = await auth.supabase
          .from('representation_versions')
          .select()
          .eq('id', state.currentVersion.previousVersionId)
          .single();
        if (prevVersion.data) {
          lineage = [prevVersion.data, state.currentVersion];
        } else {
          lineage = [state.currentVersion];
        }
      } else {
        lineage = [state.currentVersion];
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          currentVersion: state.currentVersion,
          confidenceAssessment: state.currentConfidence,
          lineage,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logRepresentationRouteError('GET /api/representation/versions', error);
    return sanitizeRepresentationError(error);
  }
}
