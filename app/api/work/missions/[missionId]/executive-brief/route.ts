import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";
import { ExecutiveBriefError, getPostCallExecutiveBrief } from "@/lib/work/post-call-executive-brief";
import { isUuid } from "@/lib/work/operating-spine";

export async function GET(request: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const { missionId } = await params;
  if (!isUuid(missionId)) return NextResponse.json({ success: false, error: "invalid_mission_id" }, { status: 400 });
  try {
    const data = await getPostCallExecutiveBrief(createExperienceServiceClient(), auth.user.id, missionId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ExecutiveBriefError) {
      if (error.code === "mission_not_found") return NextResponse.json({ success: false, error: "mission_not_found" }, { status: 404 });
      if (error.code === "not_ready") return NextResponse.json({ success: false, error: "executive_brief_not_ready" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: "executive_brief_unavailable" }, { status: 409 });
  }
}
