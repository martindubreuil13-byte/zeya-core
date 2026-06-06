// Memory event builder — Convert CallOutcome to MemoryEvent

import type { CallOutcome } from "../../voice/outcomes/call-outcome-types";
import type { MemoryEvent, MemoryType, MemoryEventBuildResult } from "./memory-event-types";

/**
 * Map CallOutcome outcome type to MemoryType
 */
function outcomeToMemoryType(outcome: string): MemoryType | null {
  switch (outcome) {
    case "interested":
      return "lead_interest_detected";
    case "callback_requested":
      return "callback_requested";
    case "not_interested":
      return "lead_disqualified";
    case "wrong_number":
      return "wrong_number_detected";
    case "voicemail":
      return "voicemail_detected";
    case "completed":
      return "conversation_completed";
    case "unknown":
      return "unknown_outcome";
    default:
      return null;
  }
}

/**
 * Generate a memory event ID
 */
function generateMemoryEventId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `mem_${timestamp}_${random}`;
}

/**
 * Build a MemoryEvent from a CallOutcome
 */
export function buildMemoryEvent(callOutcome: CallOutcome): MemoryEventBuildResult {
  const memoryType = outcomeToMemoryType(callOutcome.outcome);

  if (!memoryType) {
    return {
      memoryEvent: {
        memoryEventId: generateMemoryEventId(),
        memoryType: "unknown_outcome",
        source: "call_outcome",
        sourceId: callOutcome.outcomeId,
        workerBriefId: callOutcome.workerBriefId,
        conversationId: callOutcome.conversationId,
        confidence: callOutcome.confidence,
        payload: {
          summary: callOutcome.summary,
          recommendedAction: callOutcome.recommendedAction,
          callDuration: callOutcome.callDuration,
          originalOutcome: callOutcome.outcome,
        },
        createdAt: new Date().toISOString(),
      },
      mapped: false,
      reason: `Unknown outcome type: ${callOutcome.outcome}`,
    };
  }

  return {
    memoryEvent: {
      memoryEventId: generateMemoryEventId(),
      memoryType,
      source: "call_outcome",
      sourceId: callOutcome.outcomeId,
      workerBriefId: callOutcome.workerBriefId,
      conversationId: callOutcome.conversationId,
      confidence: callOutcome.confidence,
      payload: {
        summary: callOutcome.summary,
        recommendedAction: callOutcome.recommendedAction,
        callDuration: callOutcome.callDuration,
      },
      createdAt: new Date().toISOString(),
    },
    mapped: true,
    reason: `Mapped ${callOutcome.outcome} → ${memoryType}`,
  };
}

/**
 * Outcome to Memory Type mapping reference
 * Used for documentation and validation
 */
export const OUTCOME_TO_MEMORY_TYPE_MAP: Record<string, MemoryType> = {
  interested: "lead_interest_detected",
  callback_requested: "callback_requested",
  not_interested: "lead_disqualified",
  wrong_number: "wrong_number_detected",
  voicemail: "voicemail_detected",
  completed: "conversation_completed",
  unknown: "unknown_outcome",
};
