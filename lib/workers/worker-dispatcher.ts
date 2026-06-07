// Worker Dispatcher — Dispatch a WorkerBrief through a provider boundary

import type { WorkerBrief, WorkerDispatchResult } from "./worker-brief-types";
import { getProvider } from "@/lib/providers";
import type { ProviderType } from "@/lib/providers";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";
import { supabase } from "@/lib/supabase";
import { saveWorkerBrief } from "./worker-brief-repository";
import { saveBriefConversationMapping } from "@/lib/voice/persistence/brief-conversation-mapping-repository";

function valueAsString(value: string | number | boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

async function getMissionBusinessId(missionId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("missions")
      .select("business_id")
      .eq("id", missionId)
      .single();

    if (error || !data) {
      console.warn("[worker-dispatcher] Failed to fetch mission for mapping registration", {
        missionId,
        error: error?.message,
      });
      return null;
    }

    return (data as any).business_id ?? null;
  } catch (err) {
    console.warn("[worker-dispatcher] Exception fetching mission for mapping", {
      missionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function dispatchWorkerBrief(
  brief: WorkerBrief,
  providerType?: ProviderType
): Promise<WorkerDispatchResult> {
  // Route CALLER briefs to ElevenLabs for real outbound calls, others to MOCK
  const resolvedProviderType = providerType ?? (brief.workerType === "CALLER" ? "ELEVENLABS" : "MOCK");
  const provider = getProvider(resolvedProviderType);
  const targetName = valueAsString(brief.dynamicVariables.target) ?? brief.leadContext ?? null;
  const targetPhone = valueAsString(brief.dynamicVariables.targetPhone ?? brief.dynamicVariables.phone) ?? null;

  const providerResult = await provider.dispatch({
    workerBriefId: brief.id,
    missionId: brief.missionId,
    targetName,
    targetPhone,
    objective: brief.objective,
    dynamicVariables: brief.dynamicVariables,
  });

  // Get businessId for persistent storage
  const businessId = await getMissionBusinessId(brief.missionId);

  if (businessId) {
    // Task 1: Persist WorkerBrief to database
    console.log("[worker-dispatcher] 🔵 Persisting WorkerBrief to database", {
      workerBriefId: brief.id,
      missionId: brief.missionId,
      businessId,
    });

    const saveResult = await saveWorkerBrief(brief, businessId, targetName, targetPhone);

    if (saveResult.success) {
      console.log("[worker-dispatcher] 🟢 WorkerBrief persisted successfully", {
        workerBriefId: brief.id,
      });
    } else {
      console.error("[worker-dispatcher] 🔴 WorkerBrief persistence failed", {
        workerBriefId: brief.id,
        error: saveResult.error?.message,
      });
    }

    // Task 5: Register mapping persistently (survives server restart)
    // Also maintain in-memory mapping for fast access during this session
    const provisionalConversationId = `dispatch_${brief.id}_${Date.now()}`;

    // Save to database (persistent)
    console.log("[worker-dispatcher] 🔵 Saving mapping to persistent storage", {
      workerBriefId: brief.id,
      missionId: brief.missionId,
      businessId,
    });

    const mappingResult = await saveBriefConversationMapping(brief.id, brief.missionId, businessId);

    if (mappingResult.success) {
      console.log("[worker-dispatcher] 🟢 Mapping persisted successfully", {
        workerBriefId: brief.id,
      });
    } else {
      console.error("[worker-dispatcher] 🔴 Mapping persistence failed", {
        workerBriefId: brief.id,
        error: mappingResult.error?.message,
      });
    }

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
  } else {
    console.warn("[worker-dispatcher] 🟡 Could not dispatch: business_id not found", {
      missionId: brief.missionId,
      workerBriefId: brief.id,
    });
  }

  return {
    briefId: brief.id,
    workerName: brief.workerName,
    workerType: brief.workerType,
    status: providerResult.status,
    message: providerResult.message,
    providerType: providerResult.providerType,
    providerCallId: providerResult.providerCallId,
    createdAt: providerResult.createdAt,
  };
}
