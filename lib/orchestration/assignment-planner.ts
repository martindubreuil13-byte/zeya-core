// Assignment Planner — Match work items to workforce members
// Suggests assignments based on capability and availability, no actual assignment

import type { OrchestratedWorkItem, PlannedAssignment } from "./orchestration-types";
import { nanoid } from "nanoid";

interface WorkforceMemberInput {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  currentWorkload: number; // 0-100
  status: string;
}

// ─── Assignment Planning ────────────────────────────────────────────────────

export function planAssignments(
  workItems: OrchestratedWorkItem[],
  availableMembers: WorkforceMemberInput[],
  assignedMembers: WorkforceMemberInput[]
): PlannedAssignment[] {
  const assignments: PlannedAssignment[] = [];

  for (const workItem of workItems) {
    // Skip items already assigned or completed
    if (workItem.status === "DONE" || workItem.suggestedAssigneeId) {
      continue;
    }

    // Skip items with no capability requirements
    if (workItem.requiredCapabilities.length === 0) {
      // Admin/founder review items
      if (workItem.category === "FOUNDER_REVIEW") {
        continue; // Founder doesn't get a PlannedAssignment
      }
      continue;
    }

    // Find suitable members
    const candidates = findCandidates(workItem, availableMembers, assignedMembers);

    if (candidates.length === 0) {
      // Can't assign - will be marked as blocker later
      continue;
    }

    // Suggest primary assignment
    const primary = candidates[0];
    const assignment: PlannedAssignment = {
      id: `assign-${workItem.id}-${primary.id}-${nanoid(6)}`,
      workItemId: workItem.id,
      assigneeId: primary.id,
      assigneeName: primary.name,
      role: primary.role,
      reason: buildAssignmentReason(workItem, primary),
      alternativeAssignees: candidates.slice(1).map((c) => c.name),
      status: primary.currentWorkload < 70 ? "READY" : "BLOCKED",
      assigneeAvailability: 100 - primary.currentWorkload,
      assigneeCapacity: Math.max(0, 100 - primary.currentWorkload - (workItem.estimatedHours || 2) * 10),
      capabilityMatch: calculateCapabilityMatch(workItem.requiredCapabilities, primary.capabilities),
    };

    assignments.push(assignment);
  }

  return assignments;
}

// ─── Candidate Finding ──────────────────────────────────────────────────────

function findCandidates(
  workItem: OrchestratedWorkItem,
  available: WorkforceMemberInput[],
  assigned: WorkforceMemberInput[]
): WorkforceMemberInput[] {
  // First look in available members
  let candidates = available.filter((m) => {
    // Must have required capabilities
    const hasCapabilities = workItem.requiredCapabilities.some((req) => m.capabilities.includes(req));
    if (!hasCapabilities) return false;

    // Prefer lower workload
    return m.currentWorkload < 80; // Leave some buffer
  });

  // If no available, consider assigned members with capacity
  if (candidates.length === 0) {
    candidates = assigned.filter((m) => {
      const hasCapabilities = workItem.requiredCapabilities.some((req) => m.capabilities.includes(req));
      return hasCapabilities && m.currentWorkload < 90;
    });
  }

  // Sort by workload (lowest first) and capability match
  candidates.sort((a, b) => {
    const aMatch = calculateCapabilityMatch(workItem.requiredCapabilities, a.capabilities);
    const bMatch = calculateCapabilityMatch(workItem.requiredCapabilities, b.capabilities);

    // First priority: perfect capability match
    if (aMatch !== bMatch) {
      return bMatch - aMatch;
    }

    // Second priority: lower workload
    return a.currentWorkload - b.currentWorkload;
  });

  return candidates;
}

// ─── Capability Matching ────────────────────────────────────────────────────

export function calculateCapabilityMatch(required: string[], memberCapabilities: string[]): number {
  if (required.length === 0) return 100;

  const matches = required.filter((req) => memberCapabilities.includes(req)).length;

  return Math.round((matches / required.length) * 100);
}

// ─── Assignment Reasoning ───────────────────────────────────────────────────

function buildAssignmentReason(workItem: OrchestratedWorkItem, member: WorkforceMemberInput): string {
  const capabilityMatches = workItem.requiredCapabilities.filter((req) => member.capabilities.includes(req));

  if (capabilityMatches.length === workItem.requiredCapabilities.length) {
    return `${member.name} has all required capabilities (${capabilityMatches.join(", ")}) and is available`;
  }

  if (capabilityMatches.length > 0) {
    return `${member.name} has key capabilities (${capabilityMatches.join(", ")}) for this work`;
  }

  return `${member.name} is available and can learn the required skills`;
}

// ─── Assignment Validation ──────────────────────────────────────────────────

export function validateAssignments(assignments: PlannedAssignment[]): PlannedAssignment[] {
  // Check for conflicts - same person assigned to overlapping work
  const assigneeWorkload = new Map<string, number>();

  return assignments
    .map((assignment) => {
      const currentLoad = assigneeWorkload.get(assignment.assigneeId) || 0;
      const newLoad = currentLoad + 10; // Rough estimate: each task ~10% capacity

      assigneeWorkload.set(assignment.assigneeId, newLoad);

      return {
        ...assignment,
        assigneeCapacity: Math.max(0, 100 - newLoad),
        status: newLoad > 100 ? "BLOCKED" : assignment.status,
      };
    });
}

// ─── Assignment Summary ──────────────────────────────────────────────────────

export interface AssignmentSummary {
  totalAssignments: number;
  readyAssignments: number;
  blockedAssignments: number;
  overallocatedMembers: string[];
  underutilizedMembers: string[];
  gapsByCapability: string[];
}

export function summarizeAssignments(
  assignments: PlannedAssignment[],
  allMembers: WorkforceMemberInput[]
): AssignmentSummary {
  const overallocated: Set<string> = new Set();
  const utilized = new Set<string>();

  for (const assignment of assignments) {
    utilized.add(assignment.assigneeId);
    if (assignment.assigneeCapacity < 20) {
      overallocated.add(assignment.assigneeName);
    }
  }

  const underutilized = allMembers
    .filter((m) => !utilized.has(m.id) && m.currentWorkload < 30)
    .map((m) => m.name);

  // Find capability gaps
  const gapsByCapability: string[] = [];
  const allRequiredCapabilities = new Set<string>();

  // This would require tracking unassigned work items
  // For now, empty

  return {
    totalAssignments: assignments.length,
    readyAssignments: assignments.filter((a) => a.status === "READY").length,
    blockedAssignments: assignments.filter((a) => a.status === "BLOCKED").length,
    overallocatedMembers: Array.from(overallocated),
    underutilizedMembers: underutilized,
    gapsByCapability,
  };
}
