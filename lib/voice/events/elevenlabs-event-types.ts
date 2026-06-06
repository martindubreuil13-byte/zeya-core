// ElevenLabs event types — post-call webhook from ElevenLabs Conversational AI

export interface ElevenLabsTranscriptSegment {
  role: "user" | "agent";
  message: string;
  timestamp?: number;
}

export interface ElevenLabsPostCallTranscriptionData {
  conversation_id: string;
  agent_id: string;
  status: "done" | "failed";
  user_id?: string;
  agent_name?: string;
  transcript: ElevenLabsTranscriptSegment[];
  summary?: string;
  call_duration?: number;
  extracted_data?: Record<string, unknown>;
  has_audio?: boolean;
  has_user_audio?: boolean;
  has_response_audio?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ElevenLabsPostCallTranscriptionWebhook {
  type: "post_call_transcription";
  event_timestamp: number;
  data: ElevenLabsPostCallTranscriptionData;
}

export interface ElevenLabsPostCallAudioWebhook {
  type: "post_call_audio";
  event_timestamp: number;
  data: {
    conversation_id: string;
    agent_id: string;
    audio: string; // base64-encoded audio
  };
}

export interface ElevenLabsPostCallInitiationFailureWebhook {
  type: "post_call_initiation_failure";
  event_timestamp: number;
  data: {
    agent_id: string;
    error: string;
  };
}

export type ElevenLabsWebhook =
  | ElevenLabsPostCallTranscriptionWebhook
  | ElevenLabsPostCallAudioWebhook
  | ElevenLabsPostCallInitiationFailureWebhook;
