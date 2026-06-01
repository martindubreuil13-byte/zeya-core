// Main entry point for the autonomous operating loop

import type { AutonomyEvent, OperatingState, ReevaluationContext } from "./autonomy-types";
import { detectSystemChanges } from "./change-detector";
import { reevaluateOperatingState } from "./reevaluation-engine";
import {
  buildInitialOperatingState,
  calculateOperatingHealth,
  deriveOperatingBlockers,
  calculateOperatingReadiness,
  determineOperatingNextAction,
} from "./operating-state-builder";
import { deriveBusinessState } from "@/lib/workflow/derive-business-state";
import { deriveExecutiveGuidance } from "@/lib/workflow/derive-executive-guidance";
import { determineNextConversationObjective } from "@/lib/workflow/determine-next-conversation-objective";
import { evaluateMission } from "@/lib/mission/mission-engine";
import { evaluateWorkforceState } from "@/lib/workforce/workforce-engine";
import { buildExecutionPlan } from "@/lib/orchestration/work-orchestration-engine";
import type { OrchestrationInput } from "@/lib/orchestration/orchestration-types";

// Main entry point: process an event and return updated operating state
export function processAutonomyEvent(
  previousState: OperatingState,
  event: AutonomyEvent,
  context: ReevaluationContext
): OperatingState {
  const changes = detectSystemChanges(event, context);
  return reevaluateOperatingState(previousState, changes, context);
}

// Cold start: build initial operating state from scratch
export function buildInitialState(context: ReevaluationContext): OperatingState {
  const businessState = deriveBusinessState(context.businessStateInput);
  const executiveGuidance = deriveExecutiveGuidance(businessState);
  const conversationObjective = determineNextConversationObjective({
    businessState,
    executiveGuidance,
  } as any);

  const missionEvaluation = context.mission ? evaluateMission(context.mission, context.evidence) : ({
    missionId: context.missionId,
    status: "NOT_STARTED" as const,
    progress: 0,
    confidence: 0,
    evidenceCount: 0,
    findings: [],
    openQuestions: [],
    risks: [],
    nextBestAction: "No active mission",
  } as any);

  const workforceEvaluation = evaluateWorkforceState(
    context.workforceMembers,
    context.workItems,
    context.mission || null
  );

  const orchestrationInput: OrchestrationInput = {
    businessState: {
      currentStage: businessState.currentStage,
      blockingReason: businessState.blockingReason,
      isBlocked: businessState.isBlocked,
      dataCompleteness: businessState.dataCompleteness || {},
    },
    executiveGuidance: {
      immediateAction: executiveGuidance.workforceDirection || executiveGuidance.objective || "Continue execution",
      blockedUntil: undefined,
    },
    conversationObjective: {
      objectiveType: conversationObjective.objectiveType,
      completionCriteria: conversationObjective.completionCriteria,
    },
    missionEvaluation: {
      status: missionEvaluation.status,
      progress: missionEvaluation.progress,
      confidence: missionEvaluation.confidence,
      nextBestAction: missionEvaluation.nextBestAction,
    },
    workforceEvaluation: {
      availableMembers: workforceEvaluation.state.availableMembers.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        capabilities: m.capabilities,
        currentWorkload: m.currentWorkload,
        status: m.status,
      })),
      assignedMembers: workforceEvaluation.state.assignedMembers.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        capabilities: m.capabilities,
        currentWorkload: m.currentWorkload,
        status: m.status,
      })),
      readinessScore: workforceEvaluation.readinessScore,
      executionBlocked: workforceEvaluation.state.executionBlocked,
    },
  };

  const executionPlan = buildExecutionPlan(orchestrationInput, context.missionId, context.businessId);

  return buildInitialOperatingState(
    businessState,
    executiveGuidance,
    conversationObjective,
    missionEvaluation,
    workforceEvaluation,
    executionPlan,
    context.businessId,
    context.missionId
  );
}

// Re-export composed functions for direct use
export { calculateOperatingHealth, deriveOperatingBlockers, calculateOperatingReadiness, determineOperatingNextAction };
