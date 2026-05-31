// Workforce Readiness — Deterministic readiness and capacity scoring

import type { WorkforceMember, WorkItem, WorkforceRole } from "./workforce-types";

// ─── Member Availability Scoring ────────────────────────────────────────────

export function calculateMemberAvailability(member: WorkforceMember): number {
  let score = 100;

  // Status impacts availability
  switch (member.status) {
    case "AVAILABLE":
      score = 100;
      break;
    case "ASSIGNED":
      score = 80;
      break;
    case "BUSY":
      score = 40;
      break;
    case "BLOCKED":
      score = 0;
      break;
    case "INACTIVE":
      score = 0;
      break;
  }

  // Workload impacts availability
  score = score * (1 - member.currentWorkload / 100);

  return Math.max(0, Math.round(score));
}

export function canMemberTakeWork(member: WorkforceMember): boolean {
  return member.status === "AVAILABLE" && member.currentWorkload < 80;
}

export function calculateTeamAvailability(members: WorkforceMember[]): number {
  if (members.length === 0) return 0;

  const availableCount = members.filter((m) => m.status === "AVAILABLE").length;
  return Math.round((availableCount / members.length) * 100);
}

// ─── Capability Matching ────────────────────────────────────────────────────

export function memberHasCapability(member: WorkforceMember, capability: string): boolean {
  return member.capabilities.includes(capability);
}

export function memberHasAllCapabilities(
  member: WorkforceMember,
  requiredCapabilities: string[]
): boolean {
  return requiredCapabilities.every((cap) => member.capabilities.includes(cap));
}

export function findMembersWithCapability(
  members: WorkforceMember[],
  capability: string
): WorkforceMember[] {
  return members.filter((m) => m.capabilities.includes(capability));
}

export function hasTeamCapability(members: WorkforceMember[], capability: string): boolean {
  return members.some((m) => m.capabilities.includes(capability));
}

export function getAvailableMembersWithCapability(
  members: WorkforceMember[],
  capability: string
): WorkforceMember[] {
  return members.filter((m) => memberHasCapability(m, capability) && canMemberTakeWork(m));
}

// ─── Work Item Readiness ────────────────────────────────────────────────────

export function isWorkItemReady(workItem: WorkItem): boolean {
  return workItem.status === "READY" && !workItem.blocker;
}

export function isWorkItemBlockedByCapability(
  workItem: WorkItem,
  teamCapabilities: Set<string>
): boolean {
  return workItem.requiredCapabilities.some((cap) => !teamCapabilities.has(cap));
}

export function getCapabilityGap(
  workItem: WorkItem,
  teamCapabilities: Set<string>
): string[] {
  return workItem.requiredCapabilities.filter((cap) => !teamCapabilities.has(cap));
}

// ─── Workload Calculation ───────────────────────────────────────────────────

export function calculateTeamWorkload(members: WorkforceMember[]): number {
  if (members.length === 0) return 0;

  const totalWorkload = members.reduce((sum, m) => sum + m.currentWorkload, 0);
  return Math.round(totalWorkload / members.length);
}

export function calculateTeamCapacity(members: WorkforceMember[]): number {
  if (members.length === 0) return 0;

  const availableCapacity = members.reduce((sum, m) => {
    // Available capacity = availability * (100 - workload) / 100
    const availability = calculateMemberAvailability(m);
    return sum + availability;
  }, 0);

  return Math.round(availableCapacity / members.length);
}

export function canTeamHandleWorkload(members: WorkforceMember[], newWorkloadHours: number): boolean {
  const totalAvailableHours = members.reduce((sum, m) => {
    const availability = calculateMemberAvailability(m);
    const hoursAvailable = (availability / 100) * 40; // Assume 40-hour week
    return sum + hoursAvailable;
  }, 0);

  return newWorkloadHours <= totalAvailableHours;
}

// ─── Workforce Readiness Scoring ────────────────────────────────────────────

export interface ReadinessFactors {
  missionExists: number; // 0 or 20
  missionHasAction: number; // 0 or 20
  memberAvailable: number; // 0 or 20
  capabilityExists: number; // 0 or 20
  workItemReady: number; // 0 or 20
}

export function calculateWorkforceReadiness(factors: ReadinessFactors): number {
  const total =
    factors.missionExists +
    factors.missionHasAction +
    factors.memberAvailable +
    factors.capabilityExists +
    factors.workItemReady;

  return Math.min(100, Math.max(0, total));
}

// ─── Execution Readiness ────────────────────────────────────────────────────

export function isExecutionReady(
  missionExists: boolean,
  missionHasAction: boolean,
  availableMembers: WorkforceMember[],
  requiredCapability: string,
  readyWorkItems: WorkItem[]
): boolean {
  return (
    missionExists &&
    missionHasAction &&
    availableMembers.length > 0 &&
    availableMembers.some((m) => m.capabilities.includes(requiredCapability)) &&
    readyWorkItems.length > 0
  );
}

// ─── Blocker Detection ───────────────────────────────────────────────────────

export function detectMemberBlockers(member: WorkforceMember): string | null {
  if (member.status === "BLOCKED") {
    return "Member is blocked";
  }
  if (member.status === "INACTIVE") {
    return "Member is inactive";
  }
  if (member.currentWorkload >= 100) {
    return "Member at full capacity";
  }
  if (member.currentWorkload >= 80) {
    return "Member approaching capacity";
  }
  return null;
}

export function detectWorkItemBlockers(
  workItem: WorkItem,
  teamMembers: WorkforceMember[]
): string | null {
  if (workItem.blocker) {
    return workItem.blocker;
  }

  // Check if required capabilities exist
  const teamCapabilities = new Set<string>();
  teamMembers.forEach((m) => {
    m.capabilities.forEach((cap) => teamCapabilities.add(cap));
  });

  const missingCapabilities = workItem.requiredCapabilities.filter(
    (cap) => !teamCapabilities.has(cap)
  );

  if (missingCapabilities.length > 0) {
    return `Missing capability: ${missingCapabilities[0]}`;
  }

  // Check if dependency is met
  if (workItem.dependsOnWorkItemId) {
    return "Waiting for dependency to complete";
  }

  return null;
}

// ─── Status Assessment ───────────────────────────────────────────────────────

export function assessWorkforceStatus(
  availableMembers: WorkforceMember[],
  inProgressWorkItems: WorkItem[],
  readyWorkItems: WorkItem[],
  blockedWorkItems: WorkItem[]
): "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED" {
  if (blockedWorkItems.length > 0 && inProgressWorkItems.length === 0) {
    return "BLOCKED";
  }

  if (inProgressWorkItems.length > 0) {
    return "IN_PROGRESS";
  }

  if (availableMembers.length > 0 && readyWorkItems.length > 0) {
    return "READY";
  }

  return "IDLE";
}

// ─── Utilization Analysis ───────────────────────────────────────────────────

export function calculateUtilizationRate(
  members: WorkforceMember[],
  assignedWorkItems: WorkItem[]
): number {
  if (members.length === 0) return 0;

  const assignedCount = assignedWorkItems.length;
  const totalCapacity = members.length;

  return Math.round((assignedCount / totalCapacity) * 100);
}

export function getUnderutilizedMembers(members: WorkforceMember[]): WorkforceMember[] {
  return members.filter((m) => m.currentWorkload < 50 && m.status === "AVAILABLE");
}

export function getOverutilizedMembers(members: WorkforceMember[]): WorkforceMember[] {
  return members.filter((m) => m.currentWorkload >= 80);
}

// ─── Capacity Planning ───────────────────────────────────────────────────────

export function estimateCapacityNeeded(workItems: WorkItem[]): number {
  return workItems.reduce((sum, item) => sum + (item.estimatedHours || 4), 0);
}

export function estimateCapacityAvailable(members: WorkforceMember[]): number {
  return members.reduce((sum, m) => {
    const available = Math.max(0, 40 - (m.currentWorkload / 100) * 40);
    return sum + available;
  }, 0);
}

export function hasCapacityFor(members: WorkforceMember[], workItems: WorkItem[]): boolean {
  const needed = estimateCapacityNeeded(workItems);
  const available = estimateCapacityAvailable(members);
  return available >= needed;
}
