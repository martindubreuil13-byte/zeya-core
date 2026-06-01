// Work Orchestration Engine — Coordinate work execution without performing it
// Deterministic planning: no AI, no LLM, no external calls

import type {
  ExecutionPlan,
  OrchestrationInput,
  OrchestratedWorkItem,
  PlannedAssignment,
  OrchestrationBlocker,
  ExecutionPlanStatus,
} from "./orchestration-types";
import { buildWorkItems, validateDependencies, sequenceWorkItems, updateWorkItemStatuses } from "./execution-plan-builder";
import { planAssignments, validateAssignments } from "./assignment-planner";
import { nanoid } from "nanoid";

// ─── Main Engine ────────────────────────────────────────────────────────────

export function buildExecutionPlan(input: OrchestrationInput, missionId: string, businessId: string): ExecutionPlan {
  // Generate work items from mission state
  let workItems = buildWorkItems(input, missionId);

  // If no work items generated, plan is not ready
  if (workItems.length === 0) {
    return {
      id: `plan-${missionId}-${nanoid(8)}`,
      missionId,
      businessId,
      status: "DRAFT",
      objective: "Awaiting mission activation",
      workItems: [],
      assignments: [],
      blockers: [
        {
          id: `blocker-${nanoid(8)}`,
          type: "MISSION_UNCLEAR",
          message: "Mission has not started or is not yet activated",
          severity: "HIGH",
          suggestedResolution: "Define mission and begin work",
          isResolvable: true,
        },
      ],
      nextAction: "Define mission objective and success criteria",
      readiness: 0,
      blockerCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Validate and update dependencies
  workItems = validateDependencies(workItems);

  // Update statuses based on work item categories and blockers
  workItems = updateWorkItemStatuses(workItems, input.memoryContext?.callResults);

  // Sequence work items
  workItems = sequenceWorkItems(workItems);

  // Plan assignments
  const assignments = planAssignments(
    workItems,
    input.workforceEvaluation.availableMembers.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      capabilities: m.capabilities,
      currentWorkload: m.currentWorkload,
      status: m.status || "AVAILABLE",
    })),
    input.workforceEvaluation.assignedMembers.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role || "OPERATOR",
      capabilities: m.capabilities || [],
      currentWorkload: m.currentWorkload || 50,
      status: m.status || "ASSIGNED",
    }))
  );

  // Validate assignments for overload
  const validatedAssignments = validateAssignments(assignments);

  // Detect blockers
  const blockers = detectBlockers(input, workItems, validatedAssignments);

  // Calculate readiness score
  const readiness = calculateExecutionReadiness(input, workItems, validatedAssignments, blockers);

  // Determine status and next action
  const status = determineExecutionStatus(blockers, workItems, readiness);
  const nextAction = determineOrchestrationNextAction(input, blockers, status, workItems);

  return {
    id: `plan-${missionId}-${nanoid(8)}`,
    missionId,
    businessId,
    status,
    objective: input.missionEvaluation.nextBestAction || "Execute mission validation",
    workItems,
    assignments: validatedAssignments,
    blockers,
    nextAction,
    readiness,
    blockerCount: blockers.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Blocker Detection ──────────────────────────────────────────────────────

function detectBlockers(
  input: OrchestrationInput,
  workItems: OrchestratedWorkItem[],
  assignments: PlannedAssignment[]
): OrchestrationBlocker[] {
  const blockers: OrchestrationBlocker[] = [];

  // Mission clarity
  if (input.missionEvaluation.status === "NOT_STARTED") {
    blockers.push({
      id: `blocker-${nanoid(8)}`,
      type: "MISSION_UNCLEAR",
      message: "Mission has not been started or defined",
      severity: "HIGH",
      suggestedResolution: "Define mission hypothesis and success criteria",
      isResolvable: true,
    });
  }

  // Business state blocking
  if (input.businessState.isBlocked && input.businessState.blockingReason) {
    blockers.push({
      id: `blocker-${nanoid(8)}`,
      type: "MISSING_DATA",
      message: `Business state blocked: ${input.businessState.blockingReason}`,
      severity: "HIGH",
      suggestedResolution: `Resolve: ${input.businessState.blockingReason}`,
      isResolvable: true,
    });
  }

  // Workforce capability gaps
  for (const workItem of workItems) {
    if (workItem.status === "READY" && workItem.category !== "FOUNDER_REVIEW" && workItem.requiredCapabilities.length > 0) {
      const hasAssignment = assignments.some((a) => a.workItemId === workItem.id);

      if (!hasAssignment && workItem.requiredCapabilities.length > 0) {
        blockers.push({
          id: `blocker-${nanoid(8)}`,
          type: "NO_CAPABILITY",
          message: `No team member available with capabilities: ${workItem.requiredCapabilities.join(", ")}`,
          severity: "MEDIUM",
          relatedWorkItemId: workItem.id,
          suggestedResolution: `Add team member with ${workItem.requiredCapabilities[0]} capability`,
          isResolvable: true,
        });
      }
    }
  }

  // Dependency blockers
  for (const workItem of workItems) {
    if (workItem.status === "BLOCKED" && workItem.blocker === "Waiting for dependency to complete") {
      blockers.push({
        id: `blocker-${nanoid(8)}`,
        type: "DEPENDENCY_BLOCKED",
        message: `Work item "${workItem.title}" blocked by incomplete dependency`,
        severity: "MEDIUM",
        relatedWorkItemId: workItem.id,
        suggestedResolution: "Complete prerequisite work items first",
        isResolvable: false, // Automatically resolved when dependencies complete
      });
    }
  }

  // Founder decision required
  const founderReviewItems = workItems.filter((w) => w.category === "FOUNDER_REVIEW" && w.status === "WAITING");
  if (founderReviewItems.length > 0) {
    blockers.push({
      id: `blocker-${nanoid(8)}`,
      type: "FOUNDER_DECISION_REQUIRED",
      message: `Founder action required: ${founderReviewItems.map((w) => w.title).join(", ")}`,
      severity: "HIGH",
      suggestedResolution: founderReviewItems[0].description || "Provide founder input",
      isResolvable: true,
    });
  }

  // No capacity
  if (input.workforceEvaluation.availableMembers.length === 0 && workItems.some((w) => w.status === "READY")) {
    blockers.push({
      id: `blocker-${nanoid(8)}`,
      type: "NO_CAPACITY",
      message: "No available team members to execute work",
      severity: "HIGH",
      suggestedResolution: "Make team member available or adjust workload",
      isResolvable: true,
    });
  }

  return blockers;
}

// ─── Readiness Calculation ──────────────────────────────────────────────────

export function calculateExecutionReadiness(
  input: OrchestrationInput,
  workItems: OrchestratedWorkItem[],
  assignments: PlannedAssignment[],
  blockers: OrchestrationBlocker[]
): number {
  let score = 0;

  // Mission clarity (0-20)
  if (input.missionEvaluation.status !== "NOT_STARTED") score += 20;

  // Workflow not blocked (0-20)
  if (!input.businessState.isBlocked) score += 20;

  // Work items ready (0-20)
  const readyItems = workItems.filter((w) => w.status === "READY").length;
  if (readyItems > 0) score += Math.round((readyItems / Math.max(workItems.length, 1)) * 20);

  // Workforce readiness (0-20)
  score += Math.min(20, input.workforceEvaluation.readinessScore * 0.2);

  // No critical blockers (0-20)
  const criticalBlockers = blockers.filter((b) => b.severity === "HIGH").length;
  if (criticalBlockers === 0) score += 20;
  else if (criticalBlockers === 1) score += 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Status Determination ───────────────────────────────────────────────────

function determineExecutionStatus(
  blockers: OrchestrationBlocker[],
  workItems: OrchestratedWorkItem[],
  readiness: number
): ExecutionPlanStatus {
  // Critical blockers mean BLOCKED
  const criticalBlockers = blockers.filter((b) => b.severity === "HIGH");
  if (criticalBlockers.length > 0) {
    return "BLOCKED";
  }

  // No work items generated yet
  if (workItems.length === 0) {
    return "DRAFT";
  }

  // Work items in progress
  const inProgressItems = workItems.filter((w) => w.status === "ASSIGNED");
  if (inProgressItems.length > 0) {
    return "IN_PROGRESS";
  }

  // Work items ready
  const readyItems = workItems.filter((w) => w.status === "READY");
  if (readyItems.length > 0) {
    return "READY";
  }

  // All work items done
  const allDone = workItems.every((w) => w.status === "DONE");
  if (allDone) {
    return "COMPLETED";
  }

  return "READY"; // Default if we have work items and not blocked
}

// ─── Next Action Determination ──────────────────────────────────────────────

export function determineOrchestrationNextAction(
  input: OrchestrationInput,
  blockers: OrchestrationBlocker[],
  status: ExecutionPlanStatus,
  workItems: OrchestratedWorkItem[]
): string {
  // If blocked, address the blocker
  const criticalBlocker = blockers.find((b) => b.severity === "HIGH");
  if (criticalBlocker) {
    return criticalBlocker.suggestedResolution;
  }

  // If founder review needed
  const founderItem = workItems.find((w) => w.category === "FOUNDER_REVIEW" && w.status === "WAITING");
  if (founderItem) {
    return `${founderItem.title} — ${founderItem.description}`;
  }

  // Next ready work item
  const nextReady = workItems.find((w) => w.status === "READY" && w.category !== "FOUNDER_REVIEW");
  if (nextReady) {
    const assignment = "to be assigned"; // Will be filled by caller
    return `Assign "${nextReady.title}" to available team member with ${nextReady.requiredCapabilities.join(", ")} capability`;
  }

  // All done
  if (workItems.every((w) => w.status === "DONE")) {
    return "Mission execution complete. Review results and prepare debrief.";
  }

  // Default
  return "Review plan and address any blockers";
}

// ─── Execution Plan Export ──────────────────────────────────────────────────

export { type ExecutionPlan, type OrchestratedWorkItem, type PlannedAssignment, type OrchestrationBlocker };
