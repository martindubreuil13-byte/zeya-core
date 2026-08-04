import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import {
  DIRECT_HIRE_ONBOARDING_STATES,
  DIRECT_HIRE_PREPARATION_STATUSES,
  type DirectHireOnboardingState,
  type DirectHirePreparationStatus,
} from "@/lib/onboarding/direct-hire-contract";
import { validateDirectHireProfile } from "@/lib/onboarding/direct-hire-validation";

type DirectHireRow = {
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  onboarding_state: string;
  preparation_status: string;
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

function success(state: DirectHireOnboardingState, preparationStatus: DirectHirePreparationStatus) {
  return NextResponse.json({
    success: true,
    data: { state, preparationStatus },
  });
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  try {
    const onboardingResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select(
        "owner_id,business_id,business_representation_id,onboarding_state,preparation_status",
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
      return success("first_meeting", "not_started");
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
    if ((formation.count ?? 0) > 0) return failure("owner_journey_conflict", 409);

    return success(onboarding.onboarding_state, onboarding.preparation_status);
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

    return success(state, preparationStatus);
  } catch {
    return failure("profile_persistence_failed", 500);
  }
}
