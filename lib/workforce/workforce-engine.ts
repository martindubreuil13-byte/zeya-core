// Workforce Engine — Deterministic workforce state evaluation
// Evaluates capacity, assignments, blockers, and readiness

import type { WorkforceMember, WorkItem, WorkforceState, WorkforceEvaluation } from "./workforce-types";
import type { Mission } from "@/lib/mission/mission-types";

export type { WorkforceEvaluation };
import {
  calculateMemberAvailability,
  canMemberTakeWork,
  getAvailableMembersWithCapability,
  isWorkItemReady,
  calculateTeamWorkload,
  calculateTeamCapacity,
  calculateWorkforceReadiness,
  detectMemberBlockers,
  detectWorkItemBlockers,
  assessWorkforceStatus,
  calculateUtilizationRate,
  getUnderutilizedMembers,
  type ReadinessFactors,
} from "./workforce-readiness";

// ─── Workforce State Composition ─────────────────────────────────────────────

export function buildWorkforceState(
  members: WorkforceMember[],
  workItems: WorkItem[]
): WorkforceState {
  // Organize members by status
  const availableMembers = members.filter((m) => m.status === "AVAILABLE");
  const assignedMembers = members.filter((m) => m.status === "ASSIGNED");
  const busyMembers = members.filter((m) => m.status === "BUSY");
  const blockedMembers = members.filter((m) => m.status === "BLOCKED");

  // Organize work items by status
  const readyWorkItems = workItems.filter((w) => w.status === "READY");
  const assignedWorkItems = workItems.filter((w) => w.status === "ASSIGNED");
  const inProgressWorkItems = workItems.filter((w) => w.status === "IN_PROGRESS");
  const blockedWorkItems = workItems.filter((w) => w.status === "BLOCKED");
  const completedWorkItems = workItems.filter((w) => w.status === "DONE");

  // Calculate metrics
  const averageWorkload = calculateTeamWorkload(members);
  const status = assessWorkforceStatus(
    availableMembers,
    inProgressWorkItems,
    readyWorkItems,
    blockedWorkItems
  );

  // Determine blocking
  let executionBlocked = false;
  let blockingReason: string | null = null;

  if (availableMembers.length === 0) {
    executionBlocked = true;
    blockingReason = "No workforce member available";
  } else if (readyWorkItems.length === 0) {
    executionBlocked = true;
    blockingReason = "No work item ready";
  } else if (blockedWorkItems.length > 0 && inProgressWorkItems.length === 0) {
    executionBlocked = true;
    blockingReason = "Work items blocked, no progress";
  }

  // Determine next action
  const nextAction = determineNextWorkforceAction(
    availableMembers,
    readyWorkItems,
    blockedWorkItems,
    assignedWorkItems,
    members,
    workItems
  );

  return {
    availableMembers,
    assignedMembers,
    busyMembers,
    blockedMembers,
    readyWorkItems,
    assignedWorkItems,
    inProgressWorkItems,
    blockedWorkItems,
    completedWorkItems,
    totalMembers: members.length,
    totalWorkItems: workItems.length,
    averageWorkload,
    workforceReadiness: 0, // Will be calculated in evaluation
    executionReady: !executionBlocked && readyWorkItems.length > 0,
    executionBlocked,
    blockingReason,
    nextWorkforceAction: nextAction,
    evaluatedAt: new Date().toISOString(),
  };
}

// ─── Readiness Calculation ──────────────────────────────────────────────────

export function calculateReadinessFactors(
  mission: Mission | null,
  availableMembers: WorkforceMember[],
  readyWorkItems: WorkItem[],
  teamMembers: WorkforceMember[]
): ReadinessFactors {
  // Factor 1: Mission exists
  const missionExists = mission !== null ? 20 : 0;

  // Factor 2: Mission has clear next action
  const missionHasAction = mission && mission.blockingAssumptions?.length === 0 ? 20 : 0;

  // Factor 3: At least one member available
  const memberAvailable = availableMembers.length > 0 ? 20 : 0;

  // Factor 4: Required capability exists (check all team capabilities)
  const teamCapabilities = new Set<string>();
  teamMembers.forEach((m) => {
    m.capabilities.forEach((cap) => teamCapabilities.add(cap));
  });
  const capabilityExists = teamCapabilities.size > 0 ? 20 : 0;

  // Factor 5: At least one ready work item exists
  const workItemReady = readyWorkItems.length > 0 ? 20 : 0;

  return {
    missionExists,
    missionHasAction,
    memberAvailable,
    capabilityExists,
    workItemReady,
  };
}

// ─── Execution Blocker Determination ─────────────────────────────────────────

export function deriveExecutionBlockers(
  state: WorkforceState,
  members: WorkforceMember[],
  workItems: WorkItem[]
): string[] {
  const blockers: string[] = [];

  // Check member availability
  if (state.availableMembers.length === 0) {
    blockers.push("No workforce member available");
  }

  // Check work readiness
  if (state.readyWorkItems.length === 0) {
    blockers.push("No work item ready");
  }

  // Check capacity
  const teamCapacity = calculateTeamCapacity(state.availableMembers);
  if (teamCapacity < 30) {
    blockers.push("Insufficient team capacity");
  }

  // Check team capabilities
  const teamCapabilities = new Set<string>();
  members.forEach((m) => {
    m.capabilities.forEach((cap) => teamCapabilities.add(cap));
  });

  // Check if calling work exists but no caller
  const hasCallingWork = workItems.some((w) => w.type === "CALLING" && w.status !== "DONE");
  if (hasCallingWork && !teamCapabilities.has("calling")) {
    blockers.push("Calling work exists but no caller available");
  }

  // Check for blocked items preventing progress
  if (state.blockedWorkItems.length > 0 && state.inProgressWorkItems.length === 0) {
    blockers.push("Work items blocked, no progress on other items");
  }

  return blockers;
}

export function deriveMemberBlockers(
  members: WorkforceMember[]
): Array<{ memberId: string; reason: string }> {
  const memberBlockers: Array<{ memberId: string; reason: string }> = [];

  for (const member of members) {
    const blocker = detectMemberBlockers(member);
    if (blocker) {
      memberBlockers.push({
        memberId: member.id,
        reason: blocker,
      });
    }
  }

  return memberBlockers;
}

export function deriveWorkItemBlockers(
  workItems: WorkItem[],
  members: WorkforceMember[]
): Array<{ workItemId: string; reason: string }> {
  const itemBlockers: Array<{ workItemId: string; reason: string }> = [];

  for (const workItem of workItems) {
    const blocker = detectWorkItemBlockers(workItem, members);
    if (blocker) {
      itemBlockers.push({
        workItemId: workItem.id,
        reason: blocker,
      });
    }
  }

  return itemBlockers;
}

// ─── Next Workforce Action ──────────────────────────────────────────────────

export function determineNextWorkforceAction(
  availableMembers: WorkforceMember[],
  readyWorkItems: WorkItem[],
  blockedWorkItems: WorkItem[],
  assignedWorkItems: WorkItem[],
  allMembers: WorkforceMember[],
  allWorkItems: WorkItem[]
): string {
  // Priority 1: Resolve blocked items
  if (blockedWorkItems.length > 0) {
    const blocker = blockedWorkItems[0];
    const blockReason = detectWorkItemBlockers(blocker, allMembers);
    if (blockReason) {
      return `Resolve blocker: ${blockReason}`;
    }
  }

  // Priority 2: Add member if none available
  if (availableMembers.length === 0) {
    // Check what capability is needed
    if (readyWorkItems.length > 0) {
      const needed = readyWorkItems[0].requiredCapabilities[0];
      return `Add ${needed} workforce member`;
    }
    return "Add a workforce member";
  }

  // Priority 3: Create work item if none ready
  if (readyWorkItems.length === 0) {
    return "Create the next work item for the mission";
  }

  // Priority 4: Assign work if items are ready but unassigned
  const unassignedReady = readyWorkItems.filter((w) => !w.assignedTo);
  if (unassignedReady.length > 0) {
    const workType = unassignedReady[0].type;
    return `Assign a ${workType} work item`;
  }

  // Priority 5: Start assigned work
  const assignedNotStarted = assignedWorkItems.filter((w) => w.status === "ASSIGNED");
  if (assignedNotStarted.length > 0) {
    return `Start the assigned ${assignedNotStarted[0].type} work`;
  }

  // Priority 6: Continue in-progress work
  const inProgress = allWorkItems.filter((w) => w.status === "IN_PROGRESS");
  if (inProgress.length > 0) {
    return `Continue executing assigned work (${inProgress.length} items in progress)`;
  }

  return "Monitor workforce status";
}

// ─── At-Risk Detection ───────────────────────────────────────────────────────

export function identifyAtRiskTasks(
  workItems: WorkItem[],
  members: WorkforceMember[]
): Array<{ taskId: string; title: string; reason: string }> {
  const atRisk: Array<{ taskId: string; title: string; reason: string }> = [];

  for (const item of workItems) {
    if (item.status === "IN_PROGRESS" || item.status === "ASSIGNED") {
      // Check if assigned member is overloaded
      if (item.assignedTo) {
        const assignedMember = members.find((m) => m.id === item.assignedTo);
        if (assignedMember && assignedMember.currentWorkload >= 80) {
          atRisk.push({
            taskId: item.id,
            title: item.title,
            reason: "Assigned member is overloaded",
          });
          continue;
        }
      }

      // Check if due date is soon
      if (item.dueDate) {
        const daysUntilDue = (new Date(item.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntilDue < 2 && item.status === "ASSIGNED") {
          atRisk.push({
            taskId: item.id,
            title: item.title,
            reason: "Due soon but not started",
          });
          continue;
        }
      }
    }
  }

  return atRisk;
}

// ─── Full Evaluation ─────────────────────────────────────────────────────────

export function evaluateWorkforceState(
  members: WorkforceMember[],
  workItems: WorkItem[],
  mission: Mission | null
): WorkforceEvaluation {
  const state = buildWorkforceState(members, workItems);
  const readinessFactors = calculateReadinessFactors(
    mission,
    state.availableMembers,
    state.readyWorkItems,
    members
  );
  const readinessScore = calculateWorkforceReadiness(readinessFactors);

  const executionBlockers = deriveExecutionBlockers(state, members, workItems);
  const memberBlockers = deriveMemberBlockers(members);
  const workItemBlockers = deriveWorkItemBlockers(workItems, members);

  const nextActions: string[] = [];
  if (executionBlockers.length > 0) {
    nextActions.push(`Resolve: ${executionBlockers[0]}`);
  }
  nextActions.push(state.nextWorkforceAction);

  const capacityNeeded = workItems
    .filter((w) => w.status !== "DONE")
    .reduce((sum, w) => sum + (w.estimatedHours || 4), 0);
  const capacityAvailable = members.reduce((sum, m) => {
    return sum + (Math.max(0, 40 - (m.currentWorkload / 100) * 40));
  }, 0);

  return {
    state,
    readinessFactors: {
      hasMission: readinessFactors.missionExists > 0,
      missionHasAction: readinessFactors.missionHasAction > 0,
      hasAvailableMember: readinessFactors.memberAvailable > 0,
      hasRequiredCapability: readinessFactors.capabilityExists > 0,
      hasReadyWorkItem: readinessFactors.workItemReady > 0,
    },
    executionBlockers,
    memberBlockers,
    workItemBlockers,
    nextActions: [...new Set(nextActions)],
    capacityAvailable: Math.round(capacityAvailable),
    demandRequired: Math.round(capacityNeeded),
    overallStatus: state.executionBlocked ? "BLOCKED" : state.executionReady ? "READY" : "IDLE",
    readinessScore,
  };
}
