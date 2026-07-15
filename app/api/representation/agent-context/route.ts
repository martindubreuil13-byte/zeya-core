// GET /api/representation/agent-context
// Retrieve filtered representation context for agents

import { NextRequest, NextResponse } from 'next/server';
import { createRepresentationStateService } from '@/lib/representation/representation-service';
import {
  assertVisibleBusinessRepresentation,
  createAuthenticatedRepresentationContext,
  genericNotFoundResponse,
  logRepresentationRouteError,
  sanitizeRepresentationError,
} from '@/lib/representation/api-auth';

interface GetAgentContextResponse {
  success: boolean;
  data?: {
    businessRepresentationId: string;
    elementCount: number;
    elements: Array<{
      elementId: string;
      elementKey: string;
      elementType: string;
      currentValue: any;
      confidenceScore: number;
      claimEligibility: string;
      fieldSensitivity: string;
    }>;
    retrievedAt: string;
  };
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<GetAgentContextResponse>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const businessRepresentationId = searchParams.get('businessRepresentationId');
    const includeProvisional = searchParams.get('includeProvisional') === 'true';

    if (!businessRepresentationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required query parameter: businessRepresentationId' },
        { status: 400 }
      );
    }

    await assertVisibleBusinessRepresentation(auth.supabase, businessRepresentationId);

    const service = createRepresentationStateService(auth.supabase);

    const context = await service.getAgentContext(businessRepresentationId, includeProvisional);

    if (!context) {
      return genericNotFoundResponse();
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          businessRepresentationId: context.businessRepresentationId,
          elementCount: context.elements.length,
          elements: context.elements.map((elem) => ({
            elementId: elem.elementId,
            elementKey: elem.elementKey,
            elementType: elem.elementType,
            currentValue: elem.currentValue,
            confidenceScore: elem.overallConfidenceScore,
            claimEligibility: elem.claimEligibility,
            fieldSensitivity: elem.fieldSensitivity,
          })),
          retrievedAt: context.retrievedAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logRepresentationRouteError('GET /api/representation/agent-context', error);
    return sanitizeRepresentationError(error);
  }
}
