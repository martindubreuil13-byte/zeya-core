import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import {
  DIRECT_HIRE_ONBOARDING_STATES,
  DIRECT_HIRE_PREPARATION_STATUSES,
  DIRECT_HIRE_PROGRESS_STEPS,
  projectDirectHireCount,
  type DirectHireOnboardingState,
  type DirectHirePreparationView,
  type DirectHirePreparationStatus,
  type DirectHireProgress,
  type DirectHireProgressValue,
  type DirectHireSafeFailureCode,
} from "@/lib/onboarding/direct-hire-contract";
import { validateDirectHireProfile } from "@/lib/onboarding/direct-hire-validation";
import { FIRST_WORKING_SESSION_PREPARATION_VERSION } from "@/lib/onboarding/first-working-session-brief";

type DirectHireRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  onboarding_state: string;
  preparation_status: string;
  research_authorized_at: string | null;
  preparation_attempt_count: number;
  preparation_lease_expires_at: string | null;
  preparation_completed_at: string | null;
  preparation_failure_code: string | null;
  preparation_progress: unknown;
  preparation_successful_page_count: number;
  preparation_failed_page_count: number;
};

function failure(error: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

function isOnboardingState(value: string): value is DirectHireOnboardingState {
  return DIRECT_HIRE_ONBOARDING_STATES.some((state) => state === value);
}

function isPreparationStatus(value: string): value is DirectHirePreparationStatus {
  return DIRECT_HIRE_PREPARATION_STATUSES.some((status) => status === value);
}

const PROGRESS_VALUES: DirectHireProgressValue[] = [
  "pending", "running", "complete", "skipped", "failed",
];

function safeProgress(value: unknown): DirectHireProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(DIRECT_HIRE_PROGRESS_STEPS.flatMap((step) => {
    const candidate = source[step];
    return typeof candidate === "string" && PROGRESS_VALUES.includes(candidate as DirectHireProgressValue)
      ? [[step, candidate]]
      : [];
  })) as DirectHireProgress;
}

function success(
  state: DirectHireOnboardingState,
  preparationStatus: DirectHirePreparationStatus,
  preparation: DirectHirePreparationView,
) {
  return NextResponse.json({
    success: true,
    data: { state, preparationStatus, preparation },
  });
}

const EMPTY_PREPARATION: DirectHirePreparationView = {
  authorized: false,
  progress: {},
  successfulPageCount: 0,
  failedPageCount: 0,
  attemptCount: 0,
  retryAvailable: false,
  failureCode: null,
  completedAt: null,
};

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  try {
    const onboardingResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select(
        "id,owner_id,business_id,business_representation_id,onboarding_state,preparation_status,research_authorized_at,preparation_attempt_count,preparation_completed_at,preparation_failure_code,preparation_progress,preparation_successful_page_count,preparation_failed_page_count,preparation_lease_expires_at",
      )
      .eq("owner_id", ownerId)
      .limit(2);
    if (onboardingResult.error) return failure("onboarding_lookup_failed", 500);
    if ((onboardingResult.data ?? []).length > 1) {
      return failure("onboarding_state_conflict", 409);
    }

    const onboarding = onboardingResult.data?.[0] as DirectHireRow | undefined;
    if (!onboarding) {
      const businesses = await auth.supabase
        .from("businesses")
        .select("id")
        .eq("user_id", ownerId)
        .limit(2);
      if (businesses.error) return failure("business_lookup_failed", 500);
      if ((businesses.data ?? []).length > 1) {
        return failure("business_selection_required", 409);
      }
      const businessId = businesses.data?.[0]?.id;
      if (typeof businessId === "string") {
        const representation = await auth.supabase
          .from("business_representations")
          .select("id,current_version_id")
          .eq("business_id", businessId)
          .eq("user_id", ownerId)
          .maybeSingle();
        if (representation.error) return failure("representation_lookup_failed", 500);
        if (representation.data?.current_version_id) {
          return failure("owner_journey_conflict", 409);
        }
        if (representation.data?.id) {
          const formation = await auth.supabase
            .from("representation_formation_sessions")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", ownerId)
            .eq("business_id", businessId)
            .eq("business_representation_id", representation.data.id);
          if (formation.error) return failure("formation_lookup_failed", 500);
          if ((formation.count ?? 0) > 0) return failure("owner_journey_conflict", 409);
        }
      }
      return success("first_meeting", "not_started", EMPTY_PREPARATION);
    }

    if (
      onboarding.owner_id !== ownerId ||
      !isOnboardingState(onboarding.onboarding_state) ||
      !isPreparationStatus(onboarding.preparation_status)
    ) {
      return failure("onboarding_state_invalid", 500);
    }

    const [business, representation] = await Promise.all([
      auth.supabase
        .from("businesses")
        .select("id")
        .eq("id", onboarding.business_id)
        .eq("user_id", ownerId)
        .maybeSingle(),
      auth.supabase
        .from("business_representations")
        .select("id,current_version_id")
        .eq("id", onboarding.business_representation_id)
        .eq("business_id", onboarding.business_id)
        .eq("user_id", ownerId)
        .maybeSingle(),
    ]);
    if (business.error || representation.error) {
      return failure("onboarding_lineage_lookup_failed", 500);
    }
    if (!business.data || !representation.data) {
      return failure("onboarding_lineage_invalid", 409);
    }
    if (representation.data.current_version_id) {
      return failure("owner_journey_conflict", 409);
    }

    const formation = await auth.supabase
      .from("representation_formation_sessions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("business_id", onboarding.business_id)
      .eq("business_representation_id", onboarding.business_representation_id);
    if (formation.error) return failure("formation_lookup_failed", 500);

    // P2.12D.1e: Allow preparation re-entry if preparation is not ready/current
    // Determine usability from the authoritative working session (status='scheduled')
    // Authoritative: preparation is usable only when BOTH status='ready' AND contract is current
    const formationExists = (formation.count ?? 0) > 0;
    if (formationExists) {
      const workingSessionResult = await auth.supabase
        .from("direct_hire_working_sessions")
        .select("preparation_status,preparation_contract_version")
        .eq("direct_hire_onboarding_session_id", onboarding.id)
        .eq("status", "scheduled")
        .maybeSingle();

      if (workingSessionResult.error) return failure("working_session_lookup_failed", 500);

      const preparationIsReadyAndCurrent =
        workingSessionResult.data?.preparation_status === "ready" &&
        workingSessionResult.data?.preparation_contract_version === FIRST_WORKING_SESSION_PREPARATION_VERSION;

      if (preparationIsReadyAndCurrent) {
        return failure("owner_journey_conflict", 409);
      }
      // If formation exists but preparation is not ready/current, allow preparation re-entry surface
    }

    return success(onboarding.onboarding_state, onboarding.preparation_status, {
      authorized: Boolean(onboarding.research_authorized_at),
      progress: safeProgress(onboarding.preparation_progress),
      successfulPageCount: projectDirectHireCount(onboarding.preparation_successful_page_count),
      failedPageCount: projectDirectHireCount(onboarding.preparation_failed_page_count),
      attemptCount: projectDirectHireCount(onboarding.preparation_attempt_count, 3),
      retryAvailable: onboarding.preparation_status === "running"
        && projectDirectHireCount(onboarding.preparation_attempt_count, 3) < 3
        && typeof onboarding.preparation_lease_expires_at === "string"
        && Date.parse(onboarding.preparation_lease_expires_at) <= Date.now(),
      failureCode: typeof onboarding.preparation_failure_code === "string"
        ? onboarding.preparation_failure_code as DirectHireSafeFailureCode
        : null,
      completedAt: onboarding.preparation_completed_at,
    });
  } catch {
    return failure("onboarding_lookup_failed", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request", 400);
  }

  const validated = validateDirectHireProfile(body);
  if (!validated.success) {
    return failure("validation_failed", 400, validated.errors);
  }

  try {
    const result = await auth.supabase.rpc("zeya_upsert_direct_hire_profile", {
      p_owner_relationship_name: validated.data.ownerName,
      p_business_name: validated.data.businessName,
      p_website_url: validated.data.website,
      p_phone_e164: validated.data.phone,
      p_growth_priority: validated.data.growthPriority,
    });
    if (result.error) {
      if (result.error.code === "PZ409") {
        return failure("owner_journey_conflict", 409);
      }
      if (result.error.code === "22023") {
        return failure("validation_failed", 400);
      }
      return failure("profile_persistence_failed", 500);
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const row = rows.length === 1 && rows[0] && typeof rows[0] === "object"
      ? rows[0] as Record<string, unknown>
      : null;
    const state = row?.onboarding_state;
    const preparationStatus = row?.preparation_status;
    if (
      typeof state !== "string" ||
      !isOnboardingState(state) ||
      typeof preparationStatus !== "string" ||
      !isPreparationStatus(preparationStatus)
    ) {
      return failure("profile_persistence_invalid", 500);
    }

    return success(state, preparationStatus, EMPTY_PREPARATION);
  } catch {
    return failure("profile_persistence_failed", 500);
  }
}
