// POST /api/webhooks/elevenlabs — ElevenLabs webhook receiver

import { NextRequest, NextResponse } from "next/server";
import { isValidElevenLabsEvent } from "@/lib/voice/events/elevenlabs-event-validator";
import { processElevenLabsEvent } from "@/lib/voice/events/elevenlabs-event-processor";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Validate event structure
    if (!isValidElevenLabsEvent(payload)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid event structure",
        },
        { status: 400 }
      );
    }

    // Process the event
    const result = processElevenLabsEvent(payload);

    return NextResponse.json(
      {
        success: result.success,
        eventType: result.eventType,
        sessionId: result.sessionId,
        message: result.message,
      },
      { status: result.success ? 200 : 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
