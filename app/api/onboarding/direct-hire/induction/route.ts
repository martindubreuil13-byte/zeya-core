import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { createDirectHireServiceClient } from "@/lib/onboarding/direct-hire-service-client";
import type { InductionMaterial } from "@/lib/onboarding/direct-hire-contract";
import { constitutionalDomainsForInductionMaterial } from "@/lib/onboarding/induction-evidence";
import {
  registerPublicSource,
} from "@/lib/onboarding/registered-public-sources";

type InductionRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  onboarding_state: string;
  induction_state: string;
  induction_materials_count: number;
  website_url: string;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function logDatabaseError(stage: string, error: {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}) {
  console.error(`[direct-hire-induction] ${stage}`, {
    code: error.code ?? "",
    message: error.message ?? "",
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

function success(induction_state: string, materials_count: number) {
  return NextResponse.json({
    success: true,
    data: {
      induction_state,
      materials_count,
    },
  });
}

async function persistInductionState(
  session: InductionRow,
  ownerId: string,
  inductionState: string,
  materialsCount: number,
) {
  const service = createDirectHireServiceClient();
  const updateResult = await service
    .from("direct_hire_onboarding_sessions")
    .update({
      induction_state: inductionState,
      induction_materials_count: materialsCount,
      induction_started_at:
        session.induction_state === "not_started" ? new Date().toISOString() : undefined,
      induction_materials_received_at:
        materialsCount > 0 ? new Date().toISOString() : undefined,
    })
    .eq("id", session.id)
    .eq("owner_id", ownerId)
    .select("induction_state,induction_materials_count")
    .maybeSingle();
  if (updateResult.error) {
    logDatabaseError("induction_state_update_failed", updateResult.error);
    throw new Error("induction_state_update_failed");
  }
  if (!updateResult.data) throw new Error("induction_state_update_conflict");
  return updateResult.data;
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  try {
    const sessionResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select("id,owner_id,induction_state,induction_materials_count")
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (sessionResult.error) {
      logDatabaseError("session_lookup_failed", sessionResult.error);
      return failure("session_lookup_failed", 500);
    }
    if (!sessionResult.data) return failure("session_not_found", 404);

    const session = sessionResult.data as InductionRow;

    // Load induction materials from evidence table
    const materialsResult = await auth.supabase
      .from("evidence")
      .select("id,induction_material_type,induction_material_label,induction_material_url,raw_statement,created_at")
      .eq("direct_hire_onboarding_session_id", session.id)
      .eq("source_type", "direct_hire_induction")
      .neq("induction_material_type", "link")
      .order("created_at", { ascending: false });

    if (materialsResult.error) {
      logDatabaseError("materials_lookup_failed", materialsResult.error);
      return failure("materials_lookup_failed", 500);
    }

    const sourcesResult = await auth.supabase
      .from("direct_hire_public_sources")
      .select("id,submitted_url,status,created_at")
      .eq("owner_id", ownerId)
      .eq("direct_hire_onboarding_session_id", session.id)
      .order("created_at", { ascending: false });
    if (sourcesResult.error) {
      logDatabaseError("public_sources_lookup_failed", sourcesResult.error);
      return failure("materials_lookup_failed", 500);
    }

    const registeredSources = (sourcesResult.data ?? []).map((source) => ({
      induction_material_type: "link",
      induction_material_label: "Public source",
      induction_material_url: source.submitted_url,
      raw_statement: "",
      source_status: source.status,
      created_at: source.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        onboarding_session_id: session.id,
        induction_state: session.induction_state,
        materials_count: session.induction_materials_count,
        materials: [...registeredSources, ...(materialsResult.data || [])],
      },
    });
  } catch {
    return failure("induction_lookup_failed", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;
  let action: "start" | "complete" = "start";
  try {
    const body = await request.json().catch(() => ({})) as { action?: unknown };
    action = body.action === "complete" ? "complete" : "start";
    const sessionResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select("id,owner_id,business_id,business_representation_id,onboarding_state,induction_state,induction_materials_count")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (sessionResult.error) {
      logDatabaseError("session_lookup_failed", sessionResult.error);
      return failure("session_lookup_failed", 500);
    }
    if (!sessionResult.data) return failure("session_not_found", 404);
    const session = sessionResult.data as InductionRow;
    if (session.onboarding_state !== "employment_accepted") {
      return failure("not_in_employment_accepted_state", 409);
    }
    if (action === "complete") {
      if (!["material_received", "preparation_pending"].includes(session.induction_state)) {
        return failure("induction_material_required", 409);
      }
      const materialsResult = await auth.supabase
        .from("evidence")
        .select("id", { count: "exact", head: true })
        .eq("business_representation_id", session.business_representation_id)
        .eq("direct_hire_onboarding_session_id", session.id)
        .eq("source_type", "direct_hire_induction")
        .neq("induction_material_type", "link");
      if (materialsResult.error) {
        logDatabaseError("material_count_failed", materialsResult.error);
        return failure("induction_completion_failed", 500);
      }
      const sourcesResult = await auth.supabase
        .from("direct_hire_public_sources")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("direct_hire_onboarding_session_id", session.id);
      if (sourcesResult.error) {
        logDatabaseError("public_source_count_failed", sourcesResult.error);
        return failure("induction_completion_failed", 500);
      }
      const materialsCount = (materialsResult.count ?? 0) + (sourcesResult.count ?? 0);
      if (materialsCount === 0) return failure("induction_material_required", 409);

      await persistInductionState(
        session,
        ownerId,
        "preparation_pending",
        Math.min(materialsCount, 99),
      );
      return success("preparation_pending", Math.min(materialsCount, 99));
    }

    if (session.induction_state !== "not_started") {
      return success(session.induction_state, session.induction_materials_count);
    }

    const updated = await persistInductionState(session, ownerId, "material_requested", 0);
    return success(updated.induction_state, updated.induction_materials_count);
  } catch (error) {
    const code = error instanceof Error ? error.message : "induction_start_failed";
    if (code === "induction_state_update_conflict") return failure(code, 500);
    return failure(action === "complete" ? "induction_completion_failed" : "induction_start_failed", 500);
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

  const material = body as InductionMaterial | undefined;
  if (!material || !material.type) {
    return failure("material_validation_failed", 400);
  }

  const ownerId = auth.user.id;
  try {
    // Load onboarding session
    const sessionResult = await auth.supabase
      .from("direct_hire_onboarding_sessions")
      .select("id,owner_id,business_id,business_representation_id,onboarding_state,induction_state,induction_materials_count,website_url")
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (sessionResult.error) {
      logDatabaseError("session_lookup_failed", sessionResult.error);
      return failure("session_lookup_failed", 500);
    }
    if (!sessionResult.data) return failure("session_not_found", 404);

    const session = sessionResult.data as InductionRow;

    // Verify employment_accepted or induction in progress
    if (session.onboarding_state !== "employment_accepted") {
      return failure("not_in_employment_accepted_state", 409);
    }

    // A link registers a source location. Its URL is not substantive Evidence;
    // only successfully acquired and extracted content becomes public Evidence.
    if (material.type === "link") {
      if (!material.url) return failure("material_validation_failed", 400);
      const service = createDirectHireServiceClient();
      try {
        await registerPublicSource(service, {
          ownerId,
          onboardingSessionId: session.id,
          submittedUrl: material.url,
          companyWebsiteUrl: session.website_url,
        });
      } catch (error) {
        console.error(
          "[direct-hire-induction] public_source_registration_failed",
          error instanceof Error ? error.message : "unknown_failure",
        );
        return failure("material_validation_failed", 400);
      }
    }

    // Text and notes remain owner-originated Evidence.
    const raw_statement =
      material.content || material.label || "";

    const statement_hash = createHash("sha256")
      .update(raw_statement)
      .digest("hex");

    let existingQuery = auth.supabase
      .from("evidence")
      .select("id")
      .eq("business_representation_id", session.business_representation_id)
      .eq("direct_hire_onboarding_session_id", session.id)
      .eq("source_type", "direct_hire_induction")
      .eq("statement_hash", statement_hash)
      .eq("induction_material_type", material.type);
    existingQuery = material.label
      ? existingQuery.eq("induction_material_label", material.label)
      : existingQuery.is("induction_material_label", null);
    const existingResult = await existingQuery.limit(1);
    if (existingResult.error) {
      logDatabaseError("material_idempotency_lookup_failed", existingResult.error);
      return failure("material_persistence_failed", 500);
    }

    if (material.type !== "link") {
      if ((existingResult.data ?? []).length === 0) {
        const evidenceResult = await auth.supabase
        .from("evidence")
        .insert({
          business_representation_id: session.business_representation_id,
          source_type: "direct_hire_induction",
          source_description: `Induction material: ${material.label || material.type}`,
          raw_statement,
          statement_hash,
          captured_by_actor: ownerId,
          direct_hire_onboarding_session_id: session.id,
          induction_material_type: material.type,
          induction_material_label: material.label,
          induction_material_url: null,
          affected_domains: constitutionalDomainsForInductionMaterial(material.label),
        })
        .select("id")
        .single();

        if (evidenceResult.error) {
          logDatabaseError("material_persistence_failed", evidenceResult.error);
          return failure("material_persistence_failed", 500);
        }
      }
    }

    const countResult = await auth.supabase
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("business_representation_id", session.business_representation_id)
      .eq("direct_hire_onboarding_session_id", session.id)
      .eq("source_type", "direct_hire_induction")
      .neq("induction_material_type", "link");
    if (countResult.error) {
      logDatabaseError("material_count_failed", countResult.error);
      return failure("induction_state_update_failed", 500);
    }

    const sourceCountResult = await auth.supabase
      .from("direct_hire_public_sources")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("direct_hire_onboarding_session_id", session.id);
    if (sourceCountResult.error) {
      logDatabaseError("public_source_count_failed", sourceCountResult.error);
      return failure("induction_state_update_failed", 500);
    }

    const materialsCount = Math.min(
      (countResult.count ?? 0) + (sourceCountResult.count ?? 0),
      99,
    );
    const updated = await persistInductionState(
      session,
      ownerId,
      "material_received",
      materialsCount,
    );
    return success(updated.induction_state, updated.induction_materials_count);
  } catch {
    return failure("induction_material_save_failed", 500);
  }
}
