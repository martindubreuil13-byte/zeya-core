// MemoryEvent type definitions — CallOutcome converted to memory

export type MemoryType =
  | "lead_interest_detected"
  | "callback_requested"
  | "lead_disqualified"
  | "wrong_number_detected"
  | "voicemail_detected"
  | "conversation_completed"
  | "unknown_outcome";

export type MemoryEventSource = "call_outcome" | "manual" | "system";

export interface MemoryEvent {
  // Identifiers
  memoryEventId: string;
  memoryType: MemoryType;
  source: MemoryEventSource;

  // Linking
  sourceId: string; // outcomeId
  workerBriefId: string | null;
  conversationId: string;

  // Data
  confidence: number; // 0-1
  payload: {
    summary?: string;
    recommendedAction?: string;
    callDuration?: number;
    [key: string]: unknown;
  };

  // Metadata
  createdAt: string; // ISO timestamp
}

export interface MemoryEventBuildResult {
  memoryEvent: MemoryEvent;
  mapped: boolean;
  reason: string;
}
