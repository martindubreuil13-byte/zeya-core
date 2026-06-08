// CallOutcome type definitions

export type OutcomeValue =
  | "interested"
  | "not_interested"
  | "callback_requested"
  | "voicemail"
  | "wrong_number"
  | "completed"
  | "unknown";

export type RecommendedAction =
  | "schedule_demo"
  | "send_proposal"
  | "schedule_callback"
  | "retry_call"
  | "remove_list"
  | "mark_complete"
  | "follow_up";

export interface CallOutcome {
  // Identifiers
  outcomeId: string;
  conversationId: string;
  workerBriefId: string | null;

  // Outcome classification
  status: "done" | "failed";
  outcome: OutcomeValue;
  confidence: number; // 0-1, how confident in this outcome

  // Data
  summary: string;
  transcript?: Array<{ role: "user" | "agent"; message: string }>;
  extractedData?: Record<string, unknown>;
  recommendedAction: RecommendedAction;

  // Metadata
  callDuration?: number; // seconds
  transcriptLength?: number; // number of segments
  createdAt: string; // ISO timestamp
}

export interface OutcomeDetectionResult {
  outcome: OutcomeValue;
  confidence: number;
  reason: string; // Why this outcome was selected
  recommendedAction: RecommendedAction;
}
