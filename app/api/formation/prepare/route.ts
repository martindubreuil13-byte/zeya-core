import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import type { FormationInitiationSource } from "@/types/formation";

type PrepareRequest = { publicExperienceSessionId?: unknown };
type FormationRow = {
  id: string;
  business_id: string;
  business_representation_id: string;
  owner_id: string;
  status: string;
  initiated_from: string | null;
  initiated_from_id: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INITIATED_FROM: FormationInitiationSource = "public_experience_session";

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function success(
  formation: FormationRow,
  existing: boolean,
) {
  return NextResponse.json(
    {
      success: true,
      data: {
        sessionId: formation.id,
        businessId: formation.business_id,
        businessRepresentationId: formation.business_representation_id,
        status: formation.status,
        route: `/formation/sessions/${formation.id}`,
        existing,
        message: existing
          ? "Formation already prepared."
          : "Formation prepared. Ready for first working conversation.",
      },
    },
    { status: existing ? 200 : 201 },
  );
}

function formationMatches(
  formation: FormationRow,
  input: {
    ownerId: string;
    businessId: string;
    businessRepresentationId: string;
    experienceSessionId: string;
  },
) {
  return formation.owner_id === input.ownerId
    && formation.business_id === input.businessId
    && formation.business_representation_id === input.businessRepresentationId
    && formation.initiated_from === INITIATED_FROM
    && formation.initiated_from_id === input.experienceSessionId;
}

async function loadFormation(
  db: SupabaseClient,
  businessRepresentationId: string,
): Promise<{ data: FormationRow[] | null; error: { code?: string } | null }> {
  return db
    .from("representation_formation_sessions")
    .select(
      "id,business_id,business_representation_id,owner_id,status,initiated_from,initiated_from_id",
    )
    .eq("business_representation_id", businessRepresentationId)
    .limit(2) as unknown as Promise<{
      data: FormationRow[] | null;
      error: { code?: string } | null;
    }>;
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  let body: PrepareRequest;
  try {
    body = await request.json() as PrepareRequest;
  } catch {
    return failure("invalid_request", 400);
  }
  if (
    typeof body.publicExperienceSessionId !== "string"
    || !UUID.test(body.publicExperienceSessionId)
  ) {
    return failure("invalid_experience_session", 400);
  }

  const ownerId = auth.user.id;
  const experienceSessionId = body.publicExperienceSessionId;
  let db: SupabaseClient;
  try {
    // This client is isolated from the request bearer token. Protected Experience
    // reads and Formation initiation must never use auth.supabase.
    db = createExperienceServiceClient();
  } catch {
    return failure("formation_service_unavailable", 503);
  }

  try {
    const sessionResult = await db
      .from("public_experience_sessions")
      .select(
        "id,state,business_id,business_representation_id,expires_at,tenant_user_id",
      )
      .eq("id", experienceSessionId)
      .maybeSingle();
    if (sessionResult.error) return failure("experience_session_lookup_failed", 500);
    if (!sessionResult.data) return failure("experience_session_not_found", 404);

    const experience = sessionResult.data;
    if (experience.tenant_user_id !== ownerId) {
      return failure("experience_session_owner_mismatch", 403);
    }
    if (Date.parse(experience.expires_at) <= Date.now()) {
      return failure("experience_session_expired", 410);
    }
    if (experience.state !== "reflection_ready") {
      return failure("experience_session_not_ready", 409);
    }
    if (
      typeof experience.business_id !== "string"
      || !UUID.test(experience.business_id)
      || typeof experience.business_representation_id !== "string"
      || !UUID.test(experience.business_representation_id)
    ) {
      return failure("experience_identity_invalid", 500);
    }

    const businessId = experience.business_id;
    const businessRepresentationId = experience.business_representation_id;
    const businesses = await db
      .from("businesses")
      .select("id,user_id")
      .eq("user_id", ownerId);
    if (businesses.error) return failure("business_lookup_failed", 500);
    if ((businesses.data ?? []).length > 1) {
      return failure("business_selection_required", 409);
    }
    if (
      businesses.data?.length !== 1
      || businesses.data[0]?.id !== businessId
      || businesses.data[0]?.user_id !== ownerId
    ) {
      return failure("experience_business_mismatch", 409);
    }

    const representationResult = await db
      .from("business_representations")
      .select("id,business_id,user_id,current_version_id")
      .eq("id", businessRepresentationId)
      .eq("business_id", businessId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (representationResult.error) {
      return failure("representation_lookup_failed", 500);
    }
    if (!representationResult.data) {
      return failure("experience_representation_mismatch", 409);
    }

    const versions = await db
      .from("representation_versions")
      .select("id", { count: "exact", head: true })
      .eq("business_representation_id", businessRepresentationId);
    if (versions.error) return failure("representation_version_lookup_failed", 500);
    if (representationResult.data.current_version_id !== null || versions.count !== 0) {
      return failure("canonical_representation_already_exists", 409);
    }

    const briefResult = await db
      .from("public_experience_representation_briefs")
      .select("id,public_experience_session_id,status")
      .eq("public_experience_session_id", experienceSessionId)
      .maybeSingle();
    if (briefResult.error) return failure("representation_brief_lookup_failed", 500);
    if (!briefResult.data) return failure("representation_brief_not_found", 409);
    if (briefResult.data.status === "requires_clarification") {
      return failure("representation_brief_requires_clarification", 409);
    }
    if (briefResult.data.status === "failed") {
      return failure("representation_brief_failed", 409);
    }
    if (briefResult.data.status !== "valid") {
      return failure("representation_brief_invalid", 409);
    }
    const brief = briefResult.data;

    const responses = await db
      .from("public_experience_brief_responses")
      .select("id,public_experience_session_id,representation_brief_id,response_type")
      .eq("public_experience_session_id", experienceSessionId)
      .eq("representation_brief_id", brief.id);
    if (responses.error) return failure("brief_response_lookup_failed", 500);
    const responseRows = responses.data ?? [];
    const confirmed = responseRows.some((response) =>
      response.public_experience_session_id === experienceSessionId
      && response.representation_brief_id === brief.id
      && response.response_type === "confirm"
    );
    if (!confirmed) {
      return failure(
        responseRows.some((response) => response.response_type === "refine")
          ? "brief_refinement_not_confirmed"
          : "brief_confirmation_required",
        409,
      );
    }

    const identity = { ownerId, businessId, businessRepresentationId, experienceSessionId };
    const existingResult = await loadFormation(db, businessRepresentationId);
    if (existingResult.error) return failure("formation_lookup_failed", 500);
    if ((existingResult.data ?? []).length > 1) {
      return failure("conflicting_active_formation", 409);
    }
    const existing = existingResult.data?.[0];
    if (existing) {
      return formationMatches(existing, identity)
        ? success(existing, true)
        : failure("conflicting_active_formation", 409);
    }

    const initiated = await db.rpc("zeya_initiate_formation_session", {
      p_business_id: businessId,
      p_business_representation_id: businessRepresentationId,
      p_owner_id: ownerId,
      p_initiated_from: INITIATED_FROM,
      p_initiated_from_id: experienceSessionId,
    });
    if (initiated.error) {
      return failure(
        initiated.error.code === "PZ409"
          ? "conflicting_active_formation"
          : "formation_initiation_failed",
        initiated.error.code === "PZ409" ? 409 : 500,
      );
    }
    const result = Array.isArray(initiated.data) ? initiated.data[0] : null;
    if (!result || typeof result.session_id !== "string" || !UUID.test(result.session_id)) {
      return failure("formation_initiation_invalid", 500);
    }

    const verifiedResult = await db
      .from("representation_formation_sessions")
      .select(
        "id,business_id,business_representation_id,owner_id,status,initiated_from,initiated_from_id",
      )
      .eq("id", result.session_id)
      .maybeSingle();
    if (verifiedResult.error || !verifiedResult.data) {
      return failure("formation_verification_failed", 500);
    }
    const verified = verifiedResult.data as FormationRow;
    if (!formationMatches(verified, identity)) {
      return failure("conflicting_active_formation", 409);
    }
    return success(verified, false);
  } catch {
    return failure("formation_prepare_failed", 500);
  }
}
