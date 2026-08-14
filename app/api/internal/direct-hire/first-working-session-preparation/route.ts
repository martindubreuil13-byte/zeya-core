import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createDirectHireServiceClient } from "@/lib/onboarding/direct-hire-service-client";
import { executeOneFirstWorkingSessionPreparation } from "@/lib/onboarding/first-working-session-preparation-worker";
import { PreparationReasoningStageError } from "@/lib/onboarding/hypothesis-reasoning-service";
import { FirstWorkingSessionPreparationStageError } from "@/lib/onboarding/first-working-session-brief";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const configured = process.env.DIRECT_HIRE_PREPARATION_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = createHash("sha256").update(configured).digest();
  const actual = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expected, actual);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  try {
    const result = await executeOneFirstWorkingSessionPreparation(createDirectHireServiceClient());
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const safeStage = error instanceof PreparationReasoningStageError
      ? error.stageCode
      : error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode
        : error instanceof Error && /^[a-z][a-z0-9_]{2,119}$/.test(error.message)
          ? error.message
      : "preparation_failed";
    console.error("[first-working-session-preparation]", safeStage);
    return NextResponse.json({ success: false, error: safeStage }, { status: 503 });
  }
}
