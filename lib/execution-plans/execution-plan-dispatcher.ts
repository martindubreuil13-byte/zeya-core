// ExecutionPlan Dispatcher — Dispatch a plan by converting to briefs and dispatching

import { selectWorkerForBrief, dispatchWorkerBrief } from "@/lib/workers";
import type { WorkerBrief, WorkerDispatchResult } from "@/lib/workers";
import type { ExecutionPlan } from "./execution-plan-types";
import { createWorkerBriefsFromExecutionPlan } from "./execution-plan-to-worker-briefs";

export interface DispatchedExecutionPlan {
  plan: ExecutionPlan;
  briefs: WorkerBrief[];
  workerSelections: Array<{
    briefId: string;
    workerName: string;
    selected: boolean;
    reason: string;
  }>;
  dispatchResults: WorkerDispatchResult[];
  summary: {
    totalSteps: number;
    totalBriefs: number;
    successfulDispatches: number;
    failedDispatches: number;
    dispatchedAt: string;
  };
}

export async function dispatchExecutionPlan(plan: ExecutionPlan): Promise<DispatchedExecutionPlan> {
  // Convert plan steps to worker briefs
  const briefs = createWorkerBriefsFromExecutionPlan(plan);

  // Select workers for each brief
  const workerSelections = briefs.map((brief) => {
    const selection = selectWorkerForBrief(brief);
    return {
      briefId: brief.id,
      workerName: selection.workerName,
      selected: selection.selected,
      reason: selection.reason,
    };
  });

  // Dispatch each brief
  const dispatchResults = await Promise.all(
    briefs.map((brief) => dispatchWorkerBrief(brief))
  );

  // Count results
  const successfulDispatches = dispatchResults.filter((result) => result.status === "SIMULATED").length;
  const failedDispatches = dispatchResults.filter((result) => result.status === "FAILED").length;

  const now = new Date().toISOString();

  return {
    plan,
    briefs,
    workerSelections,
    dispatchResults,
    summary: {
      totalSteps: plan.plannedSteps.length,
      totalBriefs: briefs.length,
      successfulDispatches,
      failedDispatches,
      dispatchedAt: now,
    },
  };
}
