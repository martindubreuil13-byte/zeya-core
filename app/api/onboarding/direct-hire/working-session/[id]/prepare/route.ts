import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { createDirectHireServiceClient } from "@/lib/onboarding/direct-hire-service-client";
import { executeFirstWorkingSessionPreparationForSession } from "@/lib/onboarding/first-working-session-preparation-worker";
import { PreparationReasoningStageError } from "@/lib/onboarding/hypothesis-reasoning-service";
import { FirstWorkingSessionPreparationStageError } from "@/lib/onboarding/first-working-session-brief";

export const maxDuration = 300;

type WorkingSessionRow = {
  id: string;
  owner_id: string;
  status: "scheduled" | "cancelled" | "completed";
  preparation_status: "pending" | "running" | "ready" | "partial" | "failed";
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id || !isValidUuid(id)) {
    return failure("invalid_working_session_id", 400);
  }

  // Verify ownership and session state
  const sessionResult = await auth.supabase
    .from("direct_hire_working_sessions")
    .select("id,owner_id,status,preparation_status")
    .eq("id", id)
    .eq("owner_id", auth.user.id)
    .single();

  if (sessionResult.error) {
    if (sessionResult.error.code === "PGRST116") return failure("working_session_not_found", 404);
    return failure("working_session_lookup_failed", 500);
  }

  const session = sessionResult.data as WorkingSessionRow | null;
  if (!session) return failure("working_session_not_found", 404);
  if (session.status !== "scheduled") {
    return failure("working_session_not_scheduled", 409);
  }

  // Allow preparation to be triggered for pending, failed, or already running sessions
  // (running sessions with live lease will be skipped by the RPC)
  if (!["pending", "running", "ready", "partial", "failed"].includes(session.preparation_status)) {
    return failure("preparation_state_invalid", 409);
  }

  try {
    const service = createDirectHireServiceClient();
    const result = await executeFirstWorkingSessionPreparationForSession(service, id);

    // Re-fetch to get updated status
    const updated = await auth.supabase
      .from("direct_hire_working_sessions")
      .select("id,owner_id,status,preparation_status")
      .eq("id", id)
      .single();

    if (updated.error) {
      return failure("preparation_status_lookup_failed", 500);
    }

    return NextResponse.json({
      success: true,
      data: {
        workingSessionId: id,
        preparationStatus: (updated.data as WorkingSessionRow).preparation_status,
        claimed: result.claimed,
      },
    });
  } catch (error) {
    const safeStage = error instanceof PreparationReasoningStageError
      ? error.stageCode
      : error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode
        : error instanceof Error && /^[a-z][a-z0-9_]{2,119}$/.test(error.message)
          ? error.message
      : "preparation_failed";
    console.error("[working-session-prepare]", safeStage);
    return NextResponse.json({ success: false, error: safeStage }, { status: 503 });
  }
}
