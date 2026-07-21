export const EXPERIENCE_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_EXPERIENCE_DEBUG_ACTIVE === "true";

export type ExperienceDebugStage =
  | "session_started"
  | "microphone_opened"
  | "user_speech_started"
  | "vad_speech_ended"
  | "transcript_finalized"
  | "transcript_sent_to_llm"
  | "llm_response_received"
  | "tts_request_started"
  | "first_audio_byte_received"
  | "speech_playback_started"
  | "speech_playback_finished"
  | "next_listening_entered"
  | "reflection_started"
  | "ui_rendered";

export function experienceDebugLog(message: string, details?: Record<string, unknown>) {
  if (!EXPERIENCE_DEBUG_ENABLED) return;
  console.info(`[Experience Debug] ${message}`, details ?? {});
}

export function experienceDebugTable(rows: Record<string, unknown>) {
  if (!EXPERIENCE_DEBUG_ENABLED) return;
  console.info("---------------------------- Experience Timing ----------------------------");
  console.table(rows);
  console.info("--------------------------------------------------------------------------");
}
