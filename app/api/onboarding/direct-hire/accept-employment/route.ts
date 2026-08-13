import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";

type DirectHireRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function success() {
  return NextResponse.json({
    success: true,
    data: {},
  });
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  try {
    // Load the Direct Hire onboarding session
    const onboardingResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select("id,owner_id,business_id,business_representation_id")
      .eq("owner_id", ownerId)
      .limit(2);

    if (onboardingResult.error) return failure("onboarding_lookup_failed", 500);
    if ((onboardingResult.data ?? []).length > 1) {
      return failure("onboarding_state_conflict", 409);
    }

    const onboarding = onboardingResult.data?.[0] as DirectHireRow | undefined;
    if (!onboarding) return failure("onboarding_not_found", 404);

    // Verify lineage
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

    // Employment acceptance does NOT create a canonical Representation Version.
    // The governed RPC performs only the allowed owner-scoped state transition.
    const acceptance = await auth.supabase.rpc(
      "zeya_accept_direct_hire_employment"
    );

    if (acceptance.error) {
      const message = acceptance.error.message;

      const status =
        message === "onboarding not found" ? 404 :
        message === "onboarding lineage invalid" ? 409 :
        message === "invalid onboarding state" ? 409 :
        500;

      return failure(message || "employment_acceptance_failed", status);
    }

    return success();
  } catch {
    return failure("accept_employment_failed", 500);
  }
}
