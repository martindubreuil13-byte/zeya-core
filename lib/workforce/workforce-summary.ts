// Workforce Summary — Clean output for display and decision-making
// Transforms detailed evaluation into actionable brief

import type { WorkforceMember, WorkItem, WorkforceState, WorkforceSummary } from "./workforce-types";
import type { WorkforceEvaluation } from "./workforce-engine";
import { identifyAtRiskTasks } from "./workforce-engine";

// ─── Workforce Summary ───────────────────────────────────────────────────────

export function buildWorkforceSummary(
  evaluation: WorkforceEvaluation,
  members: WorkforceMember[],
  workItems: WorkItem[]
): WorkforceSummary {
  const state = evaluation.state;

  // Determine overall status
  let statusText = "IDLE";
  if (evaluation.overallStatus === "BLOCKED") {
    statusText = "BLOCKED";
  } else if (evaluation.overallStatus === "READY") {
    statusText = "READY";
  } else if (state.inProgressWorkItems.length > 0) {
    statusText = "IN_PROGRESS";
  }

  // Calculate utilization
  const utilizationRate =
    state.totalMembers > 0 ? Math.round(((state.totalMembers - state.availableMembers.length) / state.totalMembers) * 100) : 0;

  // Get active assignments
  const activeAssignments = state.assignedWorkItems
    .concat(state.inProgressWorkItems)
    .slice(0, 5)
    .map((task) => {
      const assignedMember = members.find((m) => m.id === task.assignedTo);
      return {
        memberName: assignedMember?.name || "Unknown",
        taskTitle: task.title,
        missionTitle: `Mission: ${task.missionId}`,
        status: task.status,
      };
    });

  // Needed capabilities
  const usedCapabilities = new Set<string>();
  workItems.forEach((w) => {
    w.requiredCapabilities.forEach((cap) => usedCapabilities.add(cap));
  });

  const teamCapabilities = new Set<string>();
  members.forEach((m) => {
    m.capabilities.forEach((cap) => teamCapabilities.add(cap));
  });

  const neededCapabilities = Array.from(usedCapabilities).filter((cap) => !teamCapabilities.has(cap));

  // At-risk tasks
  const atRiskTasks = identifyAtRiskTasks(workItems, members).map((t) => ({
    taskTitle: t.title,
    reason: t.reason,
  }));

  // Summary text
  let summaryText = "";
  if (state.executionBlocked) {
    summaryText = `Execution blocked: ${state.blockingReason || "Unknown reason"}`;
  } else if (state.inProgressWorkItems.length > 0) {
    summaryText = `${state.inProgressWorkItems.length} task(s) in progress, ${state.availableMembers.length} member(s) available`;
  } else if (state.readyWorkItems.length > 0) {
    summaryText = `Ready to execute: ${state.readyWorkItems.length} work item(s) available, ${state.availableMembers.length} member(s) available`;
  } else {
    summaryText = "Idle: waiting for work items to be ready";
  }

  return {
    status: statusText as "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED",
    readiness: evaluation.readinessScore,
    overallSummary: summaryText,
    availableCapacity: evaluation.capacityAvailable,
    utilizationRate,
    blockingReason: state.blockingReason,
    nextAction: state.nextWorkforceAction,
    recommendedAction: evaluation.nextActions[0] || "Continue monitoring",
    activeAssignments,
    availableMembers: state.availableMembers.map((m) => m.name),
    neededCapabilities,
    atRiskTasks,
  };
}

// ─── Status Formatting ───────────────────────────────────────────────────────

export function formatWorkforceStatus(status: "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED"): string {
  const formatted: Record<string, string> = {
    IDLE: "Idle",
    READY: "Ready ✓",
    IN_PROGRESS: "In Progress",
    BLOCKED: "Blocked ✗",
  };
  return formatted[status] || status;
}

export function formatReadinessBadge(readiness: number): string {
  if (readiness >= 80) return "Highly Ready";
  if (readiness >= 60) return "Mostly Ready";
  if (readiness >= 40) return "Partially Ready";
  return "Not Ready";
}

export function formatCapacityBar(used: number, total: number, width: number = 20): string {
  const utilization = Math.round((used / total) * width);
  const available = width - utilization;
  return `[${"▓".repeat(utilization)}${"░".repeat(available)}] ${Math.round((used / total) * 100)}%`;
}

// ─── Assignment Summary ──────────────────────────────────────────────────────

export interface AssignmentSummary {
  memberName: string;
  currentTask?: string;
  status: string;
  workload: number;
  capacity: number;
  overloaded: boolean;
}

export function buildAssignmentSummaries(
  members: WorkforceMember[],
  workItems: WorkItem[]
): AssignmentSummary[] {
  return members.map((member) => {
    const assignedItem = workItems.find((w) => w.assignedTo === member.id);
    const overloaded = member.currentWorkload >= 80;

    return {
      memberName: member.name,
      currentTask: assignedItem?.title,
      status: member.status,
      workload: member.currentWorkload,
      capacity: Math.max(0, 100 - member.currentWorkload),
      overloaded,
    };
  });
}

// ─── Workforce Health Card ───────────────────────────────────────────────────

export interface WorkforceHealthCard {
  title: string;
  status: string;
  readiness: string;
  capacity: string;
  utilization: number;
  blockingReason: string | null;
  nextAction: string;
}

export function buildWorkforceHealthCard(summary: WorkforceSummary): WorkforceHealthCard {
  return {
    title: "Workforce Status",
    status: formatWorkforceStatus(summary.status),
    readiness: formatReadinessBadge(summary.readiness),
    capacity: `${summary.availableCapacity} hours available`,
    utilization: summary.utilizationRate,
    blockingReason: summary.blockingReason,
    nextAction: summary.nextAction,
  };
}

// ─── Capacity vs. Demand ─────────────────────────────────────────────────────

export interface CapacityAnalysis {
  totalCapacityAvailable: number;
  totalDemand: number;
  surplus: number;
  canHandle: boolean;
  cushion: number; // % buffer above demand
}

export function analyzeCapacity(
  capacityAvailable: number,
  demandRequired: number
): CapacityAnalysis {
  const surplus = capacityAvailable - demandRequired;
  const cushion = demandRequired > 0 ? Math.round((surplus / demandRequired) * 100) : 0;

  return {
    totalCapacityAvailable: capacityAvailable,
    totalDemand: demandRequired,
    surplus,
    canHandle: surplus >= 0,
    cushion,
  };
}

// ─── Workforce Recommendations ──────────────────────────────────────────────

export function generateWorkforceRecommendations(
  summary: WorkforceSummary,
  evaluation: WorkforceEvaluation
): string[] {
  const recommendations: string[] = [];

  // Capacity recommendations
  if (evaluation.capacityAvailable < evaluation.demandRequired) {
    recommendations.push(`Add capacity: ${evaluation.demandRequired - evaluation.capacityAvailable} hours needed`);
  }

  if (evaluation.capacityAvailable < evaluation.demandRequired / 2) {
    recommendations.push("Critical capacity shortage - consider expanding team");
  }

  // Capability recommendations
  if (summary.neededCapabilities.length > 0) {
    recommendations.push(`Add capability: ${summary.neededCapabilities[0]} needed`);
  }

  // Blocker recommendations
  if (evaluation.executionBlockers.length > 0) {
    recommendations.push(`Address blocker: ${evaluation.executionBlockers[0]}`);
  }

  // At-risk recommendations
  if (summary.atRiskTasks.length > 0) {
    recommendations.push(`Monitor ${summary.atRiskTasks.length} at-risk task(s)`);
  }

  return recommendations;
}

// ─── Multi-Workforce View ───────────────────────────────────────────────────

export interface WorkforcePortfolio {
  totalMembers: number;
  availableCount: number;
  assignedCount: number;
  utilization: number;
  totalCapacity: number;
  utilizationStatus: "healthy" | "at-capacity" | "overloaded";
  recommendedAction: string;
}

export function buildWorkforcePortfolio(
  members: WorkforceMember[],
  workItems: WorkItem[]
): WorkforcePortfolio {
  const totalMembers = members.length;
  const availableCount = members.filter((m) => m.status === "AVAILABLE").length;
  const assignedCount = members.filter((m) => m.status === "ASSIGNED" || m.status === "BUSY").length;
  const totalCapacity = members.reduce((sum, m) => sum + (100 - m.currentWorkload), 0);
  const utilization = Math.round(((totalMembers - availableCount) / totalMembers) * 100);

  let utilizationStatus: "healthy" | "at-capacity" | "overloaded" = "healthy";
  if (utilization > 80) {
    utilizationStatus = "overloaded";
  } else if (utilization > 60) {
    utilizationStatus = "at-capacity";
  }

  let recommendedAction = "Continue current assignments";
  if (utilizationStatus === "overloaded") {
    recommendedAction = "Add workforce capacity immediately";
  } else if (availableCount === 0) {
    recommendedAction = "All members assigned - monitor closely";
  }

  return {
    totalMembers,
    availableCount,
    assignedCount,
    utilization,
    totalCapacity,
    utilizationStatus,
    recommendedAction,
  };
}

// ─── Workforce Metrics ───────────────────────────────────────────────────────

export interface WorkforceMetrics {
  memberCount: number;
  workItemCount: number;
  completionRate: number; // % of work done
  assignmentRate: number; // % of work assigned
  capacityUtilization: number;
  averageWorkload: number;
  overloadedMembers: number;
  blockedWorkItems: number;
}

export function calculateWorkforceMetrics(
  members: WorkforceMember[],
  workItems: WorkItem[]
): WorkforceMetrics {
  const completedItems = workItems.filter((w) => w.status === "DONE").length;
  const assignedItems = workItems.filter((w) => w.assignedTo).length;
  const overloadedMembers = members.filter((m) => m.currentWorkload >= 80).length;
  const blockedItems = workItems.filter((w) => w.status === "BLOCKED").length;
  const avgWorkload = members.length > 0 ? Math.round(members.reduce((sum, m) => sum + m.currentWorkload, 0) / members.length) : 0;

  return {
    memberCount: members.length,
    workItemCount: workItems.length,
    completionRate: workItems.length > 0 ? Math.round((completedItems / workItems.length) * 100) : 0,
    assignmentRate: workItems.length > 0 ? Math.round((assignedItems / workItems.length) * 100) : 0,
    capacityUtilization: Math.round(avgWorkload),
    averageWorkload: avgWorkload,
    overloadedMembers,
    blockedWorkItems: blockedItems,
  };
}
