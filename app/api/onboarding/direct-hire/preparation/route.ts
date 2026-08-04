import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { executeDirectHirePreparation } from "@/lib/onboarding/direct-hire-preparation";
import { createDirectHireServiceClient } from "@/lib/onboarding/direct-hire-service-client";
import type { DirectHireProgress } from "@/lib/onboarding/direct-hire-contract";

type ClaimRow = {
  onboarding_session_id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  website_url: string;
  preparation_status: string;
  preparation_lease_id: string | null;
  preparation_attempt_count: number;
  preparation_progress: DirectHireProgress;
  claimed: boolean;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function current(row: ClaimRow) {
  return NextResponse.json({
    success: true,
    data: {
      preparationStatus: row.preparation_status,
      progress: row.preparation_progress ?? {},
      attemptCount: row.preparation_attempt_count,
      executionStarted: row.claimed,
    },
  }, { status: row.preparation_status === "running" ? 202 : 200 });
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const claim = await auth.supabase.rpc("zeya_claim_direct_hire_preparation");
  if (claim.error) {
    if (claim.error.code === "PZ404") return failure("onboarding_not_found", 404);
    if (claim.error.code === "PZ409") return failure("preparation_not_retryable", 409);
    return failure("preparation_claim_failed", 500);
  }
  const rows = Array.isArray(claim.data) ? claim.data : [];
  const row = rows.length === 1 ? rows[0] as ClaimRow : null;
  if (!row || row.owner_id !== auth.user.id) return failure("preparation_claim_invalid", 500);
  if (!row.claimed || row.preparation_status === "ready") return current(row);
  if (!row.preparation_lease_id) return failure("preparation_claim_invalid", 500);

  let result;
  try {
    result = await executeDirectHirePreparation(row.website_url, {
      sourceScope: row.onboarding_session_id,
    });
  } catch {
    result = {
      status: "failed" as const,
      failureCode: "request_failed" as const,
      progress: {
        validating_destination: "failed" as const,
        homepage: "failed" as const,
        evidence: "failed" as const,
        observations: "skipped" as const,
      },
      successfulPageCount: 0,
      failedPageCount: 1,
      evidence: [],
      observations: [],
    };
  }

  try {
    const service = createDirectHireServiceClient();
    const finalized = await service.rpc("zeya_finalize_direct_hire_preparation", {
      p_onboarding_session_id: row.onboarding_session_id,
      p_expected_owner_id: auth.user.id,
      p_lease_id: row.preparation_lease_id,
      p_final_status: result.status,
      p_failure_code: result.failureCode,
      p_progress: result.progress,
      p_successful_page_count: result.successfulPageCount,
      p_failed_page_count: result.failedPageCount,
      p_evidence: result.evidence,
      p_observations: result.observations,
    });
    if (finalized.error) {
      if (finalized.error.code === "PZ409") return failure("preparation_lease_conflict", 409);
      return failure("preparation_persistence_failed", 500);
    }
    const finalizedRows = Array.isArray(finalized.data) ? finalized.data : [];
    const final = finalizedRows.length === 1 && finalizedRows[0]
      ? finalizedRows[0] as Record<string, unknown>
      : null;
    if (!final) return failure("preparation_persistence_invalid", 500);
    return NextResponse.json({
      success: true,
      data: {
        preparationStatus: final.preparation_status,
        progress: final.preparation_progress,
        attemptCount: final.preparation_attempt_count,
        successfulPageCount: final.preparation_successful_page_count,
        failedPageCount: final.preparation_failed_page_count,
        failureCode: final.preparation_failure_code,
        completedAt: final.preparation_completed_at,
      },
    });
  } catch {
    return failure("preparation_persistence_failed", 500);
  }
}
