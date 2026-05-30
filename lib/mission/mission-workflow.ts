// Mission workflow stage derivation.
// Derives the current operational step from mission detail, lead summary, and caller brief state.

import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";
import type { LeadSummary } from "@/lib/leads/types";

export type MissionWorkflowStage =
  | "no_mission"
  | "needs_prospects"
  | "needs_selection"
  | "ready_for_brief"
  | "brief_prepared"
  | "ready_for_assignment"
  | "assigned_waiting_execution";

export interface MissionWorkflow {
  stage: MissionWorkflowStage;
  currentStep: string;
  nextStep: string;
  isBlocked: boolean;
  blockReason?: string;
}

export function deriveMissionWorkflow(
  missionDetail: MissionDetail | null,
  leadSummary: LeadSummary | null,
  callerBrief: string | null,
  assignedAgentName?: string | null,
): MissionWorkflow {
  // No mission
  if (!missionDetail) {
    return {
      stage: "no_mission",
      currentStep: "Define your sales mission",
      nextStep: "Create and structure a mission in the Memory pill cloud",
      isBlocked: true,
      blockReason: "No active mission yet",
    };
  }

  // Mission exists but no prospects uploaded
  if (!leadSummary || leadSummary.total === 0) {
    return {
      stage: "needs_prospects",
      currentStep: "Add prospects to your mission",
      nextStep: "Upload or paste a list of companies/contacts",
      isBlocked: true,
      blockReason: "This mission needs prospects",
    };
  }

  // Prospects uploaded but none selected
  if (leadSummary.selected === 0) {
    return {
      stage: "needs_selection",
      currentStep: "Review and select the best prospects",
      nextStep: "Mark 3–5 of your strongest prospects as selected",
      isBlocked: true,
      blockReason: `No selected leads yet (${leadSummary.total} available)`,
    };
  }

  // Selected leads exist, no brief prepared yet
  if (!callerBrief) {
    return {
      stage: "ready_for_brief",
      currentStep: "Selected leads ready",
      nextStep: "Prepare caller brief with talking points",
      isBlocked: false,
    };
  }

  // Brief prepared, not yet assigned
  if (callerBrief && !assignedAgentName) {
    return {
      stage: "brief_prepared",
      currentStep: "Caller brief prepared",
      nextStep: "Assign to caller agent",
      isBlocked: false,
    };
  }

  // Brief assigned to an agent, waiting for execution
  if (callerBrief && assignedAgentName) {
    return {
      stage: "assigned_waiting_execution",
      currentStep: `Assigned to ${assignedAgentName}`,
      nextStep: "Execution engine not connected yet",
      isBlocked: false,
    };
  }

  // Fallback (should not reach)
  return {
    stage: "ready_for_assignment",
    currentStep: "Mission complete",
    nextStep: "Track outcomes and iterate",
    isBlocked: false,
  };
}
