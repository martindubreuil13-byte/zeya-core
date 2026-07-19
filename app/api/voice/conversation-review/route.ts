import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext, isUuid } from "@/lib/representation/api-auth";
import { canonicalizeConversationCandidate, listReviewConversations, promoteCandidate, recordReviewDecision } from "@/lib/voice/conversation-review/repository";
import { promotionTargets, reviewDecisions } from "@/lib/voice/conversation-review/types";

function failed(status: number, error: string) { return NextResponse.json({ success: false, error }, { status }); }
function canonicalizationFailed(status: number, error: string, message: string) { return NextResponse.json({ success: false, error, message }, { status }); }
function canonicalizationEnabled() { return process.env.ZEYA_VOICE_LEARNING_ENABLED === "true"; }

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const businessId = request.nextUrl.searchParams.get("businessId") ?? "";
  if (!isUuid(businessId)) return failed(400, "Invalid request");
  try {
    const enabled = canonicalizationEnabled() && isUuid(process.env.ZEYA_EXPERIENCE_BUSINESS_ID ?? "") && businessId === process.env.ZEYA_EXPERIENCE_BUSINESS_ID;
    return NextResponse.json({ success: true, data: await listReviewConversations(auth.supabase, businessId), canonicalizationEnabled: enabled });
  }
  catch { return failed(500, "Review conversations could not be loaded"); }
}

export async function POST(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  let action = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    action = String(body.action ?? "");
    if (!isUuid(String(body.candidateId ?? "")) || !isUuid(String(body.requestKey ?? ""))) return failed(400, "Invalid request");
    if (body.action === "canonicalize") {
      if (!canonicalizationEnabled()) return failed(404, "Review action not found");
      const experienceBusinessId = process.env.ZEYA_EXPERIENCE_BUSINESS_ID ?? "";
      if (!isUuid(experienceBusinessId)) return failed(503, "Conversation canonicalization is unavailable");
      const relatedElementId = String(body.relatedElementId ?? "");
      const statement = typeof body.statement === "string" ? body.statement.trim() : "";
      const elementKey = typeof body.elementKey === "string" ? body.elementKey.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const approvalReason = typeof body.approvalReason === "string" ? body.approvalReason.trim() : "";
      const confidenceScore = body.overallConfidenceScore;
      const elementValues = body.elementValues;
      if (!isUuid(relatedElementId) || !statement || !elementKey || !reason || !approvalReason
        || !Number.isInteger(confidenceScore) || Number(confidenceScore) < 0 || Number(confidenceScore) > 100
        || !elementValues || typeof elementValues !== "object" || Array.isArray(elementValues)) return failed(400, "Invalid canonicalization request");
      const business = await auth.supabase.from("businesses").select("id").eq("id", experienceBusinessId).eq("user_id", auth.user.id).maybeSingle();
      if (business.error || !business.data) return failed(404, "Conversation candidate not found");
      const candidate = await auth.supabase.from("voice_conversation_candidates").select("id,business_id").eq("id", String(body.candidateId)).eq("business_id", experienceBusinessId).maybeSingle();
      if (candidate.error || !candidate.data) return failed(404, "Conversation candidate not found");
      const data = await canonicalizeConversationCandidate({
        actorUserId: auth.user.id,
        candidateId: String(body.candidateId), requestKey: String(body.requestKey),
        confirmedContent: { statement, elementKey }, reason, relatedElementId,
        elementValues: elementValues as Record<string, { value: string }>,
        overallConfidenceScore: Number(confidenceScore), approvalReason,
      });
      return NextResponse.json({ success: true, data }, { status: 201 });
    }
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
    const message = error instanceof Error ? error.message : "";
    if (code === "22023" && message === "canonical baseline changed") return canonicalizationFailed(409, "canonical_baseline_changed", "This candidate was reviewed against an older canonical version. Refresh the review and try again.");
    if (code === "42501") return action === "canonicalize" ? failed(403, "Conversation candidate is not eligible for this action") : failed(404, "Conversation candidate not found");
    if (code === "PZ404") return failed(404, "Conversation candidate not found");
    if (code === "22023") return failed(400, "Candidate is not eligible for this action");
    if (["23505", "23514", "55000"].includes(code)) return failed(409, "Review action conflicts with existing history");
    if (code === "CONFIGURATION") return failed(503, "Conversation canonicalization is unavailable");
    return failed(500, "Review action failed");
  }
}
