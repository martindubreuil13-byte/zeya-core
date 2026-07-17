import { NextResponse } from "next/server";
import { assembleVoiceRepresentationContext } from "@/lib/voice/representation-context";
import {
  createExperienceServiceClient,
  createExperienceToken,
  hashExperienceToken,
  PUBLIC_EXPERIENCE_TTL_MS,
} from "@/lib/experience/public-session-server";

const OPENAI_REALTIME_SESSION_URL = process.env.OPENAI_REALTIME_SESSION_URL ?? "https://api.openai.com/v1/realtime/client_secrets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST() {
  const businessId = process.env.ZEYA_EXPERIENCE_BUSINESS_ID?.trim();
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!businessId || !UUID.test(businessId) || !openAIKey) {
    return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
  }

  let persistedTokenHash: string | null = null;
  let serviceDb: ReturnType<typeof createExperienceServiceClient> | null = null;
  try {
    const db = createExperienceServiceClient();
    serviceDb = db;
    const business = await db.from("businesses").select("id,user_id").eq("id", businessId).maybeSingle();
    if (business.error || !business.data?.user_id) {
      return NextResponse.json({ error: "The Experience is temporarily unavailable." }, { status: 503 });
    }

    const voiceContext = await assembleVoiceRepresentationContext({
      db,
      tenantUserId: business.data.user_id,
      businessId,
      agent: { id: "zeya-public-experience", type: "ZEYA", role: "public_discovery" },
      provisionalMode: false,
    });
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
      p_business_id: voiceContext.lineage.businessId,
      p_business_representation_id: voiceContext.lineage.businessRepresentationId,
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
