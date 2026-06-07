// Operational Brief Builder — Create WorkerBriefs with operational intelligence

import { buildWorkerBrief } from "@/lib/workers";
import type { WorkerBrief } from "@/lib/workers";
import type { ExecutionPlan, ExecutionPlanStep } from "@/lib/execution-plans";
import type { OperationalIntelligenceAnalysis } from "./operational-intelligence-types";

export function createWorkerBriefsFromOperationalAnalysis(
  plan: ExecutionPlan,
  analysis: OperationalIntelligenceAnalysis
): WorkerBrief[] {
  return plan.plannedSteps.map((step) => {
    // Use analysis guidance instead of defaults
    return buildWorkerBrief({
      missionId: plan.missionId,
      executionRequestId: plan.executionRequestId,
      workerType: step.workerType,
      companyContext: plan.companyContext,
      leadContext: step.leadContext || step.target,
      objective: step.objective,
      desiredOutcome: step.desiredOutcome,
      // Use analysis guidance directly
      keyQuestions: analysis.keyQuestions,
      objectionGuidance: analysis.objectionGuidance,
      escalationRules: analysis.escalationRules,
      successCriteria: analysis.successCriteria,
      toneGuidance: analysis.recommendedTone,
      // Include analysis intelligence in dynamic variables
      dynamicVariables: {
        planId: plan.id,
        stepId: step.id,
        stepNumber: step.stepNumber,
        target: step.target || "generic",
        targetPhone: (step as any).targetPhone || null,
        mode: plan.mode,
        priority: plan.priority,
        // Add operational intelligence
        intent: analysis.intent,
        confidence: analysis.confidence,
        inferredTrigger: analysis.inferredTrigger || null,
        inferredAudience: analysis.inferredAudience || null,
        inferredBusinessModel: analysis.inferredBusinessModel || null,
        keyTalkingPoints: analysis.keyTalkingPoints.join(" | "),
        inferredPainPoints: analysis.inferredPainPoints.join(" | "),
      },
    });
  });
}
