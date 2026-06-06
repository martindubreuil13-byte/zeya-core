// ExecutionPlan to WorkerBriefs — Convert plan steps to worker briefs

import { buildWorkerBrief } from "@/lib/workers";
import type { WorkerBrief } from "@/lib/workers";
import type { ExecutionPlan } from "./execution-plan-types";

export function createWorkerBriefsFromExecutionPlan(plan: ExecutionPlan): WorkerBrief[] {
  return plan.plannedSteps.map((step) => {
    // Create default guidance if not provided
    const defaultKeyQuestions = [
      "What is your current challenge with this?",
      "What have you tried so far?",
      "What would success look like?",
    ];

    const defaultObjectionGuidance = [
      "If not interested now, ask about timeline and what would need to change.",
      "If concerned about cost, explore ROI and value proposition.",
    ];

    const defaultEscalationRules = [
      "If strong interest, escalate to sales team immediately.",
      "If budget constraints but interest, schedule follow-up after budget cycle.",
    ];

    return buildWorkerBrief({
      missionId: plan.missionId,
      executionRequestId: plan.executionRequestId,
      workerType: step.workerType,
      companyContext: plan.companyContext,
      leadContext: step.leadContext || step.target,
      objective: step.objective,
      desiredOutcome: step.desiredOutcome,
      keyQuestions: defaultKeyQuestions,
      objectionGuidance: defaultObjectionGuidance,
      escalationRules: defaultEscalationRules,
      successCriteria: plan.successCriteria,
      dynamicVariables: {
        planId: plan.id,
        stepId: step.id,
        stepNumber: step.stepNumber,
        target: step.target || "generic",
        mode: plan.mode,
        priority: plan.priority,
      },
    });
  });
}
