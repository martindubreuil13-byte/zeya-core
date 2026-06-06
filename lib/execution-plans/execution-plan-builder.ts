// ExecutionPlan Builder — Convert a mission into an operational plan

import type {
  ExecutionPlan,
  ExecutionPlanStep,
  ExecutionPlanPriority,
  ExecutionPlanMode,
} from "./execution-plan-types";

function generateId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export interface ExecutionTarget {
  id: string; // lead ID, email, phone, etc.
  name?: string; // Lead/prospect name
  phone?: string; // Phone number if available
  context?: string; // Additional context about this target
}

export interface ExecutionPlanInput {
  missionId: string;
  executionRequestId?: string;
  title: string;
  companyContext: string;
  missionObjective: string;
  desiredOutcome: string;
  priority?: ExecutionPlanPriority; // defaults to NORMAL
  mode?: ExecutionPlanMode; // defaults to SINGLE or BATCH based on targets
  targets?: ExecutionTarget[]; // If provided, create one step per target
  assumptions?: string[];
  risks?: string[];
  successCriteria: string;
}

export function buildExecutionPlan(input: ExecutionPlanInput): ExecutionPlan {
  // Validate required fields
  const required = ["missionId", "title", "companyContext", "missionObjective", "desiredOutcome", "successCriteria"];
  for (const field of required) {
    if (!(field in input) || !input[field as keyof ExecutionPlanInput]) {
      throw new Error(`${field} is required`);
    }
  }

  const now = new Date().toISOString();
  const planId = generateId();

  // Determine mode based on targets
  const hasTargets = input.targets && input.targets.length > 0;
  const targetCount = input.targets?.length ?? 0;
  let mode = input.mode;
  if (!mode) {
    if (!hasTargets || targetCount === 1) {
      mode = "SINGLE";
    } else {
      mode = "BATCH"; // Multiple targets default to BATCH
    }
  }

  // Create planned steps
  const plannedSteps: ExecutionPlanStep[] = [];

  if (hasTargets && targetCount > 0) {
    // One step per target
    for (let i = 0; i < input.targets!.length; i++) {
      const target = input.targets![i];
      plannedSteps.push({
        id: generateStepId(),
        planId,
        stepNumber: i + 1,
        workerType: "CALLER", // Default to CALLER for now
        objective: `${input.missionObjective} - ${target.name || target.id}`,
        target: target.name || target.id,
        leadContext: target.context || `Target: ${target.name || target.id}`,
        desiredOutcome: input.desiredOutcome,
        status: "READY",
        dependencies: i > 0 && mode === "SEQUENTIAL" ? [plannedSteps[i - 1].id] : [],
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    // Generic step with no specific target
    plannedSteps.push({
      id: generateStepId(),
      planId,
      stepNumber: 1,
      workerType: "CALLER",
      objective: input.missionObjective,
      desiredOutcome: input.desiredOutcome,
      status: "READY",
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  const plan: ExecutionPlan = {
    id: planId,
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    title: input.title,
    status: "READY",
    priority: input.priority || "NORMAL",
    mode,
    companyContext: input.companyContext,
    missionObjective: input.missionObjective,
    desiredOutcome: input.desiredOutcome,
    totalTargets: hasTargets ? targetCount : undefined,
    plannedSteps,
    assumptions: input.assumptions || [],
    risks: input.risks || [],
    successCriteria: input.successCriteria,
    createdAt: now,
    updatedAt: now,
  };

  return plan;
}
