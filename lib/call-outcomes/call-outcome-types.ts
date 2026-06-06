// Call Outcome Types — Structured results from worker agent execution
// Captures what happened during a call and what should happen next

export type OutcomeType =
  | "INTERESTED"
  | "NOT_INTERESTED"
  | "NO_ANSWER"
  | "CALL_BACK"
  | "MEETING_BOOKED"
  | "WRONG_CONTACT"
  | "VOICEMAIL"
  | "FAILED";

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

// Call outcome from a worker agent
export interface CallOutcome {
  // Identification
  id: string;
  missionId: string;
  executionPlanId?: string;
  workerBriefId?: string;

  // Worker
  workerName: string; // e.g., "Veya"
  workerType: "CALLER" | "RESEARCHER" | "OUTREACH" | "SCHEDULER" | "ANALYST";

  // Target
  targetName?: string;
  targetPhone?: string;

  // Result
  outcomeType: OutcomeType;
  sentiment: Sentiment;

  // Details
  summary: string; // Human-readable summary of the call
  objections: string[]; // Objections raised by the contact
  keyInsights: string[]; // Important information learned

  // Next action
  nextAction?: string; // What should happen next
  followUpRequired: boolean;
  followUpDate?: string; // ISO timestamp

  // Meeting
  meetingBooked: boolean;
  meetingDate?: string; // ISO timestamp

  // Call details
  callDurationSeconds?: number;
  transcript?: string; // Full call transcript (when available)

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// Aggregated statistics from multiple outcomes
export interface AggregatedOutcomes {
  totalCalls: number;
  interested: number;
  notInterested: number;
  noAnswer: number;
  callBacks: number;
  meetingsBooked: number;
  wrongContacts: number;
  voicemails: number;
  failed: number;

  // Rates
  interestRate: number; // 0-100
  conversionRate: number; // Meeting booked / total calls, 0-100
  callbackRate: number; // 0-100

  // Overall sentiment
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  averageSentimentScore: number; // -1 to 1

  // Duration
  totalDurationSeconds: number;
  averageDurationSeconds: number;

  // Action
  followUpsRequired: number;
}
