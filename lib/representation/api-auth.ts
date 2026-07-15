import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import {
  isRepresentationConflictError,
  isRepresentationInvalidInputError,
  isRepresentationNotFoundError,
  RepresentationNotFoundError,
} from './errors';

export type AuthenticatedRepresentationContext = {
  supabase: SupabaseClient;
  user: User;
};

export function genericNotFoundResponse(): NextResponse<{ success: false; error: string }> {
  return NextResponse.json({ success: false, error: 'Representation not found' }, { status: 404 });
}

export function sanitizeRepresentationError(error: unknown): NextResponse<{ success: false; error: string }> {
  if (isRepresentationNotFoundError(error)) {
    return genericNotFoundResponse();
  }
  if (isRepresentationInvalidInputError(error)) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid input' }, { status: 400 });
  }
  if (isRepresentationConflictError(error)) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Conflict' }, { status: 409 });
  }

  return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
}

export function logRepresentationRouteError(route: string, error: unknown): void {
  if (isRepresentationNotFoundError(error)) {
    console.warn(`[representation] ${route} failed: not_found`);
    return;
  }

  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : null;
  const databaseError = typeof error === 'object' && error
    ? error as { message?: unknown; details?: unknown; hint?: unknown }
    : null;
  console.error(`[representation] ${route} failed`, {
    ...(code ? { code } : {}),
    ...(process.env.NODE_ENV === 'development' && databaseError
      ? {
          message: String(databaseError.message ?? ''),
          details: String(databaseError.details ?? ''),
          hint: String(databaseError.hint ?? ''),
        }
      : {}),
  });
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function createAuthenticatedRepresentationContext(
  request: NextRequest
): Promise<AuthenticatedRepresentationContext | NextResponse<{ success: false; error: string }>> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 401 });
  }

  return { supabase, user: data.user };
}

export async function assertVisibleBusinessRepresentation(
  supabase: SupabaseClient,
  businessRepresentationId: string
): Promise<void> {
  if (!isUuid(businessRepresentationId)) {
    throw new RepresentationNotFoundError();
  }

  const { data, error } = await supabase
    .from('business_representations')
    .select('id')
    .eq('id', businessRepresentationId)
    .maybeSingle();

  if (error || !data?.id) {
    throw new RepresentationNotFoundError();
  }
}

export async function assertVisibleBusiness(
  supabase: SupabaseClient,
  businessId: string,
  userId: string
): Promise<void> {
  if (!isUuid(businessId)) {
    throw new RepresentationNotFoundError();
  }

  const { data, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.id) {
    throw new RepresentationNotFoundError();
  }
}

export async function assertVisibleProposalForRepresentation(
  supabase: SupabaseClient,
  proposalId: string,
  businessRepresentationId: string
): Promise<void> {
  if (!isUuid(proposalId)) {
    throw new RepresentationNotFoundError();
  }

  const { data, error } = await supabase
    .from('representation_proposals')
    .select('id')
    .eq('id', proposalId)
    .eq('business_representation_id', businessRepresentationId)
    .maybeSingle();

  if (error || !data?.id) {
    throw new RepresentationNotFoundError();
  }
}
