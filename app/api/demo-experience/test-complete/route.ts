import { NextRequest, NextResponse } from "next/server";

import { completeDemoExperience, type DemoDiscoverySession } from "@/lib/demo-experience";
import type { CallOutcome } from "@/lib/call-outcomes";
import type { WorkerBrief } from "@/lib/workers";

interface TestCompleteRequest {
  session: DemoDiscoverySession;
  workerBrief: WorkerBrief;
  callOutcome?: CallOutcome;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestCompleteRequest;

    if (!body.session) {
      return NextResponse.json({ error: "session is required" }, { status: 400 });
    }
    if (!body.workerBrief) {
      return NextResponse.json({ error: "workerBrief is required" }, { status: 400 });
    }

    const completed = completeDemoExperience(body.session, body.workerBrief, body.callOutcome);

    return NextResponse.json({
      success: true,
      debrief: completed.debrief,
      learningPatterns: completed.learningPatterns,
      finalZeyaMessage: completed.finalZeyaMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
