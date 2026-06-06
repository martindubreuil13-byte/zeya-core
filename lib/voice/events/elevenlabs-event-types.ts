// ElevenLabs event types — call lifecycle events from ElevenLabs webhook

export type ElevenLabsEventType = "session_created" | "session_started" | "session_ended";

export interface ElevenLabsSessionCreated {
  event_type: "session_created";
  session_id: string;
  agent_id: string;
  status: string;
  phone_number_called?: string;
  from_number?: string;
  timestamp: string;
}

export interface ElevenLabsSessionStarted {
  event_type: "session_started";
  session_id: string;
  agent_id: string;
  started_at: string;
  timestamp: string;
}

export interface ElevenLabsSessionEnded {
  event_type: "session_ended";
  session_id: string;
  agent_id: string;
  ended_at: string;
  duration_secs?: number;
  reason?: string;
  timestamp: string;
  transcript?: {
    text: string;
    segments?: Array<{
      speaker: "agent" | "customer";
      text: string;
      timestamp?: number;
    }>;
  };
  call_summary?: {
    outcome_type?: string;
    sentiment?: string;
    key_points?: string[];
    next_action?: string;
  };
}

export type ElevenLabsEvent = ElevenLabsSessionCreated | ElevenLabsSessionStarted | ElevenLabsSessionEnded;
