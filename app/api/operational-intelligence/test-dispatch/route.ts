// POST /api/operational-intelligence/test-dispatch
// Test endpoint for operational intelligence dispatch

import { NextRequest, NextResponse } from "next/server";
import { dispatchOperationalMission, buildOperationalDispatchSummary } from "@/lib/operational-intelligence";

interface TestDispatchRequest {
  missionId: string;
  companyContext: string;
  missionContext: string;
  desiredOutcome: string;
  title?: string;
  targetContext?: string;
  targets?: Array<{
    id: string;
    name?: string;
    phone?: string;
    context?: string;
  }>;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  intent?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestDispatchRequest;

    // Validate required fields
    const required = ["missionId", "companyContext", "missionContext", "desiredOutcome"];
    for (const field of required) {
      if (!(field in body) || !body[field as keyof TestDispatchRequest]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Dispatch with operational intelligence
    const dispatched = await dispatchOperationalMission({
      missionId: body.missionId,
      title: body.title || "Operational Mission",
      companyContext: body.companyContext,
      missionContext: body.missionContext,
      targetContext: body.targetContext,
      desiredOutcome: body.desiredOutcome,
      targets: body.targets,
      priority: body.priority,
      intent: body.intent as any,
    });

    // Build summary
    const summary = buildOperationalDispatchSummary(
      dispatched.analysis,
      dispatched.plan,
      dispatched.briefs,
      dispatched.dispatchResults
    );

    return NextResponse.json({
      success: true,
      analysis: dispatched.analysis,
      plan: dispatched.plan,
      briefs: dispatched.briefs,
      workerSelections: dispatched.workerSelections,
      dispatchResults: dispatched.dispatchResults,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
