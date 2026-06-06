// Operational Dispatcher — Full orchestration from context to dispatch

import { selectWorkerForBrief, dispatchWorkerBrief } from "@/lib/workers";
import type { WorkerBrief, WorkerDispatchResult } from "@/lib/workers";
import type { ExecutionPlan } from "@/lib/execution-plans";
import type { OperationalIntelligenceAnalysis } from "./operational-intelligence-types";
import { analyzeOperationalMission, type AnalyzerInput } from "./operational-intelligence-analyzer";
import { buildExecutionPlanFromOperationalAnalysis } from "./operational-plan-builder";
import { createWorkerBriefsFromOperationalAnalysis } from "./operational-brief-builder";

export interface OperationalDispatchInput extends Omit<AnalyzerInput, "desiredOutcome"> {
  title: string; // ExecutionPlan title
  desiredOutcome: string;
  targets?: Array<{
    id: string;
    name?: string;
    phone?: string;
    context?: string;
  }>;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

export interface DispatchedOperationalMission {
  analysis: OperationalIntelligenceAnalysis;
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
    intent: string;
    confidence: string;
    totalSteps: number;
    totalBriefs: number;
    successfulDispatches: number;
    failedDispatches: number;
    dispatchedAt: string;
  };
}

export async function dispatchOperationalMission(input: OperationalDispatchInput): Promise<DispatchedOperationalMission> {
  // Step 1: Analyze mission context
  const analysis = analyzeOperationalMission({
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    companyContext: input.companyContext,
    missionContext: input.missionContext,
    targetContext: input.targetContext,
    desiredOutcome: input.desiredOutcome,
    knownMemory: input.knownMemory,
    intent: input.intent,
  });

  // Step 2: Build ExecutionPlan from analysis
  const plan = buildExecutionPlanFromOperationalAnalysis({
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    title: input.title,
    companyContext: input.companyContext,
    missionObjective: input.missionContext,
    desiredOutcome: input.desiredOutcome,
    priority: input.priority,
    targets: input.targets?.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      context: t.context,
    })),
    analysis,
  });

  // Step 3: Create WorkerBriefs from analysis guidance
  const briefs = createWorkerBriefsFromOperationalAnalysis(plan, analysis);

  // Step 4: Select workers
  const workerSelections = briefs.map((brief) => {
    const selection = selectWorkerForBrief(brief);
    return {
      briefId: brief.id,
      workerName: selection.workerName,
      selected: selection.selected,
      reason: selection.reason,
    };
  });

  // Step 5: Dispatch all briefs
  const dispatchResults = await Promise.all(
    briefs.map((brief) => dispatchWorkerBrief(brief))
  );

  // Step 6: Aggregate results
  const successfulDispatches = dispatchResults.filter((result) => result.status === "SIMULATED").length;
  const failedDispatches = dispatchResults.filter((result) => result.status === "FAILED").length;

  const now = new Date().toISOString();

  return {
    analysis,
    plan,
    briefs,
    workerSelections,
    dispatchResults,
    summary: {
      intent: analysis.intent,
      confidence: analysis.confidence,
      totalSteps: plan.plannedSteps.length,
      totalBriefs: briefs.length,
      successfulDispatches,
      failedDispatches,
      dispatchedAt: now,
    },
  };
}
