import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildWorkerBrief, dispatchWorkerBrief } from "@/lib/workers";
import type {
  VeyaBriefingPayload,
  VeyaDelegationResponse,
} from "@/lib/dispatch/veya-delegation-types";

interface DelegateCallRequest {
  briefing?: Partial<VeyaBriefingPayload>;
  dispatchId?: string;
}

const VEYA_OPENING =
  "Hi, this is Veya. Zeya asked me to give you a quick call. She mentioned you’re exploring how AI agents can help represent a business and create more conversations. Do you have two minutes?";

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const authorization = req.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  console.log("[veya-delegation] request received", {
    requestId,
    hasAuthorization: Boolean(accessToken),
  });

  if (!accessToken) {
    return NextResponse.json({ success: false, status: "failed", error: "Authentication required." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ success: false, status: "failed", error: "Dispatch persistence is not configured." }, { status: 500 });
  }

  let body: DelegateCallRequest;
  try {
    body = (await req.json()) as DelegateCallRequest;
  } catch (error) {
    const failure = errorDetails(error);
    console.error("[veya-delegation] failure reason", {
      requestId,
      stage: "parse_request",
      ...failure,
    });
    return NextResponse.json({ success: false, status: "failed", error: `Invalid JSON: ${failure.message}` }, { status: 400 });
  }

  const phone = nullableText(body.briefing?.phone);
  if (!phone) {
    return NextResponse.json({ success: false, status: "failed", error: "Phone number is required." }, { status: 400 });
  }

  const briefing: VeyaBriefingPayload = {
    name: nullableText(body.briefing?.name),
    business: nullableText(body.briefing?.business),
    customer: nullableText(body.briefing?.customer),
    phone,
    source: "zeya_experience",
    createdAt: new Date().toISOString(),
  };

  console.log("[veya-delegation] payload created", { requestId, briefing });

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await db.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, status: "failed", briefing, error: "Invalid session." }, { status: 401 });
    }

    const { data: businesses, error: businessLookupError } = await db
      .from("businesses")
      .select("id")
      .eq("user_id", authData.user.id)
      .limit(1);

    if (businessLookupError) throw businessLookupError;

    let businessId = businesses?.[0]?.id as string | undefined;
    if (!businessId) {
      const { data: createdBusiness, error: createBusinessError } = await db
        .from("businesses")
        .insert({
          user_id: authData.user.id,
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

    const missionId = body.dispatchId || `zeya_experience_${Date.now()}`;
    const knownContext = [
      briefing.business ? `Business: ${briefing.business}.` : null,
      briefing.customer ? `Customer: ${briefing.customer}.` : null,
    ].filter((value): value is string => Boolean(value));
    const objective = `Open with exactly: ${JSON.stringify(VEYA_OPENING)} Then continue briefly and naturally, using only the supplied context. The goal is to demonstrate that Zeya delegated this conversation to Veya.`;

    const brief = buildWorkerBrief({
      missionId,
      workerType: "CALLER",
      companyContext:
        knownContext.join(" ") || "Zeya completed an introductory experience with this visitor.",
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

    console.log("[veya-delegation] dispatch requested", {
      requestId,
      dispatchId: body.dispatchId ?? null,
      workerBriefId: brief.id,
      provider: "ELEVENLABS",
    });

    console.log("[veya-delegation] dispatch invoked", {
      requestId,
      workerBriefId: brief.id,
      businessId,
    });
    const dispatchResult = await dispatchWorkerBrief(brief, "ELEVENLABS", businessId);

    if (dispatchResult.status !== "DISPATCHED") {
      console.error("[veya-delegation] failure", {
        requestId,
        stage: "dispatch",
        workerBriefId: brief.id,
        provider: dispatchResult.providerType,
        message: dispatchResult.message,
      });

      if (body.dispatchId) {
        await db
          .from("dispatches")
          .update({ status: "failed", last_error: dispatchResult.message, worker_brief_id: brief.id })
          .eq("dispatch_id", body.dispatchId)
          .eq("user_id", authData.user.id);
      }

      const response: VeyaDelegationResponse = {
        success: false,
        status: "failed",
        briefing,
        workerBriefId: brief.id,
        provider: dispatchResult.providerType,
        providerCallId: dispatchResult.providerCallId,
        error: dispatchResult.message,
      };
      return NextResponse.json(response, { status: 502 });
    }

    if (body.dispatchId) {
      const { error: dispatchUpdateError } = await db
        .from("dispatches")
        .update({ status: "calling", worker_brief_id: brief.id, last_error: null })
        .eq("dispatch_id", body.dispatchId)
        .eq("user_id", authData.user.id);

      if (dispatchUpdateError) {
        console.warn("[veya-delegation] call requested but dispatch linkage failed", {
          dispatchId: body.dispatchId,
          workerBriefId: brief.id,
          error: dispatchUpdateError.message,
        });
      }
    }

    console.log("[veya-delegation] success", {
      requestId,
      workerBriefId: brief.id,
      provider: dispatchResult.providerType,
      providerCallId: dispatchResult.providerCallId,
    });

    const response: VeyaDelegationResponse = {
      success: true,
      status: "call_requested",
      briefing,
      workerBriefId: brief.id,
      provider: dispatchResult.providerType,
      providerCallId: dispatchResult.providerCallId,
    };
    return NextResponse.json(response);
  } catch (error) {
    const failure = errorDetails(error);
    console.error("[veya-delegation] failure reason", {
      requestId,
      stage: "route",
      ...failure,
    });

    const response: VeyaDelegationResponse = {
      success: false,
      status: "failed",
      briefing,
      error: failure.message,
    };
    return NextResponse.json(response, { status: 500 });
  }
}
