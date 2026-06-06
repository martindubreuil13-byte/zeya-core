// GET /api/outcomes/[conversationId] — Get CallOutcome for specific conversation

import { NextRequest, NextResponse } from "next/server";
import { getOutcomeByConversationId } from "@/lib/voice/outcomes/call-outcome-processor";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Invalid conversation ID" },
        { status: 400 }
      );
    }

    const outcome = getOutcomeByConversationId(conversationId);

    if (!outcome) {
      return NextResponse.json(
        { error: "Outcome not found for this conversation" },
        { status: 404 }
      );
    }

    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
