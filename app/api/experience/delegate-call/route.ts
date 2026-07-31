import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWorkerBrief, dispatchWorkerBrief } from "@/lib/workers";
import type { ProviderType } from "@/lib/providers";
import type { VeyaDelegationResponse } from "@/lib/dispatch/veya-delegation-types";
import { attachVoiceProviderIdentifiers } from "@/lib/voice/persistence/representation-lineage-repository";
import { isNewPublicExperienceDispatchReservation } from "@/lib/experience/public-dispatch-reservation";
import { publicExperienceSpokenName } from "@/lib/experience/public-identity";
import { planPublicExperienceVeyaConversation } from "@/lib/experience/public-veya-brief";
import {
  createExperienceServiceClient,
  findExperienceSession,
  hashExperiencePhone,
  isExpired,
  isPlausibleExperienceToken,
  type PublicExperienceSessionRow,
} from "@/lib/experience/public-session-server";

type RequestBody = { experienceToken?: unknown; phone?: unknown; name?: unknown; business?: unknown; customer?: unknown; conversationSummary?: unknown; relevantDetail?: unknown };
type DurableProviderIdentity = { voiceContextId: string; conversationId: string | null; providerCallId: string };
const E164 = /^\+[1-9]\d{7,14}$/;
const MAX_REQUEST_BYTES = 8_192;

function text(value: unknown, limit: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function response(status: VeyaDelegationResponse["status"], success: boolean, httpStatus = 200) {
  return NextResponse.json({ success, status, message: status === "call_dispatched"
    ? "The call was accepted."
    : status === "correlation_pending"
      ? "The call was accepted and is still being confirmed."
      : status === "dispatch_resolution_pending"
        ? "The previous call request is still being resolved."
      : "The call could not be prepared. Please try again shortly." }, { status: httpStatus });
}

function fail(error: string, status: number, outcome: VeyaDelegationResponse["status"] = "failed") {
  return NextResponse.json({ success: false, status: outcome, error }, { status });
}

async function findDurableProviderIdentity(
  db: SupabaseClient,
  session: PublicExperienceSessionRow,
): Promise<DurableProviderIdentity | null> {
  if (session.veya_voice_context_id && session.provider_call_id) {
    return {
      voiceContextId: session.veya_voice_context_id,
      conversationId: session.provider_conversation_id,
      providerCallId: session.provider_call_id,
    };
  }
  if (!session.dispatch_id) return null;
  const lineage = await db.from("voice_representation_lineage")
    .select("voice_context_id,conversation_id,provider_call_id")
    .eq("mission_id", session.dispatch_id)
    .eq("business_id", session.business_id)
    .neq("voice_context_id", session.zeya_voice_context_id)
    .maybeSingle();
  if (lineage.error || !lineage.data?.provider_call_id) return null;
  return {
    voiceContextId: lineage.data.voice_context_id as string,
    conversationId: lineage.data.conversation_id as string | null,
    providerCallId: lineage.data.provider_call_id as string,
  };
}

async function recoverCorrelation(
  db: SupabaseClient,
  session: PublicExperienceSessionRow,
): Promise<boolean> {
  if (!session.dispatch_id) return false;
  const identity = await findDurableProviderIdentity(db, session);
  if (!identity) return false;
  const pending = await db.rpc("zeya_record_public_experience_provider_acceptance", {
    p_token_hash: session.token_hash,
    p_dispatch_id: session.dispatch_id,
    p_veya_voice_context_id: identity.voiceContextId,
    p_provider_conversation_id: identity.conversationId,
    p_provider_call_id: identity.providerCallId,
  });
  if (pending.error) return false;
  try {
    await attachVoiceProviderIdentifiers({ db, ...identity });
  } catch {
    return false;
  }
  const correlated = await db.rpc("zeya_record_public_experience_dispatch", {
    p_token_hash: session.token_hash,
    p_dispatch_id: session.dispatch_id,
    p_veya_voice_context_id: identity.voiceContextId,
    p_provider_conversation_id: identity.conversationId,
  });
  return !correlated.error;
}

async function markDispatchResolutionPending(
  db: SupabaseClient,
  session: PublicExperienceSessionRow,
  phoneHash: string,
) {
  if (!session.dispatch_id) return false;
  const marked = await db.rpc("zeya_mark_public_experience_dispatch_resolution_pending", {
    p_token_hash: session.token_hash,
    p_dispatch_id: session.dispatch_id,
    p_phone_hash: phoneHash,
    p_expected_state: "call_requested",
  });
  return !marked.error && marked.data === "dispatch_resolution_pending";
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

  let db: SupabaseClient;
  try {
    db = createExperienceServiceClient();
  } catch {
    return fail("The call service is unavailable. Please try again shortly.", 503, "retryable");
  }
  let session: PublicExperienceSessionRow | null = null;
  let dispatchId: string | null = null;
  let phoneHash: string | null = null;
  let providerAccepted = false;
  try {
    session = await findExperienceSession(db, body.experienceToken);
    if (!session || isExpired(session)) return fail("Experience session not found.", 404);
    phoneHash = hashExperiencePhone(body.experienceToken, phone);
    if (session.phone_hash && session.phone_hash !== phoneHash) {
      return fail("A different call request already exists for this session.", 409, "conflict");
    }
    if (["call_dispatched", "call_active", "reflection_ready"].includes(session.state)) {
      return response("call_dispatched", true);
    }
    if (session.state === "call_correlation_pending") {
      const recovered = await recoverCorrelation(db, session);
      return response(recovered ? "call_dispatched" : "correlation_pending", recovered, recovered ? 200 : 202);
    }
    if (session.state === "dispatch_resolution_pending") {
      const recovered = await recoverCorrelation(db, session);
      return response(recovered ? "call_dispatched" : "dispatch_resolution_pending", recovered, recovered ? 200 : 202);
    }
    if (session.state === "call_requested") {
      const recovered = await recoverCorrelation(db, session);
      if (recovered) return response("call_dispatched", true);
      const marked = await markDispatchResolutionPending(db, session, phoneHash);
      return marked ? response("dispatch_resolution_pending", false, 202) : response("failed", false, 500);
    }
    if (session.state !== "zeya_finalized" || !session.zeya_conversation_output_id) {
      return fail("Finish the Zeya conversation before requesting a call.", 409, "conflict");
    }

    dispatchId = `experience_${crypto.randomUUID()}`;
    const requested = await db.rpc("zeya_request_public_experience_call", {
      p_token_hash: session.token_hash, p_dispatch_id: dispatchId, p_phone_hash: phoneHash,
    });
    if (requested.error) return fail("The call request conflicts with this session.", 409, "conflict");
    if (!isNewPublicExperienceDispatchReservation(session.state, requested.data)) {
      return response("failed", false, 500);
    }

    const name = publicExperienceSpokenName(text(body.name, 100));
    const business = text(body.business, 500);
    const customer = text(body.customer, 500);
    const conversationSummary = text(body.conversationSummary, 700);
    const relevantDetail = text(body.relevantDetail, 300);
    const adaptiveInput = { name, conversationSummary, offer: business, customer, relevantDetail };
    const conversationPlan = planPublicExperienceVeyaConversation(adaptiveInput);
    const brief = buildWorkerBrief({
      missionId: dispatchId,
      workerType: "CALLER",
      companyContext: [business && `Business: ${business}.`, customer && `Customer: ${customer}.`].filter(Boolean).join(" ") || "Zeya completed an introductory experience with this visitor.",
      leadContext: name ? `Visitor name: ${name}.` : undefined,
      objective: conversationPlan.privateGuidance,
      desiredOutcome: "The visitor experiences a natural contextual continuation and indicates interested, uncertain, or not interested.",
      keyQuestions: conversationPlan.coreQuestions,
      objectionGuidance: ["Acknowledge the answer in one short sentence.", "Do not introduce new topics."],
      escalationRules: ["Ask three core questions in order.", "Allow no more than one meaningful adaptive follow-up.", "Enter the fixed completion state and end immediately."],
      successCriteria: "Continuity is established, three core topics are explored, interest level is understood, and the visitor is handed back to Zeya cleanly.",
      toneGuidance: "Warm, natural, curious, and professional. Pronounce the visitor name normally; never spell it. Avoid sales language.",
      dynamicVariables: {
        target: name, visitorName: name, business, customer,
        source: "zeya_experience", zeyaConversationOccurred: true,
        hasTargetPhone: true, conversationSummary, relevantDetail,
        primaryQuestion: conversationPlan.primaryQuestion,
        missionObjective: conversationPlan.opening,
        deterministicClosing: conversationPlan.closing,
        maxCoreQuestions: 3,
        maxAdaptiveFollowUps: 1,
        toolsAllowed: false,
      },
    });
    const provider: ProviderType = process.env.PUBLIC_EXPERIENCE_PROVIDER === "MOCK" ? "MOCK" : "ELEVENLABS";
    const result = await dispatchWorkerBrief(brief, provider, session.business_id, {
      transientTargetPhone: phone,
      representationSnapshot: {
        tenantUserId: session.tenant_user_id,
        businessRepresentationId: session.business_representation_id,
        canonicalVersionId: session.canonical_version_id,
        representationContextMode: session.representation_context_mode,
      },
    });
    providerAccepted = result.providerOutcome !== "REJECTED";
    if (result.providerOutcome === "REJECTED") {
      const reset = await db.rpc("zeya_reset_public_experience_call_request", {
        p_token_hash: session.token_hash, p_dispatch_id: dispatchId,
      });
      const marked = reset.error
        ? await markDispatchResolutionPending(db, { ...session, dispatch_id: dispatchId }, phoneHash)
        : false;
      return reset.error
        ? marked ? response("dispatch_resolution_pending", false, 202) : response("failed", false, 500)
        : response("retryable", false, 502);
    }
    if (!result.voiceContextId || !result.providerCallId || !result.conversationId) {
      const marked = await markDispatchResolutionPending(db, { ...session, dispatch_id: dispatchId }, phoneHash);
      return marked ? response("dispatch_resolution_pending", false, 202) : response("failed", false, 500);
    }

    const pending = await db.rpc("zeya_record_public_experience_provider_acceptance", {
      p_token_hash: session.token_hash,
      p_dispatch_id: dispatchId,
      p_veya_voice_context_id: result.voiceContextId,
      p_provider_conversation_id: result.conversationId ?? null,
      p_provider_call_id: result.providerCallId,
    });
    if (pending.error) {
      const marked = await markDispatchResolutionPending(db, { ...session, dispatch_id: dispatchId }, phoneHash);
      return marked ? response("dispatch_resolution_pending", false, 202) : response("failed", false, 500);
    }
    if (result.providerOutcome !== "ACCEPTED_CORRELATED") {
      return response("correlation_pending", false, 202);
    }
    const correlated = await db.rpc("zeya_record_public_experience_dispatch", {
      p_token_hash: session.token_hash, p_dispatch_id: dispatchId,
      p_veya_voice_context_id: result.voiceContextId,
      p_provider_conversation_id: result.conversationId ?? null,
    });
    if (correlated.error) return response("correlation_pending", false, 202);
    return response("call_dispatched", true);
  } catch {
    if (session && dispatchId && phoneHash && !providerAccepted) {
      const reset = await db.rpc("zeya_reset_public_experience_call_request", {
        p_token_hash: session.token_hash, p_dispatch_id: dispatchId,
      });
      if (reset.error) {
        await markDispatchResolutionPending(db, { ...session, dispatch_id: dispatchId }, phoneHash);
      }
    }
    return fail("The call could not be prepared. Please try again shortly.", 500, "retryable");
  }
}
