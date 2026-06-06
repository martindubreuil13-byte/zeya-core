// POST /api/execution-plans/test-plan
// Test endpoint for ExecutionPlan generation and dispatch

import { NextRequest, NextResponse } from "next/server";
import {
  buildExecutionPlan,
  dispatchExecutionPlan,
  buildExecutionPlanSummary,
} from "@/lib/execution-plans";
import type { ExecutionTarget } from "@/lib/execution-plans";

interface TestPlanRequest {
  missionId: string;
  title: string;
  companyContext: string;
  missionObjective: string;
  desiredOutcome: string;
  targets?: Array<{
    id: string;
    name?: string;
    phone?: string;
    context?: string;
  }>;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assumptions?: string[];
  risks?: string[];
  successCriteria?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestPlanRequest;

    // Validate required fields
    const required = ["missionId", "title", "companyContext", "missionObjective", "desiredOutcome"];
    for (const field of required) {
      if (!(field in body) || !body[field as keyof TestPlanRequest]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Convert targets format
    const targets: ExecutionTarget[] | undefined = body.targets?.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      context: t.context,
    }));

    // Build ExecutionPlan
    const plan = buildExecutionPlan({
      missionId: body.missionId,
      title: body.title,
      companyContext: body.companyContext,
      missionObjective: body.missionObjective,
      desiredOutcome: body.desiredOutcome,
      priority: body.priority || "NORMAL",
      targets,
      assumptions: body.assumptions,
      risks: body.risks,
      successCriteria: body.successCriteria || "Mission objectives achieved",
    });

    // Dispatch the plan
    const dispatched = await dispatchExecutionPlan(plan);

    // Build summary
    const summary = buildExecutionPlanSummary(
      plan,
      dispatched.briefs,
      dispatched.dispatchResults
    );

    return NextResponse.json({
      success: true,
      plan: dispatched.plan,
      briefs: dispatched.briefs,
      workerSelections: dispatched.workerSelections,
      dispatchResults: dispatched.dispatchResults,
      summary,
      planSummary: summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
