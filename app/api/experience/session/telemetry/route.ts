import { NextRequest, NextResponse } from "next/server";
import { createExperienceServiceClient, findExperienceSession, isPlausibleExperienceToken } from "@/lib/experience/public-session-server";

const COLUMNS = {
  browser_detected_completion: "browser_detected_completion_at",
  first_visible_acknowledgement: "first_visible_acknowledgement_at",
  reflection_started: "reflection_started_at",
  brief_displayed: "brief_displayed_at",
  first_post_call_voice_started: "first_post_call_voice_started_at",
} as const;

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!isPlausibleExperienceToken(token)) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  let body: { event?: unknown };
  try { body = await request.json() as { event?: unknown }; } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  if (typeof body.event !== "string" || !(body.event in COLUMNS)) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  try {
    const db = createExperienceServiceClient();
    const session = await findExperienceSession(db, token);
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const column = COLUMNS[body.event as keyof typeof COLUMNS];
    const update = await db.from("public_experience_test_records").update({ [column]: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("public_experience_session_id", session.id).is(column, null);
    if (update.error) throw update.error;
    return NextResponse.json({ recorded: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Telemetry unavailable." }, { status: 503 });
  }
}
