// Worker Dispatcher — Dispatch a WorkerBrief through a provider boundary

import type { WorkerBrief, WorkerDispatchResult } from "./worker-brief-types";
import { getProvider } from "@/lib/providers";
import type { ProviderType } from "@/lib/providers";
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";
import { supabase } from "@/lib/supabase";

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
  providerType: ProviderType = "MOCK"
): Promise<WorkerDispatchResult> {
  const provider = getProvider(providerType);
  const providerResult = await provider.dispatch({
    workerBriefId: brief.id,
    missionId: brief.missionId,
    targetName: valueAsString(brief.dynamicVariables.target) ?? brief.leadContext ?? null,
    targetPhone: valueAsString(brief.dynamicVariables.targetPhone ?? brief.dynamicVariables.phone) ?? null,
    objective: brief.objective,
    dynamicVariables: brief.dynamicVariables,
  });

  // Register provisional mapping for webhook to find context
  // conversationId from ElevenLabs isn't available yet, so use temporary key
  const provisionalConversationId = `dispatch_${brief.id}_${Date.now()}`;
  const businessId = await getMissionBusinessId(brief.missionId);

  if (businessId) {
    mappingStore.createMapping(
      provisionalConversationId,
      brief.id,
      brief.missionId,
      businessId
    );

    console.log("[worker-dispatcher] 🔵 Registered provisional mapping for dispatch", {
      workerBriefId: brief.id,
      missionId: brief.missionId,
      businessId,
      provisionalConversationId,
    });
  } else {
    console.warn("[worker-dispatcher] 🟡 Could not register mapping: business_id not found", {
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
