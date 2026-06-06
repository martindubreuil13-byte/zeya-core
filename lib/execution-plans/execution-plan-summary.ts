// ExecutionPlan Summary — Human-readable summary of a plan and its dispatch

import type { WorkerBrief, WorkerDispatchResult } from "@/lib/workers";
import type { ExecutionPlan } from "./execution-plan-types";

export interface ExecutionPlanSummary {
  planId: string;
  missionId: string;
  title: string;
  status: string;
  priority: string;
  mode: string;
  missionObjective: string;
  desiredOutcome: string;
  totalSteps: number;
  totalTargets?: number;
  workers: Array<{
    stepNumber: number;
    workerName: string;
    workerType: string;
    objective: string;
    target?: string;
  }>;
  dispatchStatus?: {
    totalDispatched: number;
    successful: number;
    failed: number;
    dispatchedAt: string;
  };
  nextSteps: string;
  assumptions: string[];
  risks: string[];
  successCriteria: string;
}

export function buildExecutionPlanSummary(
  plan: ExecutionPlan,
  briefs?: WorkerBrief[],
  dispatchResults?: WorkerDispatchResult[]
): ExecutionPlanSummary {
  const workers = plan.plannedSteps.map((step, idx) => {
    // Get worker name from brief if available, otherwise from step
    const correspondingBrief = briefs?.[idx];
    const workerName = correspondingBrief?.workerName || step.workerName || "Unassigned";

    return {
      stepNumber: step.stepNumber,
      workerName,
      workerType: step.workerType,
      objective: step.objective,
      target: step.target,
    };
  });

  let nextSteps = "";
  if (plan.mode === "SINGLE") {
    nextSteps = "Zeya will wait for response from the assigned worker once providers are configured.";
  } else if (plan.mode === "BATCH") {
    nextSteps = `Zeya will dispatch ${plan.plannedSteps.length} briefs concurrently to workers. Will aggregate results once all complete.`;
  } else if (plan.mode === "SEQUENTIAL") {
    nextSteps = `Zeya will dispatch ${plan.plannedSteps.length} briefs sequentially, waiting for each to complete before starting the next.`;
  } else {
    nextSteps = "Plan execution mode not yet configured.";
  }

  let dispatchStatus;
  if (dispatchResults) {
    const successful = dispatchResults.filter((r) => r.status === "SIMULATED").length;
    const failed = dispatchResults.filter((r) => r.status === "FAILED").length;
    dispatchStatus = {
      totalDispatched: dispatchResults.length,
      successful,
      failed,
      dispatchedAt: new Date().toISOString(),
    };
  }

  return {
    planId: plan.id,
    missionId: plan.missionId,
    title: plan.title,
    status: plan.status,
    priority: plan.priority,
    mode: plan.mode,
    missionObjective: plan.missionObjective,
    desiredOutcome: plan.desiredOutcome,
    totalSteps: plan.plannedSteps.length,
    totalTargets: plan.totalTargets,
    workers,
    dispatchStatus,
    nextSteps,
    assumptions: plan.assumptions,
    risks: plan.risks,
    successCriteria: plan.successCriteria,
  };
}
