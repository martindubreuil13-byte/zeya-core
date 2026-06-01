// Operating state computation: health, blockers, readiness, next action

import type {
  OperatingHealth,
  OperatingBlocker,
  ReevaluationContext,
  OperatingState,
} from "./autonomy-types";
import type { BusinessState } from "@/lib/workflow/types";
import type { ExecutiveGuidance } from "@/lib/workflow/derive-executive-guidance";
import type { ConversationObjective } from "@/lib/workflow/conversation-objective-types";
import type { MissionEvaluation } from "@/lib/mission/mission-types";
import type { WorkforceEvaluation } from "@/lib/workforce/workforce-types";
import type { ExecutionPlan } from "@/lib/orchestration/orchestration-types";

// Build initial operating state from fresh context
export function buildInitialOperatingState(
  businessState: BusinessState,
  executiveGuidance: ExecutiveGuidance,
  conversationObjective: ConversationObjective,
  missionEvaluation: MissionEvaluation,
  workforceEvaluation: WorkforceEvaluation,
  executionPlan: ExecutionPlan,
  businessId: string,
  missionId: string
): OperatingState {
  const blockers = deriveOperatingBlockers(
    businessState,
    missionEvaluation,
    workforceEvaluation,
    executionPlan
  );

  const health = calculateOperatingHealth(
    businessState,
    missionEvaluation,
    workforceEvaluation,
    executionPlan
  );

  const readiness = calculateOperatingReadiness(
    businessState,
    missionEvaluation,
    workforceEvaluation,
    executionPlan
  );

  const nextAction = determineOperatingNextAction(
    businessState,
    missionEvaluation,
    workforceEvaluation,
    executionPlan,
    blockers
  );

  return {
    businessId,
    missionId,
    businessState,
    executiveGuidance,
    conversationObjective,
    missionEvaluation,
    workforceEvaluation,
    executionPlan,
    operatingHealth: health,
    blockers,
    nextAction,
    readiness,
    lastUpdated: new Date().toISOString(),
  };
}

// Calculate composite health score from all systems
export function calculateOperatingHealth(
  businessState: BusinessState,
  missionEvaluation: MissionEvaluation,
  workforceEvaluation: WorkforceEvaluation,
  executionPlan: ExecutionPlan
): OperatingHealth {
  // Each system contributes 25 points to total 100
  const workflowScore = businessState.readinessScore * 0.25;
  const missionScore = (missionEvaluation.confidence / 100) * 25;
  const workforceScore = (workforceEvaluation.readinessScore / 100) * 25;
  const executionScore = (executionPlan.readiness / 100) * 25;

  const totalScore = workflowScore + missionScore + workforceScore + executionScore;

  let status: "HEALTHY" | "AT_RISK" | "CRITICAL";
  if (totalScore >= 70) {
    status = "HEALTHY";
  } else if (totalScore >= 40) {
    status = "AT_RISK";
  } else {
    status = "CRITICAL";
  }

  return {
    score: Math.round(totalScore),
    status,
    workflowScore: Math.round(workflowScore),
    missionScore: Math.round(missionScore),
    workforceScore: Math.round(workforceScore),
    executionScore: Math.round(executionScore),
  };
}

// Aggregate blockers from all systems
export function deriveOperatingBlockers(
  businessState: BusinessState,
  missionEvaluation: MissionEvaluation,
  workforceEvaluation: WorkforceEvaluation,
  executionPlan: ExecutionPlan
): OperatingBlocker[] {
  const blockers: OperatingBlocker[] = [];

  // Workflow blockers
  if (businessState.isBlocked && businessState.blockingReason) {
    blockers.push({
      source: "WORKFLOW",
      severity: "HIGH",
      message: businessState.blockingReason,
      resolutionHint: `Address: ${businessState.blockingReason}`,
    });
  }

  // Mission risks become HIGH blockers
  if (missionEvaluation.risks && missionEvaluation.risks.length > 0) {
    missionEvaluation.risks.slice(0, 2).forEach((risk) => {
      blockers.push({
        source: "MISSION",
        severity: "HIGH",
        message: risk,
        resolutionHint: `Mitigate risk: ${risk}`,
      });
    });
  }

  // Workforce blockers
  if (workforceEvaluation.executionBlockers && workforceEvaluation.executionBlockers.length > 0) {
    workforceEvaluation.executionBlockers.forEach((blocker) => {
      blockers.push({
        source: "WORKFORCE",
        severity: "HIGH",
        message: blocker,
        resolutionHint: `Add or reassign workforce: ${blocker}`,
      });
    });
  }

  // Execution plan blockers
  if (executionPlan.blockers && executionPlan.blockers.length > 0) {
    executionPlan.blockers.slice(0, 3).forEach((planBlocker) => {
      const severityMap = {
        CRITICAL: "CRITICAL" as const,
        HIGH: "HIGH" as const,
        MEDIUM: "MEDIUM" as const,
        LOW: "LOW" as const,
      };

      blockers.push({
        source: "EXECUTION_PLAN",
        severity: severityMap[planBlocker.severity] || "MEDIUM",
        message: planBlocker.message,
        resolutionHint: planBlocker.message,
      });
    });
  }

  return blockers;
}

// Calculate overall readiness 0-100 from all systems
export function calculateOperatingReadiness(
  businessState: BusinessState,
  missionEvaluation: MissionEvaluation,
  workforceEvaluation: WorkforceEvaluation,
  executionPlan: ExecutionPlan
): number {
  const workflowReadiness = businessState.readinessScore * 0.25;
  const missionReadiness = ((missionEvaluation.progress || 0) / 100) * 25;
  const workforceReadiness = (workforceEvaluation.readinessScore / 100) * 25;
  const executionReadiness = (executionPlan.readiness / 100) * 25;

  const total = workflowReadiness + missionReadiness + workforceReadiness + executionReadiness;
  return Math.round(total);
}

// Determine next action from priority waterfall
export function determineOperatingNextAction(
  businessState: BusinessState,
  missionEvaluation: MissionEvaluation,
  workforceEvaluation: WorkforceEvaluation,
  executionPlan: ExecutionPlan,
  blockers: OperatingBlocker[]
): string {
  // Priority 1: Critical blockers
  const criticalBlockers = blockers.filter((b) => b.severity === "CRITICAL");
  if (criticalBlockers.length > 0) {
    return `Resolve critical blocker: ${criticalBlockers[0].resolutionHint}`;
  }

  // Priority 2: Workflow blocked
  if (businessState.isBlocked) {
    return businessState.nextAction || "Unblock workflow";
  }

  // Priority 3: Mission blocked
  if (missionEvaluation.risks && missionEvaluation.risks.length > 0) {
    return missionEvaluation.nextBestAction || "Mitigate mission risks";
  }

  // Priority 4: Workforce blocked
  if (workforceEvaluation.state.executionBlocked) {
    return "Resolve workforce availability";
  }

  // Priority 5: Execution blocked
  if (executionPlan.status === "BLOCKED") {
    return executionPlan.nextAction || "Resolve execution blockers";
  }

  // All clear — execution plan next action
  return executionPlan.nextAction || "Monitor execution progress";
}
