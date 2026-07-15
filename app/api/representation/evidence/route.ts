// POST /api/representation/evidence
// Submit founder statement as evidence to begin representation state creation

import { NextRequest, NextResponse } from 'next/server';
import { createRepresentationStateService } from '@/lib/representation/representation-service';
import {
  assertVisibleBusiness,
  createAuthenticatedRepresentationContext,
  logRepresentationRouteError,
  sanitizeRepresentationError,
} from '@/lib/representation/api-auth';

interface SubmitEvidenceRequest {
  businessId: string;
  statement: string;
  sourceDescription?: string;
  affectedDomains?: string[];
  affectedElementIds?: string[];
  targetElementId?: string;
  affectedElementValues?: Record<string, unknown>;
}

interface SubmitEvidenceResponse {
  success: boolean;
  data?: {
    evidenceId: string;
    observationId: string;
    proposalId: string;
    businessRepresentationId: string;
    riskTier: string;
    requiresApproval: boolean;
    contradictionDetected?: boolean;
    representationRestricted?: boolean;
    confidenceReduced?: boolean;
    reviewRequired?: boolean;
  };
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<SubmitEvidenceResponse>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    // Parse request body
    const body: SubmitEvidenceRequest = await request.json();

    if (!body.businessId || !body.statement) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: businessId, statement' },
        { status: 400 }
      );
    }

    if (body.statement.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Statement cannot be empty' }, { status: 400 });
    }

    const affectedElementIds = Array.from(new Set([
      ...(body.affectedElementIds || []),
      ...(body.targetElementId ? [body.targetElementId] : []),
    ]));

    await assertVisibleBusiness(auth.supabase, body.businessId, auth.user.id);

    const service = createRepresentationStateService(auth.supabase);

    // Process founder statement through vertical slice
    const result = await service.processFounderStatement(body.businessId, body.statement, {
      sourceDescription: body.sourceDescription,
      affectedDomains: body.affectedDomains,
      affectedElementIds,
      affectedElementValues: body.affectedElementValues,
    });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        data: {
          evidenceId: result.evidence.id,
          observationId: result.observation.id,
          proposalId: result.proposal.id,
          businessRepresentationId: result.evidence.businessRepresentationId,
          riskTier: result.riskAssessment.riskTier,
          requiresApproval: result.riskAssessment.requiresApproval,
          contradictionDetected: result.contradictionDetected,
          representationRestricted: result.representationRestricted,
          confidenceReduced: result.confidenceReduced,
          reviewRequired: result.reviewRequired,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logRepresentationRouteError('POST /api/representation/evidence', error);
    return sanitizeRepresentationError(error);
  }
}
