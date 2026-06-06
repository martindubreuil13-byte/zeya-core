// POST /api/workers/test-brief
// Test endpoint for WorkerBrief generation and dispatch

import { NextRequest, NextResponse } from "next/server";
import {
  buildWorkerBrief,
  selectWorkerForBrief,
  dispatchWorkerBrief,
  buildWorkerBriefSummary,
} from "@/lib/workers";

interface TestBriefRequest {
  missionId: string;
  companyContext: string;
  leadContext?: string;
  objective: string;
  desiredOutcome: string;
  keyQuestions?: string[];
  objectionGuidance?: string[];
  escalationRules?: string[];
  successCriteria?: string;
  toneGuidance?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestBriefRequest;

    // Validate required fields
    const required = ["missionId", "companyContext", "objective", "desiredOutcome"];
    for (const field of required) {
      if (!(field in body) || !body[field as keyof TestBriefRequest]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Build WorkerBrief for CALLER type
    const brief = buildWorkerBrief({
      missionId: body.missionId,
      workerType: "CALLER",
      companyContext: body.companyContext,
      leadContext: body.leadContext,
      objective: body.objective,
      desiredOutcome: body.desiredOutcome,
      keyQuestions: body.keyQuestions || [],
      objectionGuidance: body.objectionGuidance || [],
      escalationRules: body.escalationRules || [],
      successCriteria: body.successCriteria || "Task completed successfully",
      toneGuidance: body.toneGuidance,
    });

    // Select worker
    const selection = selectWorkerForBrief(brief);

    // Dispatch through provider boundary
    const dispatchResult = await dispatchWorkerBrief(brief);

    // Build summary
    const summary = buildWorkerBriefSummary(brief, dispatchResult);

    return NextResponse.json({
      success: true,
      brief,
      workerSelection: selection,
      dispatchResult,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
