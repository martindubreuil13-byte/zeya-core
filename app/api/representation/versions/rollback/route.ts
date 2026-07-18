import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRepresentationStateService } from '@/lib/representation/representation-service';
import {
  assertVisibleBusinessRepresentation,
  assertVisibleVersionForRepresentation,
  createAuthenticatedRepresentationContext,
  logRepresentationRouteError,
  sanitizeRepresentationError,
} from '@/lib/representation/api-auth';

type RollbackRequest = {
  businessRepresentationId?: unknown;
  targetVersionId?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json() as RollbackRequest;
    if (typeof body.businessRepresentationId !== 'string' || typeof body.targetVersionId !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    await assertVisibleBusinessRepresentation(auth.supabase, body.businessRepresentationId);
    await assertVisibleVersionForRepresentation(auth.supabase, body.targetVersionId, body.businessRepresentationId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Canonical Version authority is unavailable');
    const canonicalVersionDb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const version = await createRepresentationStateService(auth.supabase, canonicalVersionDb)
      .rollbackToVersion(body.businessRepresentationId, body.targetVersionId);

    return NextResponse.json({
      success: true,
      data: {
        versionId: version.id,
        versionNumber: version.versionNumber,
        previousVersionId: version.previousVersionId,
        rollbackOfVersionId: body.targetVersionId,
      },
    }, { status: 201 });
  } catch (error) {
    logRepresentationRouteError('POST /api/representation/versions/rollback', error);
    return sanitizeRepresentationError(error);
  }
}
