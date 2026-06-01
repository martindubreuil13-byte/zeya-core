// Build execution requests from orchestration plan

import type {
  OrchestratedWorkItem,
  PlannedAssignment,
  ExecutionPlan,
} from "@/lib/orchestration/orchestration-types";
import type { ExecutionRequest } from "./execution-types";
import { deriveChannelType } from "./channel-router";

// Build a single execution request from a work item and assignment
export function buildExecutionRequest(
  workItem: OrchestratedWorkItem,
  assignment: PlannedAssignment,
  missionId: string
): ExecutionRequest {
  const channelType = deriveChannelType(workItem);

  const objective =
    workItem.description
      .trim()
      .charAt(0)
      .toUpperCase() + workItem.description.trim().slice(1);

  const payload: Record<string, unknown> = {
    assigneeId: assignment.assigneeId,
    assigneeName: assignment.assigneeName,
    role: assignment.role,
    workItemId: workItem.id,
    workItemTitle: workItem.title,
    requiredCapabilities: workItem.requiredCapabilities,
    priority: workItem.priority,
  };

  const status: "PENDING" | "BLOCKED" = channelType ? "PENDING" : "BLOCKED";

  return {
    id: `req_${workItem.id}_${assignment.id}`,
    missionId,
    workItemId: workItem.id,
    assignmentId: assignment.id,
    channel: channelType || "CUSTOM",
    objective,
    payload,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Build execution requests for all ready/assigned work items in a plan
export function buildExecutionRequests(plan: ExecutionPlan): ExecutionRequest[] {
  const requests: ExecutionRequest[] = [];

  for (const workItem of plan.workItems) {
    // Only create requests for work items that are READY or ASSIGNED
    if (workItem.status !== "READY" && workItem.status !== "ASSIGNED") {
      continue;
    }

    // Find the assignment for this work item
    const assignment = plan.assignments.find((a) => a.workItemId === workItem.id);
    if (!assignment) {
      // Create a blocked request indicating no assignment
      requests.push({
        id: `req_${workItem.id}_no_assignment`,
        missionId: workItem.missionId,
        workItemId: workItem.id,
        assignmentId: "",
        channel: deriveChannelType(workItem) || "CUSTOM",
        objective: workItem.description,
        payload: {},
        status: "BLOCKED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    requests.push(buildExecutionRequest(workItem, assignment, plan.missionId));
  }

  return requests;
}
