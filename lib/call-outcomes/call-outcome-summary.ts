// Call Outcome Summary — Human-readable outcome summaries

import type { CallOutcome } from "./call-outcome-types";

export interface CallOutcomeSummary {
  outcomeId: string;
  missionId: string;
  worker: string;
  target?: string;
  outcomeType: string;
  sentiment: string;
  summary: string;
  objections: string[];
  keyInsights: string[];
  nextAction?: string;
  followUpRequired: boolean;
  followUpDate?: string;
  meetingBooked: boolean;
  meetingDate?: string;
  callDuration: string;
  readyForMemory: boolean;
  recommendedAction: string;
}

export function buildCallOutcomeSummary(outcome: CallOutcome): CallOutcomeSummary {
  // Determine readiness for memory
  const hasInsights = outcome.keyInsights.length > 0;
  const readyForMemory = hasInsights || outcome.outcomeType === "MEETING_BOOKED";

  // Format call duration
  const minutes = Math.floor((outcome.callDurationSeconds || 0) / 60);
  const seconds = (outcome.callDurationSeconds || 0) % 60;
  const callDuration =
    outcome.callDurationSeconds === 0 || !outcome.callDurationSeconds
      ? "N/A"
      : `${minutes}m ${seconds}s`;

  // Recommended action based on outcome
  let recommendedAction = outcome.nextAction || "No immediate action";

  if (outcome.outcomeType === "INTERESTED" && !outcome.meetingBooked) {
    recommendedAction = "Send materials and schedule follow-up within 24 hours";
  } else if (outcome.outcomeType === "MEETING_BOOKED") {
    recommendedAction = "Prepare demo and confirm meeting day before";
  } else if (outcome.outcomeType === "CALL_BACK") {
    recommendedAction = `Call back on ${outcome.followUpDate ? new Date(outcome.followUpDate).toLocaleDateString() : "scheduled date"}`;
  } else if (outcome.outcomeType === "NOT_INTERESTED") {
    recommendedAction = "Archive and retry in 6-12 months";
  }

  return {
    outcomeId: outcome.id,
    missionId: outcome.missionId,
    worker: outcome.workerName,
    target: outcome.targetName || outcome.targetPhone,
    outcomeType: outcome.outcomeType,
    sentiment: outcome.sentiment,
    summary: outcome.summary,
    objections: outcome.objections,
    keyInsights: outcome.keyInsights,
    nextAction: outcome.nextAction,
    followUpRequired: outcome.followUpRequired,
    followUpDate: outcome.followUpDate,
    meetingBooked: outcome.meetingBooked,
    meetingDate: outcome.meetingDate,
    callDuration,
    readyForMemory,
    recommendedAction,
  };
}
