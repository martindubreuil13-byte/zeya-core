// POST /api/call-outcomes/test-outcome
// Test endpoint for single call outcome generation

import { NextRequest, NextResponse } from "next/server";
import { simulateCallOutcome, buildCallOutcomeSummary } from "@/lib/call-outcomes";
import type { WorkerBrief } from "@/lib/workers";

interface TestOutcomeRequest {
  workerBrief: WorkerBrief;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestOutcomeRequest;

    if (!body.workerBrief) {
      return NextResponse.json(
        { error: "workerBrief is required" },
        { status: 400 }
      );
    }

    // Simulate call outcome
    const outcome = simulateCallOutcome(body.workerBrief);

    // Build summary
    const summary = buildCallOutcomeSummary(outcome);

    return NextResponse.json({
      success: true,
      outcome,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
