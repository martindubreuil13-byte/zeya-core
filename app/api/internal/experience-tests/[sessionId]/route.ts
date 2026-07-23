import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext, isUuid } from "@/lib/representation/api-auth";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";
import { buildExperienceTestRecord, experienceTestRecordHtml } from "@/lib/experience/test-record";

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Test session not found." }, { status: 404 });

  try {
    const db = createExperienceServiceClient();
    const sessionResult = await db.from("public_experience_sessions").select("*")
      .eq("id", sessionId).eq("tenant_user_id", auth.user.id).maybeSingle();
    if (sessionResult.error || !sessionResult.data) return NextResponse.json({ error: "Test session not found." }, { status: 404 });
    const session = sessionResult.data;
    const ids = [session.zeya_conversation_output_id, session.veya_conversation_output_id].filter(Boolean);
    const [outputs, brief, stored] = await Promise.all([
      ids.length ? db.from("voice_conversation_outputs").select("id,transcript,started_at,completed_at,completion_reason,safe_metadata").in("id", ids) : Promise.resolve({ data: [] }),
      db.from("public_experience_representation_briefs").select("*").eq("public_experience_session_id", sessionId).maybeSingle(),
      db.from("public_experience_test_records").select("*").eq("public_experience_session_id", sessionId).maybeSingle(),
    ]);
    const rows = outputs.data ?? [];
    const veyaOutput = rows.find((row: { id: string }) => row.id === session.veya_conversation_output_id) ?? null;
    const zeyaOutput = rows.find((row: { id: string }) => row.id === session.zeya_conversation_output_id) ?? null;
    const candidates = session.veya_conversation_output_id
      ? (await db.from("voice_conversation_candidates").select("candidate_type,content,speaker_role,statement_kind,source_reference,relevant_element_keys,confidence,rationale").eq("conversation_output_id", session.veya_conversation_output_id)).data ?? []
      : [];
    const record = buildExperienceTestRecord({ session, zeyaOutput, veyaOutput, brief: brief.data, candidates, storedRecord: stored.data });
    const format = request.nextUrl.searchParams.get("format") === "html" ? "html" : "json";
    const body = format === "html" ? experienceTestRecordHtml(record) : JSON.stringify(record, null, 2);
    return new Response(body, { headers: {
      "Content-Type": format === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zeya-experience-${sessionId}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "The test package is unavailable." }, { status: 503 });
  }
}
