// POST /api/operational-intelligence/test-dispatch
// Test endpoint for operational intelligence dispatch

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchOperationalMission, buildOperationalDispatchSummary } from "@/lib/operational-intelligence";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface TestDispatchRequest {
  businessId: string;
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
    const required = ["businessId", "missionId", "companyContext", "missionContext", "desiredOutcome"];
    for (const field of required) {
      if (!(field in body) || !body[field as keyof TestDispatchRequest]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate business exists
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", body.businessId)
      .single();

    if (businessError || !business) {
      return NextResponse.json(
        { error: `Business not found: ${body.businessId}` },
        { status: 404 }
      );
    }

    // Dispatch with operational intelligence
    const dispatched = await dispatchOperationalMission({
      businessId: body.businessId,
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
