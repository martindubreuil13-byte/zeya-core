// Call Outcome Builder — Create structured call outcomes

import type { CallOutcome, OutcomeType, Sentiment } from "./call-outcome-types";

function generateId(): string {
  return `outcome_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export interface CallOutcomeInput {
  missionId: string;
  executionPlanId?: string;
  workerBriefId?: string;

  workerName: string;
  workerType: "CALLER" | "RESEARCHER" | "OUTREACH" | "SCHEDULER" | "ANALYST";

  targetName?: string;
  targetPhone?: string;

  outcomeType: OutcomeType;
  sentiment: Sentiment;

  summary: string;
  objections?: string[];
  keyInsights?: string[];

  nextAction?: string;
  followUpRequired?: boolean;
  followUpDate?: string;

  meetingBooked?: boolean;
  meetingDate?: string;

  callDurationSeconds?: number;
  transcript?: string;
}

export function buildCallOutcome(input: CallOutcomeInput): CallOutcome {
  // Validate required fields
  if (!input.missionId) {
    throw new Error("missionId is required");
  }
  if (!input.outcomeType) {
    throw new Error("outcomeType is required");
  }
  if (!input.summary) {
    throw new Error("summary is required");
  }
  if (!input.workerName) {
    throw new Error("workerName is required");
  }

  const now = new Date().toISOString();

  // Determine followUpRequired if not explicitly set
  const followUpRequired =
    input.followUpRequired !== undefined
      ? input.followUpRequired
      : input.outcomeType === "CALL_BACK" || input.outcomeType === "VOICEMAIL";

  const outcome: CallOutcome = {
    id: generateId(),
    missionId: input.missionId,
    executionPlanId: input.executionPlanId,
    workerBriefId: input.workerBriefId,

    workerName: input.workerName,
    workerType: input.workerType,

    targetName: input.targetName,
    targetPhone: input.targetPhone,

    outcomeType: input.outcomeType,
    sentiment: input.sentiment,

    summary: input.summary,
    objections: input.objections || [],
    keyInsights: input.keyInsights || [],

    nextAction: input.nextAction,
    followUpRequired,
    followUpDate: input.followUpDate,

    meetingBooked: input.meetingBooked || false,
    meetingDate: input.meetingDate,

    callDurationSeconds: input.callDurationSeconds,
    transcript: input.transcript,

    createdAt: now,
    updatedAt: now,
  };

  return outcome;
}
