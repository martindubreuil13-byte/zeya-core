// POST /api/call-outcomes/test-batch
// Test endpoint for batch call outcome generation and aggregation

import { NextRequest, NextResponse } from "next/server";
import { simulateCallOutcome, buildCallOutcomeSummary, aggregateCallOutcomes } from "@/lib/call-outcomes";
import type { WorkerBrief } from "@/lib/workers";

interface TestBatchRequest {
  workerBriefs: WorkerBrief[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestBatchRequest;

    if (!body.workerBriefs || !Array.isArray(body.workerBriefs)) {
      return NextResponse.json(
        { error: "workerBriefs array is required" },
        { status: 400 }
      );
    }

    if (body.workerBriefs.length === 0) {
      return NextResponse.json(
        { error: "workerBriefs array cannot be empty" },
        { status: 400 }
      );
    }

    // Simulate outcomes for all briefs
    const outcomes = body.workerBriefs.map((brief) => simulateCallOutcome(brief));

    // Build summaries
    const summaries = outcomes.map((outcome) => buildCallOutcomeSummary(outcome));

    // Aggregate statistics
    const aggregated = aggregateCallOutcomes(outcomes);

    return NextResponse.json({
      success: true,
      outcomes,
      summaries,
      aggregated,
      batchSummary: {
        totalCalls: aggregated.totalCalls,
        interested: aggregated.interested,
        meetingsBooked: aggregated.meetingsBooked,
        interestRate: aggregated.interestRate,
        conversionRate: aggregated.conversionRate,
        callbackRate: aggregated.callbackRate,
        averageSentimentScore: aggregated.averageSentimentScore.toFixed(2),
        averageDurationSeconds: aggregated.averageDurationSeconds,
        followUpsRequired: aggregated.followUpsRequired,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
