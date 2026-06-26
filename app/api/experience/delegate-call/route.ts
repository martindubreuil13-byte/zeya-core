import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { buildWorkerBrief, dispatchWorkerBrief } from "@/lib/workers";
import type {
  VeyaBriefingPayload,
  VeyaDelegationResponse,
} from "@/lib/dispatch/veya-delegation-types";

interface DelegateCallRequest {
  briefing?: Partial<VeyaBriefingPayload>;
  dispatchId?: string;
}

type RateLimitEntry = { count: number; resetAt: number };

const VEYA_OPENING =
  "Hi, this is Veya. Zeya asked me to continue the conversation with you for a moment. She shared the context of what you discussed. I’d like to understand one thing better: if Zeya were representing your business, what kind of conversations would matter most to you?";
const MAX_REQUEST_BYTES = 8_192;
const ANONYMOUS_RATE_LIMIT = 3;
const ANONYMOUS_RATE_WINDOW_MS = 15 * 60 * 1_000;
const ANONYMOUS_PHONE_COOLDOWN_MS = 10 * 60 * 1_000;
const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Development-safe only. Serverless instances do not share this state; production
// must use a shared rate-limit store before relying on these limits as a hard quota.
const anonymousIpLimits = new Map<string, RateLimitEntry>();
const anonymousPhoneCooldowns = new Map<string, number>();

function nullableText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const message = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === "string" && Boolean(part))
      .join(" | ");

    return {
      message: message || JSON.stringify(error),
      code: value.code,
      details: value.details,
      hint: value.hint,
    };
  }

  return { message: String(error) };
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

function checkAnonymousLimits(ip: string, phone: string, now = Date.now()) {
  for (const [key, entry] of anonymousIpLimits) {
    if (entry.resetAt <= now) anonymousIpLimits.delete(key);
  }
  for (const [key, expiresAt] of anonymousPhoneCooldowns) {
    if (expiresAt <= now) anonymousPhoneCooldowns.delete(key);
  }

  const current = anonymousIpLimits.get(ip);
  if (current && current.resetAt > now && current.count >= ANONYMOUS_RATE_LIMIT) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
      reason: "Too many call requests. Please wait before trying again.",
    };
  }

  const phoneAvailableAt = anonymousPhoneCooldowns.get(phone);
  if (phoneAvailableAt && phoneAvailableAt > now) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((phoneAvailableAt - now) / 1_000)),
      reason: "A call was recently requested for this number. Please wait before trying again.",
    };
  }

  anonymousIpLimits.set(ip, current && current.resetAt > now
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: now + ANONYMOUS_RATE_WINDOW_MS });
  anonymousPhoneCooldowns.set(phone, now + ANONYMOUS_PHONE_COOLDOWN_MS);
  return { allowed: true as const };
}

function safeProviderError(message: string, phone: string): string {
  return message.replaceAll(phone, "[redacted phone]").slice(0, 500);
}

function jsonFailure(error: string, status: number, retryAfterSeconds?: number) {
  const response = NextResponse.json(
    { success: false, status: "failed", error },
    { status },
  );
  if (retryAfterSeconds) response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const authorization = req.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const contentLength = Number(req.headers.get("content-length") || "0");

  console.log("[veya-delegation] request received", {
    requestId,
    authenticationMode: accessToken ? "bearer" : "anonymous",
  });

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonFailure("The call request is too large.", 413);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonFailure("Call dispatch is not configured.", 500);
  }

  let body: DelegateCallRequest;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonFailure("The call request is too large.", 413);
    }
    body = JSON.parse(rawBody) as DelegateCallRequest;
  } catch (error) {
    const failure = errorDetails(error);
    console.error("[veya-delegation] request parsing failed", { requestId, ...failure });
    return jsonFailure("The call request was not valid JSON.", 400);
  }

  const phone = nullableText(body.briefing?.phone, 32);
  if (!phone) return jsonFailure("Phone number is required.", 400);
  if (!E164_PHONE.test(phone)) {
    return jsonFailure("Enter a valid international phone number, including + and country code.", 400);
  }

  const briefing: VeyaBriefingPayload = {
    name: nullableText(body.briefing?.name, 100),
    business: nullableText(body.briefing?.business, 500),
    customer: nullableText(body.briefing?.customer, 500),
    phone,
    source: "zeya_experience",
    createdAt: new Date().toISOString(),
  };

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let authenticatedUser: User | null = null;
  if (accessToken) {
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user) return jsonFailure("Your session is no longer valid. Please sign in again.", 401);
    authenticatedUser = data.user;
  }

  const isAnonymous = !authenticatedUser;
  const demoBusinessId = process.env.ZEYA_EXPERIENCE_BUSINESS_ID?.trim();
  if (isAnonymous) {
    if (!demoBusinessId || !UUID.test(demoBusinessId)) {
      return jsonFailure("Anonymous Experience calls are not configured.", 503);
    }

    const limit = checkAnonymousLimits(clientIp(req), phone);
    if (!limit.allowed) return jsonFailure(limit.reason, 429, limit.retryAfterSeconds);
  }

  let serverDispatchRowId: string | null = null;
  let dispatchId = body.dispatchId || `zeya_experience_${Date.now()}`;
  let businessId: string;

  try {
    if (authenticatedUser) {
      const { data: businesses, error: businessLookupError } = await db
        .from("businesses")
        .select("id")
        .eq("user_id", authenticatedUser.id)
        .limit(1);
      if (businessLookupError) throw businessLookupError;

      const existingBusinessId = businesses?.[0]?.id as string | undefined;
      if (existingBusinessId) {
        businessId = existingBusinessId;
      } else {
        const { data: createdBusiness, error: createBusinessError } = await db
          .from("businesses")
          .insert({
            user_id: authenticatedUser.id,
            business_name: briefing.business,
            industry: null,
            business_profile: {},
            memory_summary: null,
          })
          .select("id")
          .single();
        if (createBusinessError) throw createBusinessError;
        businessId = createdBusiness.id as string;
      }
    } else {
      businessId = demoBusinessId as string;
      const { data: demoBusiness, error: demoBusinessError } = await db
        .from("businesses")
        .select("id")
        .eq("id", businessId)
        .maybeSingle();
      if (demoBusinessError) throw demoBusinessError;
      if (!demoBusiness) return jsonFailure("The Experience call tenant is not configured correctly.", 503);

      // Anonymous callers cannot choose or reuse a dispatch identifier.
      dispatchId = `experience_${crypto.randomUUID()}`;
      const agentBrief = {
        visitor_name: briefing.name || "Unknown",
        business_summary: `${briefing.name || "The visitor"} sells ${briefing.business || "an unspecified offer"} to ${briefing.customer || "an unspecified customer"}.`,
        outreach_objective: "Demonstrate how Zeya helps businesses create more customer conversations.",
        call_context: {
          offer: briefing.business || "Unknown",
          target_market: briefing.customer || "Unknown",
        },
        instructions: "Be warm and natural. Continue the Experience delegation without inventing missing details.",
      };
      const { data: dispatch, error: dispatchCreateError } = await db
        .from("dispatches")
        .insert({
          dispatch_id: dispatchId,
          business_id: businessId,
          visitor_name: briefing.name || "Unknown",
          phone_number: phone,
          business_offer: briefing.business || "Unknown",
          target_buyer: briefing.customer || "Unknown",
          agent_brief: agentBrief,
          status: "draft",
          execution_package: {
            source: "experience_conversation",
            anonymous: true,
            request_id: requestId,
            business_id: businessId,
          },
        })
        .select("id")
        .single();
      if (dispatchCreateError) throw dispatchCreateError;
      serverDispatchRowId = dispatch.id as string;
    }

    const knownContext = [
      briefing.business ? `Business: ${briefing.business}.` : null,
      briefing.customer ? `Customer: ${briefing.customer}.` : null,
    ].filter((value): value is string => Boolean(value));
    const objective = `Open with exactly: ${JSON.stringify(VEYA_OPENING)} Then continue briefly and naturally, using only the supplied context. The goal is to demonstrate that Zeya delegated this conversation to Veya.`;
    const brief = buildWorkerBrief({
      missionId: dispatchId,
      workerType: "CALLER",
      companyContext: knownContext.join(" ") || "Zeya completed an introductory experience with this visitor.",
      leadContext: briefing.name ? `Visitor name: ${briefing.name}.` : undefined,
      objective,
      desiredOutcome: "The visitor experiences a clear, continuous handoff from Zeya to Veya.",
      keyQuestions: ["Do you have two minutes?"],
      objectionGuidance: ["If now is not a good time, acknowledge it and end the call politely."],
      escalationRules: ["Do not invent business details that were not supplied by Zeya."],
      successCriteria: "The visitor recognizes that Veya received Zeya’s brief and continued the delegation.",
      toneGuidance: "Warm, concise, and natural. This is a continuity demonstration, not a qualification call.",
      dynamicVariables: {
        target: briefing.name,
        targetPhone: briefing.phone,
        visitorName: briefing.name,
        business: briefing.business,
        customer: briefing.customer,
        source: briefing.source,
        zeyaConversationOccurred: true,
        veyaOpening: VEYA_OPENING,
      },
    });

    console.log("[veya-delegation] dispatch invoked", {
      requestId,
      dispatchId,
      workerBriefId: brief.id,
      businessId,
      authenticationMode: isAnonymous ? "anonymous" : "authenticated",
      provider: "ELEVENLABS",
    });
    const dispatchResult = await dispatchWorkerBrief(brief, "ELEVENLABS", businessId);
    const update = dispatchResult.status === "DISPATCHED"
      ? { status: "calling", worker_brief_id: brief.id }
      : { status: "failed", worker_brief_id: brief.id };

    let dispatchUpdateError: { message: string; code?: string } | null = null;
    if (authenticatedUser && body.dispatchId) {
      const { error } = await db.from("dispatches").update(update)
        .eq("dispatch_id", body.dispatchId)
        .eq("business_id", businessId);
      dispatchUpdateError = error;
    } else if (serverDispatchRowId) {
      const { error } = await db.from("dispatches").update(update)
        .eq("id", serverDispatchRowId)
        .eq("dispatch_id", dispatchId);
      dispatchUpdateError = error;
    }
    if (dispatchUpdateError) {
      console.warn("[veya-delegation] dispatch status update failed", {
        requestId,
        dispatchId,
        code: dispatchUpdateError.code,
        error: dispatchUpdateError.message,
      });
    }

    if (dispatchResult.status !== "DISPATCHED") {
      const providerError = safeProviderError(dispatchResult.message, phone);
      console.error("[veya-delegation] provider dispatch failed", {
        requestId,
        dispatchId,
        workerBriefId: brief.id,
        provider: dispatchResult.providerType,
        error: providerError,
      });
      const response: VeyaDelegationResponse = {
        success: false,
        status: "failed",
        briefing,
        dispatchId,
        workerBriefId: brief.id,
        provider: dispatchResult.providerType,
        providerCallId: dispatchResult.providerCallId,
        error: providerError,
      };
      return NextResponse.json(response, { status: 502 });
    }

    console.log("[veya-delegation] success", {
      requestId,
      dispatchId,
      workerBriefId: brief.id,
      provider: dispatchResult.providerType,
      providerCallId: dispatchResult.providerCallId,
    });
    const response: VeyaDelegationResponse = {
      success: true,
      status: "call_requested",
      briefing,
      dispatchId,
      workerBriefId: brief.id,
      provider: dispatchResult.providerType,
      providerCallId: dispatchResult.providerCallId,
    };
    return NextResponse.json(response);
  } catch (error) {
    const failure = errorDetails(error);
    console.error("[veya-delegation] route failure", { requestId, dispatchId, ...failure });
    return jsonFailure("The call could not be prepared. Please try again shortly.", 500);
  }
}
