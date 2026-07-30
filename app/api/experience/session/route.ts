import { NextRequest, NextResponse } from "next/server";
import { assembleVoiceRepresentationContext } from "@/lib/voice/representation-context";
import {
  createExperienceServiceClient,
  createExperienceToken,
  hashExperienceToken,
  PUBLIC_EXPERIENCE_TTL_MS,
} from "@/lib/experience/public-session-server";
import {
  parseProvisionOwnerBusinessResult,
  provisioningFailureResponse,
} from "@/lib/experience/atomic-provisioning";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";

const OPENAI_REALTIME_SESSION_URL = process.env.OPENAI_REALTIME_SESSION_URL ?? "https://api.openai.com/v1/realtime/client_secrets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_EXPERIENCE_INSTRUCTIONS = `Follow the public Experience's client-provided beat instructions exactly. Keep responses concise and do not expose internal metadata.`;

export function buildPublicExperienceInstructions(governedContext: string): string {
  return `${PUBLIC_EXPERIENCE_INSTRUCTIONS}\n\n--- GOVERNED REPRESENTATION CONTEXT ---\n${governedContext}`;
}

export async function POST(request: NextRequest) {
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) {
    return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
  }

  let businessId: string | undefined;
  let businessRepresentationId: string | undefined;
  let tenantUserId: string | undefined;

  // Check for authenticated user
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) {
    // Not authenticated - use shared public business
    businessId = process.env.ZEYA_EXPERIENCE_BUSINESS_ID?.trim();
    if (!businessId || !UUID.test(businessId)) {
      return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
    }

    // Get tenant user ID from the public business
    const db = createExperienceServiceClient();
    const business = await db.from("businesses").select("id,user_id").eq("id", businessId).maybeSingle();
    if (business.error || !business.data?.user_id) {
      return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
    }
    tenantUserId = business.data.user_id;

    const representation = await db
      .from("business_representations")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", tenantUserId)
      .maybeSingle();
    if (
      representation.error ||
      typeof representation.data?.id !== "string" ||
      !UUID.test(representation.data.id)
    ) {
      return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
    }
    businessRepresentationId = representation.data.id;
  } else {
    tenantUserId = auth.user.id;
    const db = createExperienceServiceClient();
    const provisioned = await db.rpc("zeya_provision_owner_business", {
      p_owner_id: tenantUserId,
      p_business_id: null,
    });
    if (provisioned.error) {
      console.error("[experience-session] Failed to provision owner Business");
      return provisioningFailureResponse(provisioned.error);
    }

    const provision = parseProvisionOwnerBusinessResult(provisioned.data);
    if (!provision) {
      console.error("[experience-session] Failed to provision owner Business");
      return provisioningFailureResponse(null);
    }

    businessId = provision.business_id;
    businessRepresentationId = provision.business_representation_id;
  }

  if (
    !businessId ||
    !UUID.test(businessId) ||
    !businessRepresentationId ||
    !UUID.test(businessRepresentationId) ||
    !tenantUserId
  ) {
    return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
  }

  let persistedTokenHash: string | null = null;
  let serviceDb: ReturnType<typeof createExperienceServiceClient> | null = null;
  try {
    const db = createExperienceServiceClient();
    serviceDb = db;

    const voiceContext = await assembleVoiceRepresentationContext({
      db,
      tenantUserId,
      businessId,
      businessRepresentationId,
      agent: { id: "zeya-public-experience", type: "ZEYA", role: "public_discovery" },
      provisionalMode: false,
    });
    if (
      voiceContext.lineage.businessId !== businessId ||
      voiceContext.lineage.businessRepresentationId !== businessRepresentationId
    ) {
      throw new Error("provisioned identity mismatch");
    }

    const voiceContextId = crypto.randomUUID();
    const conversationId = `public_zeya_${voiceContextId}`;
    const token = createExperienceToken();
    const expiresAt = new Date(Date.now() + PUBLIC_EXPERIENCE_TTL_MS).toISOString();
    const created = await db.rpc("zeya_create_public_experience_session", {
      p_token_hash: hashExperienceToken(token),
      p_expires_at: expiresAt,
      p_voice_context_id: voiceContextId,
      p_worker_brief_id: `public_zeya_${voiceContextId}`,
      p_conversation_id: conversationId,
      p_tenant_user_id: voiceContext.lineage.tenantUserId,
      p_business_id: businessId,
      p_business_representation_id: businessRepresentationId,
      p_canonical_version_id: voiceContext.lineage.canonicalVersionId,
      p_context_generated_at: voiceContext.lineage.generatedAt,
      p_authorized_element_keys: voiceContext.lineage.authorizedElementKeys,
      p_agent_id: voiceContext.lineage.agentId,
      p_context_schema_version: voiceContext.lineage.contextSchemaVersion,
      p_prompt_assembly_version: voiceContext.lineage.promptAssemblyVersion,
    });
    if (created.error || typeof created.data !== "string") throw new Error("session persistence failed");
    persistedTokenHash = hashExperienceToken(token);

    const upstream = await fetch(OPENAI_REALTIME_SESSION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAIKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: {
        type: "realtime",
        model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
        instructions: buildPublicExperienceInstructions(voiceContext.systemContext),
        audio: {
          input: { turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: false, interrupt_response: false }, transcription: { model: "gpt-4o-mini-transcribe" } },
          output: { voice: process.env.OPENAI_REALTIME_VOICE ?? "sage" },
        },
      } }),
      cache: "no-store",
    });
    const upstreamBody = await upstream.json() as { value?: string; client_secret?: { value?: string } };
    const secret = upstreamBody.value ?? upstreamBody.client_secret?.value;
    if (!upstream.ok || !secret) throw new Error("realtime credential failed");

    return NextResponse.json({
      client_secret: { value: secret },
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
      experience_token: token,
      expires_at: expiresAt,
      status: "waiting_for_zeya",
    });
  } catch {
    if (serviceDb && persistedTokenHash) {
      const compensation = process.env.PUBLIC_EXPERIENCE_TEST_FORCE_COMPENSATION_FAILURE === "true"
        ? { error: { code: "test_compensation_failure" } }
        : await serviceDb.rpc("zeya_fail_public_experience_session", { p_token_hash: persistedTokenHash });
      if (compensation.error) console.error("[public-experience] session failure compensation failed");
    }
    return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
  }
}
