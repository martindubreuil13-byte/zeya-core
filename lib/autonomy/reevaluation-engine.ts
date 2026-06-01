// Reevaluation engine: coordinates re-running affected systems

import type { OperatingState, SystemChangeMap, ReevaluationContext } from "./autonomy-types";
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
import type { BusinessStateInput } from "@/lib/workflow/derive-business-state";
import { evaluateMission } from "@/lib/mission/mission-engine";
import { evaluateWorkforceState } from "@/lib/workforce/workforce-engine";
import { buildExecutionPlan } from "@/lib/orchestration/work-orchestration-engine";
import type { OrchestrationInput } from "@/lib/orchestration/orchestration-types";

export function reevaluateOperatingState(
  previousState: OperatingState,
  changes: SystemChangeMap,
  context: ReevaluationContext
): OperatingState {
  // Start from previous state — we'll update only changed systems
  let updatedState = { ...previousState };

  // Refresh workflow if needed
  if (changes.requiresWorkflowRefresh) {
    const businessState = deriveBusinessState(context.businessStateInput);
    const executiveGuidance = deriveExecutiveGuidance(businessState);
    const conversationObjective = determineNextConversationObjective({
      businessState,
      executiveGuidance,
    } as any); // ConversationObjectiveInput type
    updatedState.businessState = businessState;
    updatedState.executiveGuidance = executiveGuidance;
    updatedState.conversationObjective = conversationObjective;
  }

  // Refresh mission if needed
  if (changes.requiresMissionRefresh) {
    if (context.mission) {
      const missionEvaluation = evaluateMission(context.mission, context.evidence);
      updatedState.missionEvaluation = missionEvaluation;
    }
  }

  // Refresh workforce if needed
  if (changes.requiresWorkforceRefresh) {
    const workforceEvaluation = evaluateWorkforceState(
      context.workforceMembers,
      context.workItems,
      context.mission
    );
    updatedState.workforceEvaluation = workforceEvaluation;
  }

  // Refresh execution plan if needed — requires all upstream systems
  if (changes.requiresExecutionPlanRefresh) {
    const orchestrationInput: OrchestrationInput = {
      businessState: {
        currentStage: updatedState.businessState.currentStage,
        blockingReason: updatedState.businessState.blockingReason,
        isBlocked: updatedState.businessState.isBlocked,
        dataCompleteness: updatedState.businessState.dataCompleteness || {},
      },
      executiveGuidance: {
        immediateAction: updatedState.executiveGuidance.workforceDirection || updatedState.executiveGuidance.objective || "Continue execution",
        blockedUntil: undefined,
      },
      conversationObjective: {
        objectiveType: updatedState.conversationObjective.objectiveType,
        completionCriteria: updatedState.conversationObjective.completionCriteria,
      },
      missionEvaluation: {
        status: updatedState.missionEvaluation.status,
        progress: updatedState.missionEvaluation.progress,
        confidence: updatedState.missionEvaluation.confidence,
        nextBestAction: updatedState.missionEvaluation.nextBestAction,
      },
      workforceEvaluation: {
        availableMembers: updatedState.workforceEvaluation.state.availableMembers.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          capabilities: m.capabilities,
          currentWorkload: m.currentWorkload,
          status: m.status,
        })),
        assignedMembers: updatedState.workforceEvaluation.state.assignedMembers.map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          capabilities: m.capabilities,
          currentWorkload: m.currentWorkload,
          status: m.status,
        })),
        readinessScore: updatedState.workforceEvaluation.readinessScore,
        executionBlocked: updatedState.workforceEvaluation.state.executionBlocked,
      },
    };
    const executionPlan = buildExecutionPlan(
      orchestrationInput,
      context.missionId,
      context.businessId
    );
    updatedState.executionPlan = executionPlan;
  }

  // Recompute derived metrics
  const blockers = deriveOperatingBlockers(
    updatedState.businessState,
    updatedState.missionEvaluation,
    updatedState.workforceEvaluation,
    updatedState.executionPlan
  );

  const health = calculateOperatingHealth(
    updatedState.businessState,
    updatedState.missionEvaluation,
    updatedState.workforceEvaluation,
    updatedState.executionPlan
  );

  const readiness = calculateOperatingReadiness(
    updatedState.businessState,
    updatedState.missionEvaluation,
    updatedState.workforceEvaluation,
    updatedState.executionPlan
  );

  const nextAction = determineOperatingNextAction(
    updatedState.businessState,
    updatedState.missionEvaluation,
    updatedState.workforceEvaluation,
    updatedState.executionPlan,
    blockers
  );

  updatedState.operatingHealth = health;
  updatedState.blockers = blockers;
  updatedState.readiness = readiness;
  updatedState.nextAction = nextAction;
  updatedState.lastUpdated = new Date().toISOString();
  updatedState.changedSystems = changes.changedSystems;

  return updatedState;
}
