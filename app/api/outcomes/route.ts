// GET /api/outcomes — Get all CallOutcomes and statistics

import { NextResponse } from "next/server";
import { getAllOutcomes, getOutcomeStats } from "@/lib/voice/outcomes/call-outcome-processor";

export async function GET() {
  try {
    const outcomes = getAllOutcomes();
    const stats = getOutcomeStats();

    return NextResponse.json({
      totalOutcomes: outcomes.length,
      outcomes: outcomes,
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
