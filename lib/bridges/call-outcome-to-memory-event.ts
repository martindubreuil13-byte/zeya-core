// CallOutcome to MemoryEvent bridge
// Converts structured call outcomes into existing persistent memory event objects.

import type { CallOutcome, OutcomeType } from "@/lib/call-outcomes";
import type { MemoryEvent } from "@/lib/memory/memory-types";

export type CallOutcomeMemoryBridgeInput = CallOutcome & {
  businessId?: string;
};

function generateId(): string {
  return `mem_call_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function eventTypeForOutcome(outcomeType: OutcomeType): string {
  switch (outcomeType) {
    case "INTERESTED":
      return "CALL_OUTCOME_INTERESTED";
    case "CALL_BACK":
      return "CALL_OUTCOME_CALLBACK_REQUESTED";
    case "MEETING_BOOKED":
      return "CALL_OUTCOME_MEETING_BOOKED";
    case "NOT_INTERESTED":
      return "CALL_OUTCOME_NOT_INTERESTED";
    case "VOICEMAIL":
      return "CALL_OUTCOME_VOICEMAIL";
    case "FAILED":
      return "CALL_OUTCOME_FAILED";
    case "NO_ANSWER":
      return "CALL_OUTCOME_NO_ANSWER";
    case "WRONG_CONTACT":
      return "CALL_OUTCOME_WRONG_CONTACT";
  }
}

function confidenceForOutcome(outcomeType: OutcomeType): number {
  switch (outcomeType) {
    case "MEETING_BOOKED":
    case "INTERESTED":
    case "NOT_INTERESTED":
      return 95;
    case "CALL_BACK":
    case "VOICEMAIL":
      return 85;
    case "NO_ANSWER":
    case "WRONG_CONTACT":
    case "FAILED":
      return 75;
  }
}

function strengthForOutcome(outcomeType: OutcomeType): MemoryEvent["strength"] {
  switch (outcomeType) {
    case "MEETING_BOOKED":
    case "INTERESTED":
    case "NOT_INTERESTED":
      return "strong";
    case "CALL_BACK":
    case "VOICEMAIL":
      return "moderate";
    case "NO_ANSWER":
    case "WRONG_CONTACT":
    case "FAILED":
      return "weak";
  }
}

export function createMemoryEventsFromCallOutcome(
  callOutcome: CallOutcomeMemoryBridgeInput
): MemoryEvent[] {
  if (!callOutcome.businessId) {
    throw new Error("businessId is required to create MemoryEvents from CallOutcome");
  }

  const now = new Date().toISOString();
  const nextAction =
    callOutcome.nextAction ??
    (callOutcome.followUpRequired ? "Follow up with prospect" : "Review call outcome");

  return [
    {
      id: generateId(),
      businessId: callOutcome.businessId,
      type: eventTypeForOutcome(callOutcome.outcomeType),
      category: "CALL_RESULTS",
      source: "CALL_RESULT",
      field: "callOutcome",
      previousValue: null,
      newValue: {
        callOutcomeId: callOutcome.id,
        missionId: callOutcome.missionId,
        executionPlanId: callOutcome.executionPlanId ?? null,
        workerBriefId: callOutcome.workerBriefId ?? null,
        workerName: callOutcome.workerName,
        workerType: callOutcome.workerType,
        outcomeType: callOutcome.outcomeType,
        sentiment: callOutcome.sentiment,
        summary: callOutcome.summary,
        objections: callOutcome.objections,
        insights: callOutcome.keyInsights,
        nextAction,
        followUpRequired: callOutcome.followUpRequired,
        followUpDate: callOutcome.followUpDate ?? null,
        meetingBooked: callOutcome.meetingBooked,
        meetingDate: callOutcome.meetingDate ?? null,
        targetName: callOutcome.targetName ?? null,
        targetPhone: callOutcome.targetPhone ?? null,
      },
      confidence: confidenceForOutcome(callOutcome.outcomeType),
      strength: strengthForOutcome(callOutcome.outcomeType),
      createdAt: now,
      updatedAt: now,
      relatedEventIds: [],
      notes: `${callOutcome.workerName} recorded ${callOutcome.outcomeType}: ${callOutcome.summary}`,
    },
  ];
}
