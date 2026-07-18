export type NormalizedElevenLabsOutcome =
  | "completed"
  | "completed_without_transcript"
  | "failed"
  | "unanswered"
  | "rejected";

export interface ElevenLabsTranscriptSegment {
  role: "user" | "agent";
  message: string;
  timestamp?: number;
}

export interface NormalizedElevenLabsEvent {
  provider: "elevenlabs";
  providerEventType: string;
  eventTimestamp: number;
  conversationId: string;
  providerCallId: string | null;
  agentId: string | null;
  outcome: NormalizedElevenLabsOutcome;
  transcript: ElevenLabsTranscriptSegment[];
  durationSeconds: number | null;
  eventKey: string;
}

export type ElevenLabsWebhook = Record<string, unknown>;

// Compatibility types retained for internal diagnostic routes. Production
// processing uses NormalizedElevenLabsEvent exclusively.
export interface ElevenLabsPostCallTranscriptionData {
  conversation_id:string; agent_id:string; status:"done"|"failed"; transcript:ElevenLabsTranscriptSegment[];
  user_id?:string; agent_name?:string; summary?:string; call_duration?:number;
  extracted_data?:Record<string,unknown>; has_audio?:boolean; has_user_audio?:boolean; has_response_audio?:boolean; metadata?:Record<string,unknown>;
}
export interface ElevenLabsPostCallTranscriptionWebhook {type:"post_call_transcription";event_timestamp:number;data:ElevenLabsPostCallTranscriptionData}
export interface ElevenLabsPostCallAudioWebhook {type:"post_call_audio";event_timestamp:number;data:{conversation_id:string;agent_id:string;audio:string}}
export interface ElevenLabsPostCallInitiationFailureWebhook {type:"post_call_initiation_failure";event_timestamp:number;data:{conversation_id:string;agent_id:string;error:string}}
