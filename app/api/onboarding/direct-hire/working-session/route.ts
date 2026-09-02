import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import {
  isValidIanaTimezone,
  parseFutureScheduledAt,
  type DirectHireWorkingSession,
} from "@/lib/onboarding/direct-hire-working-session";
import { isFirstWorkingSessionPreparationCurrentAndUsable } from "@/lib/onboarding/first-working-session-currentness";

type WorkingSessionRow = {
  id: string;
  owner_id: string;
  direct_hire_onboarding_session_id: string;
  formation_session_id: string | null;
  session_kind: "first_working_session";
  scheduled_at: string;
  scheduling_timezone: string;
  status: "scheduled" | "cancelled" | "completed";
  preparation_status: "pending" | "running" | "ready" | "partial" | "failed";
  preparation_contract_version: string | null;
  preparation_failure_code: string | null;
  preparation_attempt_count: number;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function project(row: WorkingSessionRow): DirectHireWorkingSession {
  return {
    id: row.id,
    onboardingSessionId: row.direct_hire_onboarding_session_id,
    formationSessionId: row.formation_session_id,
    sessionKind: row.session_kind,
    scheduledAt: row.scheduled_at,
    schedulingTimezone: row.scheduling_timezone,
    status: row.status,
    preparationStatus: row.preparation_status,
    preparationContractVersion: row.preparation_contract_version ?? null,
    preparationCurrent: isFirstWorkingSessionPreparationCurrentAndUsable(row),
    preparationFailureCode: row.preparation_failure_code,
    preparationAttemptCount: row.preparation_attempt_count,
  };
}

function rpcFailure(error: { code?: string; message?: string }) {
  if (error.code === "22023") return failure(error.message || "invalid_schedule", 400);
  if (error.code === "PZ404") return failure(error.message || "working_session_not_found", 404);
  if (error.code === "PZ409" || error.code === "23505") {
    return failure(error.message || "working_session_conflict", 409);
  }
  return failure("working_session_persistence_failed", 500);
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const result = await auth.supabase
    .from("direct_hire_working_sessions")
    .select("id,owner_id,direct_hire_onboarding_session_id,formation_session_id,session_kind,scheduled_at,scheduling_timezone,status,preparation_status,preparation_contract_version,preparation_failure_code,preparation_attempt_count")
    .eq("owner_id", auth.user.id)
    .eq("session_kind", "first_working_session")
    .eq("status", "scheduled")
    .order("created_at", { ascending: false })
    .limit(2);
  if (result.error) return failure("working_session_lookup_failed", 500);
  if ((result.data ?? []).length > 1) return failure("working_session_state_conflict", 409);
  const row = result.data?.[0] as WorkingSessionRow | undefined;
  return NextResponse.json({ success: true, data: row ? project(row) : null });
}

async function schedule(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null) as {
    scheduledAt?: unknown;
    schedulingTimezone?: unknown;
  } | null;
  const scheduledAt = parseFutureScheduledAt(body?.scheduledAt);
  if (!scheduledAt) return failure("invalid_or_past_scheduled_at", 400);
  if (!isValidIanaTimezone(body?.schedulingTimezone)) {
    return failure("invalid_scheduling_timezone", 400);
  }

  const result = await auth.supabase.rpc("zeya_schedule_direct_hire_working_session", {
    p_scheduled_at: scheduledAt,
    p_scheduling_timezone: body.schedulingTimezone,
  });
  if (result.error) return rpcFailure(result.error);
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length !== 1) return failure("working_session_persistence_invalid", 500);
  return NextResponse.json({ success: true, data: project(rows[0] as WorkingSessionRow) });
}

export async function POST(request: NextRequest) {
  return schedule(request);
}

export async function PATCH(request: NextRequest) {
  return schedule(request);
}

export async function DELETE(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const result = await auth.supabase.rpc("zeya_cancel_direct_hire_working_session");
  if (result.error) return rpcFailure(result.error);
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length !== 1) return failure("working_session_persistence_invalid", 500);
  return NextResponse.json({ success: true, data: project(rows[0] as WorkingSessionRow) });
}
