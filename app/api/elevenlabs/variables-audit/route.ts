import { NextResponse } from "next/server";

/**
 * Retired diagnostic endpoint.
 *
 * The former implementation accepted and echoed provider variables, business
 * context, prompts, and phone numbers. Keeping that behavior available behind
 * an environment flag would still leave an unnecessary disclosure path, so the
 * endpoint is permanently closed.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Diagnostic endpoint is unavailable." },
    { status: 410 },
  );
}
