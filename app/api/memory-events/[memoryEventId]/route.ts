// GET /api/memory-events/[memoryEventId] — Get specific memory event

import { NextRequest, NextResponse } from "next/server";
import { memoryEventStore } from "@/lib/memory/events/memory-event-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ memoryEventId: string }> }
) {
  try {
    const { memoryEventId } = await params;

    if (!memoryEventId || typeof memoryEventId !== "string") {
      return NextResponse.json(
        { error: "Invalid memory event ID" },
        { status: 400 }
      );
    }

    const memoryEvent = memoryEventStore.getMemoryEvent(memoryEventId);

    if (!memoryEvent) {
      return NextResponse.json(
        { error: "Memory event not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(memoryEvent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
