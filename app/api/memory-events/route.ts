// GET /api/memory-events — Get all memory events and statistics

import { NextResponse } from "next/server";
import { getAllMemoryEvents, getMemoryEventStats } from "@/lib/memory/events/memory-event-processor";

export async function GET() {
  try {
    const memoryEvents = getAllMemoryEvents();
    const stats = getMemoryEventStats();

    return NextResponse.json({
      totalMemoryEvents: memoryEvents.length,
      memoryEvents: memoryEvents,
      statistics: stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
