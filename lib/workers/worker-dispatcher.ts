// Worker Dispatcher — Dispatch a WorkerBrief through a provider boundary

import type { WorkerBrief, WorkerDispatchResult } from "./worker-brief-types";
import { getProvider } from "@/lib/providers";
import type { ProviderType } from "@/lib/providers";

function valueAsString(value: string | number | boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
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
