// Worker Dispatcher — Dispatch a WorkerBrief through a provider boundary

import type { WorkerBrief, WorkerDispatchOptions, WorkerDispatchResult } from "./worker-brief-types";
import { getProvider } from "@/lib/providers";
import type { ProviderType } from "@/lib/providers";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";
import { createClient } from "@supabase/supabase-js";
import { saveWorkerBrief } from "./worker-brief-repository";
import { saveBriefConversationMapping } from "@/lib/voice/persistence/brief-conversation-mapping-repository";
import {
  assembleVoiceRepresentationContext,
  buildVoiceProviderVariables,
  type VoiceReadyContext,
} from "@/lib/voice/representation-context";
import { attachVoiceProviderIdentifiers, saveVoiceRepresentationLineage } from "@/lib/voice/persistence/representation-lineage-repository";
import { captureConversationOutput } from "@/lib/voice/conversation-output/repository";

// Resolve the service client at dispatch time so test/runtime environment loading
// cannot permanently cache an unavailable client during module initialization.
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;
}

function valueAsString(value: string | number | boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export async function dispatchWorkerBrief(
  brief: WorkerBrief,
  providerType?: ProviderType,
  businessId?: string | null,
  options: WorkerDispatchOptions = {},
): Promise<WorkerDispatchResult> {
  console.log("[worker-dispatcher] dispatch invoked", {
    workerBriefId: brief.id,
    missionId: brief.missionId,
    requestedProvider: providerType ?? null,
    businessId: businessId ?? null,
  });

  // Extract target info for dispatch and persistence
  const targetName = valueAsString(brief.dynamicVariables.target) ?? brief.leadContext ?? null;
  const persistedTargetPhone = valueAsString(brief.dynamicVariables.targetPhone ?? brief.dynamicVariables.phone) ?? null;
  const targetPhone = options.transientTargetPhone ?? persistedTargetPhone;

  // Validate businessId is provided (required for persistence)
  if (!businessId) {
    console.error("[worker-dispatcher] 🔴 Cannot dispatch: businessId is required", {
      workerBriefId: brief.id,
      missionId: brief.missionId,
    });
    return {
      briefId: brief.id,
      workerName: brief.workerName,
      workerType: brief.workerType,
      status: "FAILED",
      providerOutcome: "REJECTED",
      message: "businessId is required for WorkerBrief persistence",
      providerCallId: "failed_" + Date.now(),
      createdAt: new Date().toISOString(),
    };
  }

  const resolvedProviderType = providerType ?? (brief.workerType === "CALLER" ? "ELEVENLABS" : "MOCK");
  const supabase = createServiceClient();
  let voiceContext: VoiceReadyContext | null = null;
  let voiceContextId: string | null = null;
  if (brief.workerType === "CALLER" || resolvedProviderType === "ELEVENLABS") {
    if (!supabase) {
      return {
        briefId: brief.id,
        workerName: brief.workerName,
        workerType: brief.workerType,
        status: "FAILED",
        providerOutcome: "REJECTED",
        message: "Authorized voice context is unavailable",
        providerCallId: "failed_" + Date.now(),
        createdAt: new Date().toISOString(),
      };
    }
    const owner = await supabase.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
    if (owner.error || !owner.data?.user_id) {
      return {
        briefId: brief.id,
        workerName: brief.workerName,
        workerType: brief.workerType,
        status: "FAILED",
        providerOutcome: "REJECTED",
        message: "Authorized voice context is unavailable",
        providerCallId: "failed_" + Date.now(),
        createdAt: new Date().toISOString(),
      };
    }
    try {
      if (options.representationSnapshot && options.representationSnapshot.tenantUserId !== owner.data.user_id) {
        throw new Error("Representation snapshot owner mismatch");
      }
      voiceContext = await assembleVoiceRepresentationContext({
        db: supabase,
        tenantUserId: options.representationSnapshot?.tenantUserId ?? owner.data.user_id,
        businessId,
        agent: { id: brief.workerName, type: brief.workerType, role: "outbound_representative" },
        provisionalMode: options.provisionalMode === true,
        businessRepresentationId: options.representationSnapshot?.businessRepresentationId,
        canonicalVersionId: options.representationSnapshot?.canonicalVersionId,
      });
      voiceContextId = crypto.randomUUID();
    } catch {
      return {
        briefId: brief.id,
        workerName: brief.workerName,
        workerType: brief.workerType,
        status: "FAILED",
        providerOutcome: "REJECTED",
        message: "Authorized voice context is unavailable",
        providerCallId: "failed_" + Date.now(),
        createdAt: new Date().toISOString(),
      };
    }
  }

  // Task 1: Persist WorkerBrief to database
  console.log("[worker-dispatcher] 🔵 Persisting WorkerBrief to database", {
    workerBriefId: brief.id,
    missionId: brief.missionId,
    businessId,
  });

  const saveResult = await saveWorkerBrief(brief, businessId, targetName, persistedTargetPhone);

  if (!saveResult.success) {
    console.error("[worker-dispatcher] 🔴 WorkerBrief persistence failed, blocking dispatch", {
      workerBriefId: brief.id,
      error: saveResult.error?.message,
    });

    return {
      briefId: brief.id,
      workerName: brief.workerName,
      workerType: brief.workerType,
      status: "FAILED",
      providerOutcome: "REJECTED",
      message: `WorkerBrief persistence failed: ${saveResult.error?.message || "Unknown error"}`,
      providerCallId: "failed_" + Date.now(),
      createdAt: new Date().toISOString(),
    };
  }

  console.log("[worker-dispatcher] 🟢 WorkerBrief persisted successfully", {
    workerBriefId: brief.id,
  });

  // Task 5: Register mapping persistently (survives server restart)
  const provisionalConversationId = `dispatch_${brief.id}_${Date.now()}`;

  // Save to database (persistent)
  console.log("[worker-dispatcher] 🔵 Saving mapping to persistent storage", {
    workerBriefId: brief.id,
    missionId: brief.missionId,
    businessId,
  });

  const mappingResult = await saveBriefConversationMapping(brief.id, brief.missionId, businessId);

  if (!mappingResult.success) {
    console.error("[worker-dispatcher] 🔴 Mapping persistence failed, blocking dispatch", {
      workerBriefId: brief.id,
      error: mappingResult.error?.message,
    });

    return {
      briefId: brief.id,
      workerName: brief.workerName,
      workerType: brief.workerType,
      status: "FAILED",
      providerOutcome: "REJECTED",
      message: `Mapping persistence failed: ${mappingResult.error?.message || "Unknown error"}`,
      providerCallId: "failed_" + Date.now(),
      createdAt: new Date().toISOString(),
    };
  }

  console.log("[worker-dispatcher] 🟢 Mapping persisted successfully", {
    workerBriefId: brief.id,
  });

  // Also maintain in-memory cache for fast access this session
  mappingStore.createMapping(
    provisionalConversationId,
    brief.id,
    brief.missionId,
    businessId
  );

  console.log("[worker-dispatcher] 🔵 Registered in-memory mapping for dispatch", {
    workerBriefId: brief.id,
    missionId: brief.missionId,
    businessId,
    provisionalConversationId,
  });

  // Now that persistence is complete, route to provider
  console.log("[worker-dispatcher] provider selected", {
    workerBriefId: brief.id,
    provider: resolvedProviderType,
  });
  const provider = getProvider(resolvedProviderType);

  // Dispatch to provider
  console.log("[worker-dispatcher] provider request started", {
    workerBriefId: brief.id,
    provider: resolvedProviderType,
  });
  const providerVariables = voiceContext
    ? buildVoiceProviderVariables({ targetName, targetPhone, objective: brief.objective, context: voiceContext })
    : brief.dynamicVariables;

  if (voiceContext && voiceContextId && supabase) {
    try {
      await saveVoiceRepresentationLineage({
        db: supabase,
        voiceContextId,
        workerBriefId: brief.id,
        missionId: brief.missionId,
        conversationId: provisionalConversationId,
        lineage: voiceContext.lineage,
      });
    } catch {
      return {
        briefId: brief.id,
        workerName: brief.workerName,
        workerType: brief.workerType,
        status: "FAILED",
        providerOutcome: "REJECTED",
        message: "Voice lineage could not be recorded",
        providerCallId: "failed_" + Date.now(),
        createdAt: new Date().toISOString(),
      };
    }
  }

  const providerStartedAt = new Date().toISOString();
  const providerResult = await provider.dispatch({
    workerBriefId: brief.id,
    missionId: brief.missionId,
    targetName,
    targetPhone,
    objective: brief.objective,
    dynamicVariables: providerVariables,
  });

  console.log("[worker-dispatcher] provider response", {
    workerBriefId: brief.id,
    provider: providerResult.providerType,
    status: providerResult.status,
    providerCallId: providerResult.providerCallId,
    conversationId: providerResult.conversationId,
    voiceContextId: voiceContextId ?? undefined,
  });

  const dispatchAccepted =
      providerResult.status === "DISPATCHED"
      || (
        resolvedProviderType === "MOCK"
        && providerResult.status === "SIMULATED"
      );
  const durableConversationId = dispatchAccepted
    ? providerResult.conversationId || provisionalConversationId
    : providerResult.conversationId;

  if (!dispatchAccepted && voiceContextId && supabase) {
    try {
      await captureConversationOutput(supabase, {
        voiceContextId,
        conversationId: provisionalConversationId,
        provider: resolvedProviderType === "ELEVENLABS" ? "elevenlabs" : "openai_realtime",
        channel: "veya_outbound",
        captureSource: "status_only",
        transcriptTrustLevel: "status_only",
        providerAttested: false,
        startedAt: providerStartedAt,
        completedAt: providerResult.createdAt,
        transcript: [],
        transcriptStatus: "unavailable",
        conversationStatus: "failed",
        completionReason: "provider_dispatch_failed",
        safeMetadata: { errorCategory: "provider_dispatch_failed" },
      });
    } catch {
      console.error("[worker-dispatcher] provider failure capture failed", {
        workerBriefId: brief.id,
        category: "status_capture_failed",
      });
    }
  }

  let correlationComplete = false;
  // Save provider identifiers immediately after provider acceptance. Both durable
  // stores must succeed before the result may be called correlated.
  if (dispatchAccepted && providerResult.providerCallId) {
    console.log("[worker-dispatcher] 🔵 Updating mapping", {
      workerBriefId: brief.id,
      providerCallId: providerResult.providerCallId,
      conversationId: providerResult.conversationId,
      supabaseClientInitialized: !!supabase,
    });

    try {
      if (!supabase) {
        console.error("[worker-dispatcher] 🔴 Supabase service-role client not initialized", {
          workerBriefId: brief.id,
        });
      } else {
        if (voiceContext && voiceContextId) {
          await attachVoiceProviderIdentifiers({
            db: supabase,
            voiceContextId,
            conversationId: durableConversationId ?? null,
            providerCallId: providerResult.providerCallId,
          });
        }
        const { data, error } = await supabase
          .from("brief_conversation_mappings")
          .update({
            provider_call_id: providerResult.providerCallId,
            conversation_id: durableConversationId || null,
            updated_at: new Date().toISOString(),
          })
          .eq("worker_brief_id", brief.id)
          .select();

        console.log("[worker-dispatcher] mapping correlation result", {
          workerBriefId: brief.id,
          success: !error,
          rowsAffected: data?.length || 0,
          code: error?.code,
        });

        if (error) {
          console.error("[worker-dispatcher] 🔴 Failed to update mapping with provider call ID", {
            code: error.code,
          });
        } else if (!data || data.length === 0) {
          console.warn("[worker-dispatcher] ⚠️  Update succeeded but no rows matched WHERE clause", {
            workerBriefId: brief.id,
          });
        } else {
          correlationComplete = true;
          console.log("[worker-dispatcher] 🟢 Provider identifiers correlated", {
            workerBriefId: brief.id,
          });
        }
      }
    } catch (error) {
      console.error("[worker-dispatcher] 🔴 Exception updating mapping with provider call ID", {
        workerBriefId: brief.id,
        category: "provider_identifier_correlation_failed",
      });
    }
  }

  return {
    briefId: brief.id,
    workerName: brief.workerName,
    workerType: brief.workerType,
    status: providerResult.status,
    providerOutcome: !dispatchAccepted
      ? "REJECTED"
      : correlationComplete
        ? "ACCEPTED_CORRELATED"
        : "ACCEPTED_PENDING_CORRELATION",
    message: providerResult.message,
    providerType: providerResult.providerType,
    providerCallId: providerResult.providerCallId,
    conversationId: durableConversationId,
    voiceContextId: voiceContextId ?? undefined,
    createdAt: providerResult.createdAt,
  };
}
