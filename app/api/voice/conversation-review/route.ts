import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext, isUuid } from "@/lib/representation/api-auth";
import { listReviewConversations, promoteCandidate, recordReviewDecision } from "@/lib/voice/conversation-review/repository";
import { promotionTargets, reviewDecisions } from "@/lib/voice/conversation-review/types";

function failed(status: number, error: string) { return NextResponse.json({ success: false, error }, { status }); }

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const businessId = request.nextUrl.searchParams.get("businessId") ?? "";
  if (!isUuid(businessId)) return failed(400, "Invalid request");
  try { return NextResponse.json({ success: true, data: await listReviewConversations(auth.supabase, businessId) }); }
  catch { return failed(500, "Review conversations could not be loaded"); }
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!isUuid(String(body.candidateId ?? "")) || !isUuid(String(body.requestKey ?? ""))) return failed(400, "Invalid request");
    if (body.action === "review" && reviewDecisions.includes(body.decision as never) && body.decision !== "accepted_for_promotion") {
      const data = await recordReviewDecision(auth.supabase, { candidateId: String(body.candidateId), requestKey: String(body.requestKey), decision: body.decision as "deferred" | "rejected" | "duplicate" | "acknowledged", reason: typeof body.reason === "string" ? body.reason : undefined });
      return NextResponse.json({ success: true, data }, { status: 201 });
    }
    if (body.action === "promote" && promotionTargets.includes(body.targetType as never) && typeof body.statement === "string" && body.statement.trim()) {
      if ("evidenceSourceType" in body && body.evidenceSourceType === null) return failed(400, "Invalid review action");
      const data = await promoteCandidate(auth.supabase, { candidateId: String(body.candidateId), requestKey: String(body.requestKey), targetType: body.targetType as typeof promotionTargets[number], confirmedContent: { statement: body.statement.trim(), ...(typeof body.elementKey === "string" ? { elementKey: body.elementKey } : {}) }, reason: typeof body.reason === "string" ? body.reason : undefined, relatedElementId: typeof body.relatedElementId === "string" ? body.relatedElementId : undefined, evidenceSourceType: typeof body.evidenceSourceType === "string" ? body.evidenceSourceType : undefined });
      return NextResponse.json({ success: true, data }, { status: 201 });
    }
    return failed(400, "Invalid review action");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "23505") return failed(409, "Review action conflicts with existing history");
    if (code === "PZ404" || code === "42501") return failed(404, "Conversation candidate not found");
    if (code === "22023") return failed(400, "Candidate is not eligible for this action");
    return failed(500, "Review action failed");
  }
}
