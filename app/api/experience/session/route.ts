import { NextRequest, NextResponse } from "next/server";
import {
  assembleVoiceRepresentationContext,
  assemblePreCanonicalVoiceContext,
  VoiceContextUnavailableError,
} from "@/lib/voice/representation-context";
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

const OPENAI_REALTIME_SESSION_URL =
  process.env.OPENAI_REALTIME_SESSION_URL ??
  "https://api.openai.com/v1/realtime/client_secrets";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_EXPERIENCE_INSTRUCTIONS =
  "Follow the public Experience's client-provided beat instructions exactly. Keep responses concise and do not expose internal metadata.";

export type ExperienceSessionFailureStage =
  | "authentication"
  | "atomic_provisioning"
  | "provisioning_response_validation"
  | "voice_context"
  | "experience_session_creation"
  | "provider_configuration"
  | "provider_request"
  | "provider_response";

type ExperienceSessionFailureCode =
  | "experience_session_failed"
  | "business_selection_required"
  | "business_not_found";

function experienceSessionFailure(
  stage: ExperienceSessionFailureStage,
  status = 503,
  code: ExperienceSessionFailureCode = "experience_session_failed",
) {
  return NextResponse.json(
    { success: false, error: code, stage },
    { status },
  );
}

function safeStageLog(stage: ExperienceSessionFailureStage, code: string) {
  console.error("[experience-session]", { stage, code });
}

export function buildPublicExperienceInstructions(governedContext: string): string {
  return `${PUBLIC_EXPERIENCE_INSTRUCTIONS}\n\n--- GOVERNED REPRESENTATION CONTEXT ---\n${governedContext}`;
}

export async function POST(request: NextRequest) {
  const openAIKey = process.env.OPENAI_API_KEY;
  if (!openAIKey) {
    safeStageLog("provider_configuration", "openai_key_unavailable");
    return experienceSessionFailure("provider_configuration");
  }

  let businessId: string | undefined;
  let businessRepresentationId: string | undefined;
  let tenantUserId: string | undefined;
  let representationContextMode: "canonical" | "pre_canonical" = "canonical";
  let persistedTokenHash: string | null = null;
  let serviceDb: ReturnType<typeof createExperienceServiceClient> | null = null;

  const authorization = request.headers.get("authorization");
  const bearerSupplied = authorization?.startsWith("Bearer ") === true;
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse && bearerSupplied) {
    safeStageLog("authentication", "bearer_rejected");
    return experienceSessionFailure("authentication", 401);
  }

  try {
    const db = createExperienceServiceClient();
    serviceDb = db;

    if (auth instanceof NextResponse) {
      businessId = process.env.ZEYA_EXPERIENCE_BUSINESS_ID?.trim();
      if (!businessId || !UUID.test(businessId)) {
        safeStageLog("provider_configuration", "shared_business_unavailable");
        return experienceSessionFailure("provider_configuration");
      }

      const business = await db
        .from("businesses")
        .select("id,user_id")
        .eq("id", businessId)
        .maybeSingle();
      if (business.error || !business.data?.user_id) {
        safeStageLog("voice_context", business.error?.code ?? "shared_business_not_found");
        return experienceSessionFailure("voice_context");
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
        safeStageLog(
          "voice_context",
          representation.error?.code ?? "shared_representation_not_found",
        );
        return experienceSessionFailure("voice_context");
      }
      businessRepresentationId = representation.data.id;
    } else {
      tenantUserId = auth.user.id;
      const provisioned = await db.rpc("zeya_provision_owner_business", {
        p_owner_id: tenantUserId,
        p_business_id: null,
      });
      if (provisioned.error) {
        safeStageLog(
          "atomic_provisioning",
          provisioned.error.code ?? "provisioning_failed",
        );
        return provisioningFailureResponse(provisioned.error);
      }

      const provision = parseProvisionOwnerBusinessResult(provisioned.data);
      if (!provision) {
        safeStageLog(
          "provisioning_response_validation",
          "malformed_provisioning_response",
        );
        return experienceSessionFailure("provisioning_response_validation");
      }

      businessId = provision.business_id;
      businessRepresentationId = provision.business_representation_id;
      representationContextMode = "pre_canonical";
    }

    if (
      !businessId ||
      !UUID.test(businessId) ||
      !businessRepresentationId ||
      !UUID.test(businessRepresentationId) ||
      !tenantUserId ||
      !UUID.test(tenantUserId)
    ) {
      safeStageLog(
        "provisioning_response_validation",
        "invalid_provisioned_identity",
      );
      return experienceSessionFailure("provisioning_response_validation");
    }

    let voiceContext;
    try {
      const agent = {
        id: "zeya-public-experience",
        type: "ZEYA",
        role: "public_discovery",
      };
      voiceContext = representationContextMode === "pre_canonical"
        ? await assemblePreCanonicalVoiceContext({
          db,
          tenantUserId,
          businessId,
          businessRepresentationId,
          agent,
        })
        : await assembleVoiceRepresentationContext({
          db,
          tenantUserId,
          businessId,
          businessRepresentationId,
          agent,
          provisionalMode: false,
        });
    } catch (error) {
      safeStageLog(
        "voice_context",
        error instanceof VoiceContextUnavailableError
          ? "authorized_context_unavailable"
          : "voice_context_failed",
      );
      return experienceSessionFailure("voice_context");
    }

    if (
      voiceContext.lineage.tenantUserId !== tenantUserId ||
      voiceContext.lineage.businessId !== businessId ||
      voiceContext.lineage.businessRepresentationId !== businessRepresentationId ||
      voiceContext.lineage.representationContextMode !==
        representationContextMode ||
      (
        representationContextMode === "pre_canonical"
          ? voiceContext.lineage.canonicalVersionId !== null
          : voiceContext.lineage.canonicalVersionId === null
      )
    ) {
      safeStageLog("voice_context", "provisioned_identity_mismatch");
      return experienceSessionFailure("voice_context");
    }

    const voiceContextId = crypto.randomUUID();
    const conversationId = `public_zeya_${voiceContextId}`;
    const token = createExperienceToken();
    const expiresAt = new Date(
      Date.now() + PUBLIC_EXPERIENCE_TTL_MS,
    ).toISOString();
    const tokenHash = hashExperienceToken(token);
    const createSessionRpc = representationContextMode === "pre_canonical"
      ? "zeya_create_pre_canonical_public_experience_session"
      : "zeya_create_public_experience_session";
    const created = await db.rpc(createSessionRpc, {
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_voice_context_id: voiceContextId,
      p_worker_brief_id: `public_zeya_${voiceContextId}`,
      p_conversation_id: conversationId,
      p_tenant_user_id: tenantUserId,
      p_business_id: businessId,
      p_business_representation_id: businessRepresentationId,
      p_canonical_version_id: voiceContext.lineage.canonicalVersionId,
      p_context_generated_at: voiceContext.lineage.generatedAt,
      p_authorized_element_keys: voiceContext.lineage.authorizedElementKeys,
      p_agent_id: voiceContext.lineage.agentId,
      p_context_schema_version: voiceContext.lineage.contextSchemaVersion,
      p_prompt_assembly_version: voiceContext.lineage.promptAssemblyVersion,
    });
    if (created.error) {
      safeStageLog(
        "experience_session_creation",
        created.error.code ?? "session_creation_failed",
      );
      return experienceSessionFailure("experience_session_creation");
    }

    persistedTokenHash = tokenHash;
    if (typeof created.data !== "string" || !UUID.test(created.data)) {
      safeStageLog(
        "experience_session_creation",
        "malformed_session_result",
      );
      throw new ExperienceSessionPersistenceFailure();
    }

    let upstream: Response;
    try {
      upstream = await fetch(OPENAI_REALTIME_SESSION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAIKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
            instructions: buildPublicExperienceInstructions(
              voiceContext.systemContext,
            ),
            audio: {
              input: {
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                  create_response: false,
                  interrupt_response: false,
                },
                transcription: { model: "gpt-4o-mini-transcribe" },
              },
              output: {
                voice: process.env.OPENAI_REALTIME_VOICE ?? "sage",
              },
            },
          },
        }),
        cache: "no-store",
      });
    } catch {
      safeStageLog("provider_request", "openai_request_failed");
      throw new ExperienceProviderFailure("provider_request");
    }

    let upstreamBody: {
      value?: string;
      client_secret?: { value?: string };
    };
    try {
      upstreamBody = await upstream.json();
    } catch {
      safeStageLog("provider_response", "malformed_provider_response");
      throw new ExperienceProviderFailure("provider_response");
    }

    const secret =
      upstreamBody.value ?? upstreamBody.client_secret?.value;
    if (!upstream.ok || !secret) {
      safeStageLog(
        "provider_response",
        `openai_http_${upstream.status}`,
      );
      throw new ExperienceProviderFailure("provider_response");
    }

    return NextResponse.json({
      client_secret: { value: secret },
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
      experience_token: token,
      expires_at: expiresAt,
      status: "waiting_for_zeya",
    });
  } catch (error) {
    if (serviceDb && persistedTokenHash) {
      const compensation =
        process.env.PUBLIC_EXPERIENCE_TEST_FORCE_COMPENSATION_FAILURE === "true"
          ? { error: { code: "test_compensation_failure" } }
          : await serviceDb.rpc("zeya_fail_public_experience_session", {
              p_token_hash: persistedTokenHash,
            });
      if (compensation.error) {
        safeStageLog(
          "experience_session_creation",
          "failure_compensation_failed",
        );
      }
    }

    const stage =
      error instanceof ExperienceProviderFailure
        ? error.stage
        : error instanceof ExperienceSessionPersistenceFailure
          ? "experience_session_creation"
        : "provider_configuration";
    if (
      !(error instanceof ExperienceProviderFailure) &&
      !(error instanceof ExperienceSessionPersistenceFailure)
    ) {
      safeStageLog(stage, "environment_isolation_or_service_configuration");
    }
    return experienceSessionFailure(stage);
  }
}

class ExperienceProviderFailure extends Error {
  constructor(readonly stage: "provider_request" | "provider_response") {
    super(stage);
    this.name = "ExperienceProviderFailure";
  }
}

class ExperienceSessionPersistenceFailure extends Error {
  constructor() {
    super("Malformed session persistence result");
    this.name = "ExperienceSessionPersistenceFailure";
  }
}
