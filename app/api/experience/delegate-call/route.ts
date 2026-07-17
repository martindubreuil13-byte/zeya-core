import { NextRequest, NextResponse } from "next/server";
import { buildWorkerBrief, dispatchWorkerBrief } from "@/lib/workers";
import type { ProviderType } from "@/lib/providers";
import type { VeyaBriefingPayload, VeyaDelegationResponse } from "@/lib/dispatch/veya-delegation-types";
import { createExperienceServiceClient, findExperienceSession, hashExperiencePhone, isExpired, isPlausibleExperienceToken } from "@/lib/experience/public-session-server";

type RequestBody = { experienceToken?: unknown; phone?: unknown; name?: unknown; business?: unknown; customer?: unknown };
const E164 = /^\+[1-9]\d{7,14}$/;
const MAX_REQUEST_BYTES = 8_192;
const VEYA_OPENING = "Hi, this is Veya. Zeya asked me to continue the conversation with you for a moment. She shared the context of what you discussed. I’d like to understand one thing better: if Zeya were representing your business, what kind of conversations would matter most to you?";

function text(value: unknown, limit: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, status: "failed", error }, { status });
}

export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return fail("The call request is too large.", 413);
  let body: RequestBody;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return fail("The call request is too large.", 413);
    body = JSON.parse(raw) as RequestBody;
  } catch { return fail("The call request was not valid JSON.", 400); }

  if (!isPlausibleExperienceToken(body.experienceToken)) return fail("Experience session not found.", 404);
  const phone = text(body.phone, 32);
  if (!phone || !E164.test(phone)) return fail("Enter a valid international phone number, including + and country code.", 400);

  try {
    const db = createExperienceServiceClient();
    const session = await findExperienceSession(db, body.experienceToken);
    if (!session || isExpired(session)) return fail("Experience session not found.", 404);
    const phoneHash = hashExperiencePhone(body.experienceToken, phone);
    if ((session.state === "call_requested" || session.state === "call_dispatched" || session.state === "call_active" || session.state === "reflection_ready") && session.phone_hash === phoneHash) {
      return NextResponse.json({ success: true, status: "call_requested" } satisfies Partial<VeyaDelegationResponse>);
    }
    if (session.dispatch_id) return fail("A different call request already exists for this session.", 409);
    if (session.state !== "zeya_finalized" || !session.zeya_conversation_output_id) return fail("Finish the Zeya conversation before requesting a call.", 409);

    const briefing: VeyaBriefingPayload = {
      name: text(body.name, 100), business: text(body.business, 500), customer: text(body.customer, 500),
      phone, source: "zeya_experience", createdAt: new Date().toISOString(),
    };
    const dispatchId = `experience_${crypto.randomUUID()}`;
    const requested = await db.rpc("zeya_request_public_experience_call", { p_token_hash: session.token_hash, p_dispatch_id: dispatchId, p_phone_hash: phoneHash });
    if (requested.error) throw new Error("call request persistence failed");

    const brief = buildWorkerBrief({
      missionId: dispatchId, workerType: "CALLER",
      companyContext: [briefing.business && `Business: ${briefing.business}.`, briefing.customer && `Customer: ${briefing.customer}.`].filter(Boolean).join(" ") || "Zeya completed an introductory experience with this visitor.",
      leadContext: briefing.name ? `Visitor name: ${briefing.name}.` : undefined,
      objective: `Open with exactly: ${JSON.stringify(VEYA_OPENING)} Then continue briefly and naturally, using only the supplied context.`,
      desiredOutcome: "The visitor experiences a clear, continuous handoff from Zeya to Veya.",
      keyQuestions: ["Do you have two minutes?"], objectionGuidance: ["If now is not a good time, end politely."],
      escalationRules: ["Do not invent business details that were not supplied by Zeya."],
      successCriteria: "The visitor recognizes that Veya received Zeya's brief.", toneGuidance: "Warm, concise, and natural.",
      dynamicVariables: { target: briefing.name, targetPhone: phone, visitorName: briefing.name, business: briefing.business, customer: briefing.customer, source: briefing.source, zeyaConversationOccurred: true, veyaOpening: VEYA_OPENING },
    });
    const provider: ProviderType = process.env.PUBLIC_EXPERIENCE_PROVIDER === "MOCK" ? "MOCK" : "ELEVENLABS";
    const result = await dispatchWorkerBrief(brief, provider, session.business_id);
    const accepted = result.status === "DISPATCHED" || (provider === "MOCK" && result.status === "SIMULATED");
    if (!accepted || !result.voiceContextId) return fail("The call could not be prepared. Please try again shortly.", 502);
    const correlated = await db.rpc("zeya_record_public_experience_dispatch", {
      p_token_hash: session.token_hash, p_dispatch_id: dispatchId,
      p_veya_voice_context_id: result.voiceContextId, p_provider_conversation_id: result.conversationId ?? null,
    });
    if (correlated.error) throw new Error("dispatch correlation failed");
    return NextResponse.json({ success: true, status: "call_requested" } satisfies Partial<VeyaDelegationResponse>);
  } catch {
    return fail("The call could not be prepared. Please try again shortly.", 500);
  }
}
