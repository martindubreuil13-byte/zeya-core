import { NextRequest, NextResponse } from "next/server";

import { prepareDemoExperience, type DemoDiscoveryInput } from "@/lib/demo-experience";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DemoDiscoveryInput;
    const prepared = prepareDemoExperience(body);

    return NextResponse.json({
      success: true,
      session: prepared.session,
      workerBrief: prepared.workerBrief,
      zeyaMessage: prepared.zeyaMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.endsWith("is required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
