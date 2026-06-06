// Mission to Operational Intelligence bridge
// Adapts an existing Mission into the existing analysis -> plan -> brief flow.

import type { Mission } from "@/lib/mission";
import {
  analyzeOperationalMission,
  buildExecutionPlanFromOperationalAnalysis,
  createWorkerBriefsFromOperationalAnalysis,
} from "@/lib/operational-intelligence";
import type {
  OperationalAnalysisIntent,
  OperationalIntelligenceAnalysis,
} from "@/lib/operational-intelligence";
import type { ExecutionPlan } from "@/lib/execution-plans";
import type { WorkerBrief } from "@/lib/workers";

export interface MissionExecutionBridgeOptions {
  executionRequestId?: string;
  targetContext?: string;
  knownMemory?: string[];
  intent?: OperationalAnalysisIntent;
}

export interface MissionExecutionBridgeResult {
  mission: Mission;
  analysis: OperationalIntelligenceAnalysis;
  plan: ExecutionPlan;
  briefs: WorkerBrief[];
}

function priorityToExecutionPriority(
  priority: Mission["priority"]
): "LOW" | "NORMAL" | "HIGH" {
  if (priority === "high") return "HIGH";
  if (priority === "low") return "LOW";
  return "NORMAL";
}

function missionContextFromMission(mission: Mission): string {
  return [
    mission.title,
    mission.hypothesis,
    mission.description,
    mission.findings.length > 0 ? `Findings: ${mission.findings.join("; ")}` : null,
    mission.openQuestions.length > 0
      ? `Open questions: ${mission.openQuestions.join("; ")}`
      : null,
    mission.blockingAssumptions.length > 0
      ? `Blocking assumptions: ${mission.blockingAssumptions.join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function companyContextFromMission(mission: Mission): string {
  return [
    `Business ${mission.businessId}`,
    mission.tags?.length ? `Mission tags: ${mission.tags.join(", ")}` : null,
    mission.risks.length > 0 ? `Known risks: ${mission.risks.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function processMissionForExecution(
  mission: Mission,
  options: MissionExecutionBridgeOptions = {}
): MissionExecutionBridgeResult {
  const companyContext = companyContextFromMission(mission);
  const missionContext = missionContextFromMission(mission);
  const desiredOutcome = mission.targetOutcome;

  const analysis = analyzeOperationalMission({
    missionId: mission.id,
    executionRequestId: options.executionRequestId,
    companyContext,
    missionContext,
    targetContext: options.targetContext,
    desiredOutcome,
    knownMemory: options.knownMemory,
    intent: options.intent,
  });

  const plan = buildExecutionPlanFromOperationalAnalysis({
    missionId: mission.id,
    executionRequestId: options.executionRequestId,
    title: mission.title,
    companyContext,
    missionObjective: missionContext,
    desiredOutcome,
    priority: priorityToExecutionPriority(mission.priority),
    analysis,
  });

  const briefs = createWorkerBriefsFromOperationalAnalysis(plan, analysis);

  return {
    mission,
    analysis,
    plan,
    briefs,
  };
}
