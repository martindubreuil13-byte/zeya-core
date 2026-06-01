// Executive summaries from operating state

import type { OperatingState, AutonomySummary } from "./autonomy-types";

export function buildAutonomySummary(state: OperatingState, previousState?: OperatingState): AutonomySummary {
  const topBlockers = state.blockers.slice(0, 3);

  const recommendations = deriveRecommendations(state, previousState);
  const executiveSummary = buildExecutiveSummary(state);

  return {
    health: state.operatingHealth,
    readiness: state.readiness,
    blockers: topBlockers,
    nextAction: state.nextAction,
    changedSystems: state.changedSystems || [],
    recommendations,
    executiveSummary,
    generatedAt: new Date().toISOString(),
  };
}

// Generate plain-English executive summary
function buildExecutiveSummary(state: OperatingState): string {
  const health = state.operatingHealth.status;
  const readiness = state.readiness;
  const missionStatus = state.missionEvaluation.status;
  const executionStatus = state.executionPlan.status;

  if (state.operatingHealth.status === "CRITICAL") {
    return `Operating status is CRITICAL (${state.operatingHealth.score}%). ${
      state.blockers.length > 0
        ? `${state.blockers[0].message}`
        : "Multiple systems need attention."
    } Next action: ${state.nextAction}`;
  }

  if (state.operatingHealth.status === "AT_RISK") {
    return `Operating status is AT RISK (${state.operatingHealth.score}%). Mission ${missionStatus.toLowerCase()}, execution ${executionStatus.toLowerCase()}. Readiness: ${readiness}%. Next: ${state.nextAction}`;
  }

  return `Operating status is HEALTHY (${state.operatingHealth.score}%). Mission ${missionStatus.toLowerCase()}, execution at ${readiness}% readiness. Next: ${state.nextAction}`;
}

// Derive actionable recommendations based on current state
function deriveRecommendations(state: OperatingState, previousState?: OperatingState): string[] {
  const recommendations: string[] = [];

  // Workflow recommendations
  if (state.businessState.isBlocked) {
    recommendations.push(`Address workflow blocker: ${state.businessState.blockingReason}`);
  }
  if (state.businessState.currentStage === "ONBOARDING") {
    recommendations.push("Complete business profile to unlock mission definition");
  }

  // Mission recommendations
  if (state.missionEvaluation.status === "NOT_STARTED") {
    recommendations.push("Define a mission to align work planning");
  }
  if (state.missionEvaluation.risks && state.missionEvaluation.risks.length > 0) {
    recommendations.push(`Mitigate mission risk: ${state.missionEvaluation.risks[0]}`);
  }
  if (state.missionEvaluation.confidence < 30) {
    recommendations.push("Gather more evidence to validate mission hypothesis");
  }

  // Workforce recommendations
  if (state.workforceEvaluation.state.executionBlocked) {
    recommendations.push("Resolve workforce availability to enable execution");
  }
  if (state.workforceEvaluation.state.availableMembers && state.workforceEvaluation.state.availableMembers.length === 0) {
    recommendations.push("Add team members to enable work execution");
  }

  // Execution recommendations
  if (state.executionPlan.status === "BLOCKED" && state.executionPlan.blockers.length > 0) {
    recommendations.push(`Resolve execution blocker: ${state.executionPlan.blockers[0].message}`);
  }
  if (state.executionPlan.workItems && state.executionPlan.workItems.length > 0) {
    const readyItems = state.executionPlan.workItems.filter((item) => item.status === "READY");
    if (readyItems.length > 0) {
      recommendations.push(`${readyItems.length} work item(s) ready to assign`);
    }
  }

  // Change-based recommendations
  if (previousState && state.changedSystems && state.changedSystems.length > 0) {
    if (state.changedSystems.includes("MISSION") && previousState.missionEvaluation.confidence < state.missionEvaluation.confidence) {
      recommendations.push(
        `Mission confidence increased from ${previousState.missionEvaluation.confidence}% to ${state.missionEvaluation.confidence}%`
      );
    }
    if (state.changedSystems.includes("EXECUTION_PLAN")) {
      const newWorkItems = (state.executionPlan.workItems || []).length - ((previousState.executionPlan.workItems || []).length || 0);
      if (newWorkItems > 0) {
        recommendations.push(`${newWorkItems} new work item(s) generated`);
      }
    }
  }

  return recommendations.slice(0, 5);
}
