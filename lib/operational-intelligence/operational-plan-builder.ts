// Operational Plan Builder — Build ExecutionPlan from operational analysis

import { buildExecutionPlan } from "@/lib/execution-plans";
import type { ExecutionPlan } from "@/lib/execution-plans";
import type { ExecutionTarget, ExecutionPlanInput } from "@/lib/execution-plans";
import type { OperationalIntelligenceAnalysis } from "./operational-intelligence-types";

export interface OperationalPlanBuilderInput extends Omit<ExecutionPlanInput, "successCriteria" | "assumptions" | "risks"> {
  analysis: OperationalIntelligenceAnalysis;
}

export function buildExecutionPlanFromOperationalAnalysis(
  input: OperationalPlanBuilderInput
): ExecutionPlan {
  // Build plan using existing builder, but override with analysis guidance
  const plan = buildExecutionPlan({
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    title: input.title,
    companyContext: input.companyContext,
    missionObjective: input.missionObjective,
    desiredOutcome: input.desiredOutcome,
    priority: input.priority || "NORMAL",
    mode: input.mode,
    targets: input.targets,
    // Use analysis guidance for assumptions, risks, success criteria
    assumptions: input.analysis.assumptions,
    risks: input.analysis.risks,
    successCriteria: input.analysis.successCriteria,
  });

  return plan;
}
