import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { resolveOwnerFormationPrecedence } from '@/lib/onboarding/first-working-session-currentness';

type OwnerStatusFailureStage =
  | 'authentication'
  | 'business_lookup'
  | 'representation_lookup'
  | 'direct_hire_lookup'
  | 'working_session_lookup'
  | 'formation_lookup'
  | 'version_lookup'
  | 'response_validation';

const ACTIVE_FORMATION_STATUSES = [
  'initiated',
  'getting_familiar',
  'working_conversation_pending',
  'working_conversation_linked',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ownerStatusFailure(
  stage: OwnerStatusFailureStage,
  status = 500,
) {
  return NextResponse.json(
    { success: false, error: 'owner_status_failed', stage },
    { status },
  );
}

function newOwnerResponse() {
  return NextResponse.json(
    {
      success: true,
      data: {
        status: 'new_owner',
        message: 'Ready to start Representation Experience',
      },
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) {
    return ownerStatusFailure('authentication', 401);
  }

  const ownerId = auth.user.id;

  try {
    const businessesResult = await auth.supabase
      .from('businesses')
      .select('id')
      .eq('user_id', ownerId)
      .order('created_at', { ascending: true });

    if (businessesResult.error) {
      console.error('[owner-status]', {
        stage: 'business_lookup',
        code: businessesResult.error.code,
      });
      return ownerStatusFailure('business_lookup');
    }

    const businesses = businessesResult.data ?? [];
    if (businesses.length === 0) return newOwnerResponse();

    if (businesses.length > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'business_selection_required',
          stage: 'business_lookup',
        },
        { status: 409 },
      );
    }

    const businessId = businesses[0]?.id;
    if (typeof businessId !== 'string' || !UUID.test(businessId)) {
      return ownerStatusFailure('response_validation');
    }

    const representationResult = await auth.supabase
      .from('business_representations')
      .select('id, business_id, user_id, current_version_id')
      .eq('business_id', businessId)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (representationResult.error) {
      console.error('[owner-status]', {
        stage: 'representation_lookup',
        code: representationResult.error.code,
      });
      return ownerStatusFailure('representation_lookup');
    }

    const representation = representationResult.data;
    if (!representation) return newOwnerResponse();

    if (
      typeof representation.id !== 'string' ||
      !UUID.test(representation.id) ||
      representation.business_id !== businessId ||
      representation.user_id !== ownerId
    ) {
      return ownerStatusFailure('response_validation');
    }

    // Canonical truth takes precedence over any historical Formation row.
    if (representation.current_version_id) {
      if (
        typeof representation.current_version_id !== 'string'
        || !UUID.test(representation.current_version_id)
      ) {
        return ownerStatusFailure('response_validation');
      }
      const versionResult = await auth.supabase
        .from('representation_versions')
        .select('id, version_number, business_representation_id')
        .eq('id', representation.current_version_id)
        .eq('business_representation_id', representation.id)
        .maybeSingle();
      if (versionResult.error || !versionResult.data) {
        console.error('[owner-status]', {
          stage: 'version_lookup',
          code: versionResult.error?.code ?? 'current_version_missing',
        });
        return ownerStatusFailure('version_lookup');
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'has_representation',
          businessRepresentationId: representation.id,
          businessId,
          versionNumber: versionResult.data.version_number,
        },
      }, { status: 200 });
    }

    const formationResult = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, status, business_id, business_representation_id, owner_id')
      .eq('owner_id', ownerId)
      .eq('business_id', businessId)
      .eq('business_representation_id', representation.id)
      .in('status', [...ACTIVE_FORMATION_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1);

    if (formationResult.error) {
      console.error('[owner-status]', {
        stage: 'formation_lookup',
        code: formationResult.error.code,
      });
      return ownerStatusFailure('formation_lookup');
    }

    const activeFormation = formationResult.data?.[0];
    if (activeFormation) {
      if (
        typeof activeFormation.id !== 'string' ||
        !UUID.test(activeFormation.id) ||
        activeFormation.business_id !== businessId ||
        activeFormation.business_representation_id !== representation.id ||
        activeFormation.owner_id !== ownerId
      ) {
        return ownerStatusFailure('response_validation');
      }
    }

    // Check for active Direct Hire onboarding session.
    // Employed owners without canonical Representation must resume onboarding at the correct surface.
    const directHireResult = await auth.supabase
      .from('direct_hire_onboarding_sessions')
      .select('id, onboarding_state')
      .eq('owner_id', ownerId)
      .eq('business_id', businessId)
      .eq('business_representation_id', representation.id)
      .maybeSingle();

    if (directHireResult.error) {
      console.error('[owner-status]', {
        stage: 'direct_hire_lookup',
        code: directHireResult.error.code,
      });
      return ownerStatusFailure('direct_hire_lookup');
    }

    const directHireSession = directHireResult.data;
    if (directHireSession) {
      if (
        typeof directHireSession.id !== 'string' ||
        !UUID.test(directHireSession.id) ||
        typeof directHireSession.onboarding_state !== 'string'
      ) {
        return ownerStatusFailure('response_validation');
      }
    }

    if (activeFormation && directHireSession) {
      const workingSessionResult = await auth.supabase
        .from('direct_hire_working_sessions')
        .select('preparation_status, preparation_contract_version')
        .eq('direct_hire_onboarding_session_id', directHireSession.id)
        .eq('status', 'scheduled')
        .maybeSingle();

      if (workingSessionResult.error) {
        console.error('[owner-status]', {
          stage: 'working_session_lookup',
          code: workingSessionResult.error.code,
        });
        return ownerStatusFailure('working_session_lookup');
      }

      if (resolveOwnerFormationPrecedence({
        hasActiveFormation: true,
        hasDirectHireOnboarding: true,
        authoritativeWorkingSession: workingSessionResult.data,
      }) === 'direct_hire_employed') {
        return NextResponse.json(
          {
            success: true,
            data: {
              status: 'direct_hire_employed',
              directHireSessionId: directHireSession.id,
              onboardingState: directHireSession.onboarding_state,
              businessRepresentationId: representation.id,
              businessId,
            },
          },
          { status: 200 },
        );
      }
    }

    if (activeFormation) {
      return NextResponse.json(
        {
          success: true,
          data: {
            status: 'active_formation',
            formationSessionId: activeFormation.id,
            formationStatus: activeFormation.status,
            businessRepresentationId: representation.id,
            businessId,
          },
        },
        { status: 200 },
      );
    }

    if (directHireSession) {
      return NextResponse.json(
        {
          success: true,
          data: {
            status: 'direct_hire_employed',
            directHireSessionId: directHireSession.id,
            onboardingState: directHireSession.onboarding_state,
            businessRepresentationId: representation.id,
            businessId,
          },
        },
        { status: 200 },
      );
    }

    return newOwnerResponse();
  } catch {
    console.error('[owner-status]', {
      stage: 'response_validation',
      code: 'unexpected_exception',
    });
    return ownerStatusFailure('response_validation');
  }
}
