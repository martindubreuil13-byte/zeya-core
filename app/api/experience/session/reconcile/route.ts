import { NextRequest, NextResponse } from "next/server";
import { reconcilePublicExperienceCall } from "@/lib/experience/public-call-reconciliation";
import { createExperienceServiceClient, findExperienceSession, isPlausibleExperienceToken, publicSessionState } from "@/lib/experience/public-session-server";

export async function POST(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!isPlausibleExperienceToken(token)) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
  try {
    const db = createExperienceServiceClient();
    let session = await findExperienceSession(db, token);
    if (!session) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
    await reconcilePublicExperienceCall(session);
    session = await findExperienceSession(db, token);
    if (!session) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
    return NextResponse.json({ status: publicSessionState(session), expiresAt: session.expires_at });
  } catch {
    return NextResponse.json({ error: "Experience status is unavailable." }, { status: 503 });
  }
}
