// WorkerBrief Builder — Zeya generates mission-specific briefs for workers

import type { WorkerBrief, WorkerType } from "./worker-brief-types";

function generateId(): string {
  return `brief_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function getWorkerNameForType(workerType: WorkerType): string {
  const workerNames: Record<WorkerType, string> = {
    CALLER: "Veya",
    RESEARCHER: "Nova",
    OUTREACH: "Echo",
    SCHEDULER: "Sage",
    ANALYST: "Iris",
  };
  return workerNames[workerType];
}

export interface WorkerBriefInput {
  missionId: string;
  executionRequestId?: string;
  workerType: WorkerType;
  companyContext: string;
  leadContext?: string;
  objective: string;
  desiredOutcome: string;
  keyQuestions: string[];
  objectionGuidance: string[];
  escalationRules: string[];
  successCriteria: string;
  toneGuidance?: string;
  dynamicVariables?: Record<string, string | number | boolean | null>;
}

export function buildWorkerBrief(input: WorkerBriefInput): WorkerBrief {
  // Validate required fields
  if (!input.missionId) {
    throw new Error("missionId is required");
  }
  if (!input.workerType) {
    throw new Error("workerType is required");
  }
  if (!input.companyContext) {
    throw new Error("companyContext is required");
  }
  if (!input.objective) {
    throw new Error("objective is required");
  }
  if (!input.desiredOutcome) {
    throw new Error("desiredOutcome is required");
  }

  const now = new Date().toISOString();
  const workerName = getWorkerNameForType(input.workerType);

  // Build dynamic variables from brief fields for future substitution
  const dynamicVariables: Record<string, string | number | boolean | null> = {
    workerName,
    workerType: input.workerType,
    objective: input.objective,
    missionObjective: input.objective, // Alias for ElevenLabs compatibility
    missionId: input.missionId,
    desiredOutcome: input.desiredOutcome || null,
    companyContext: input.companyContext || null,
    leadContext: input.leadContext || null,
    ...input.dynamicVariables,
  };

  const brief: WorkerBrief = {
    id: generateId(),
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    workerType: input.workerType,
    workerName,
    status: "READY",
    companyContext: input.companyContext,
    leadContext: input.leadContext,
    objective: input.objective,
    desiredOutcome: input.desiredOutcome,
    keyQuestions: input.keyQuestions,
    objectionGuidance: input.objectionGuidance,
    escalationRules: input.escalationRules,
    successCriteria: input.successCriteria,
    toneGuidance: input.toneGuidance,
    dynamicVariables,
    createdAt: now,
    updatedAt: now,
  };

  return brief;
}
