// Change detection: given an event, determine which systems must be reevaluated

import type { AutonomyEvent, SystemChangeMap, ReevaluationContext } from "./autonomy-types";

export function detectSystemChanges(
  event: AutonomyEvent,
  context: ReevaluationContext
): SystemChangeMap {
  const changes: SystemChangeMap = {
    changedSystems: [],
    requiresWorkflowRefresh: false,
    requiresMissionRefresh: false,
    requiresWorkforceRefresh: false,
    requiresExecutionPlanRefresh: false,
    reason: "",
  };

  switch (event.type) {
    // Business profile change — affects workflow, mission, execution plan
    case "BUSINESS_PROFILE_UPDATED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Business profile updated — workflow stage and mission confidence may change";
      break;

    // Memory event — affects workflow, mission, execution plan
    case "MEMORY_EVENT_ADDED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Memory event added — mission evaluation and execution plan may change";
      break;

    // Learning event — affects mission, execution plan
    case "LEARNING_EVENT_ADDED":
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Learning event added — mission confidence may increase";
      break;

    // Mission details updated — affects workflow, mission, execution plan
    case "MISSION_UPDATED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Mission details updated — mission evaluation and workflow stage may change";
      break;

    // Mission status changed — affects all systems
    case "MISSION_STATUS_CHANGED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Mission status changed — all systems must reevaluate";
      break;

    // Workforce member added — affects workforce, execution plan
    case "WORKFORCE_MEMBER_ADDED":
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Workforce member added — capacity and execution plan may change";
      break;

    // Workforce member updated — affects workforce, execution plan
    case "WORKFORCE_MEMBER_UPDATED":
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Workforce member updated — capacity and assignments may change";
      break;

    // Work item created — affects workforce, execution plan
    case "WORK_ITEM_CREATED":
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Work item created — execution plan and assignments must update";
      break;

    // Work item assigned — affects workforce, execution plan
    case "WORK_ITEM_ASSIGNED":
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Work item assigned — execution plan and readiness may change";
      break;

    // Work item completed — affects mission, workforce, execution plan
    case "WORK_ITEM_COMPLETED":
      changes.requiresMissionRefresh = true;
      changes.requiresWorkforceRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Work item completed — mission progress and execution plan update";
      break;

    // Call result added — affects workflow, mission, execution plan
    case "CALL_RESULT_ADDED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Call result added — mission evaluation and execution plan update";
      break;

    // Founder feedback — affects workflow, mission, execution plan
    case "FOUNDER_FEEDBACK_RECEIVED":
      changes.requiresWorkflowRefresh = true;
      changes.requiresMissionRefresh = true;
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Founder feedback received — mission and workflow may need update";
      break;

    // Execution plan updated — execution plan only
    case "EXECUTION_PLAN_UPDATED":
      changes.requiresExecutionPlanRefresh = true;
      changes.reason = "Execution plan updated — refreshing plan only";
      break;

    default:
      const _exhaustiveCheck: never = event.type;
      return _exhaustiveCheck;
  }

  // Build changed systems list
  if (changes.requiresWorkflowRefresh) changes.changedSystems.push("WORKFLOW");
  if (changes.requiresMissionRefresh) changes.changedSystems.push("MISSION");
  if (changes.requiresWorkforceRefresh) changes.changedSystems.push("WORKFORCE");
  if (changes.requiresExecutionPlanRefresh) changes.changedSystems.push("EXECUTION_PLAN");

  return changes;
}
