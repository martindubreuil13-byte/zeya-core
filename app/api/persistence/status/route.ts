// GET /api/persistence/status — Persistence status and statistics

import { NextResponse } from "next/server";
import { getPersistenceStats } from "@/lib/voice/persistence/persistence-manager";

export async function GET() {
  try {
    const stats = await getPersistenceStats();

    return NextResponse.json({
      status: "operational",
      outcomes: stats.outcomes,
      memoryEvents: stats.memoryEvents,
      total: stats.total,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        status: "error",
        message,
      },
      { status: 500 }
    );
  }
}
