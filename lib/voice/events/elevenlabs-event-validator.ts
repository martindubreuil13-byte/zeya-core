// ElevenLabs event validator — type guards for webhook validation

import type {
  ElevenLabsWebhook,
  ElevenLabsPostCallTranscriptionWebhook,
} from "./elevenlabs-event-types";

export function isPostCallTranscriptionWebhook(
  event: unknown
): event is ElevenLabsPostCallTranscriptionWebhook {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;

  if (e.type !== "post_call_transcription") return false;
  if (typeof e.event_timestamp !== "number") return false;

  const data = e.data as Record<string, unknown>;
  if (!data || typeof data !== "object") return false;
  if (typeof data.conversation_id !== "string") return false;
  if (typeof data.agent_id !== "string") return false;
  if (typeof data.status !== "string") return false;
  if (!Array.isArray(data.transcript)) return false;

  return true;
}

export function isValidElevenLabsWebhook(event: unknown): event is ElevenLabsWebhook {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;

  const type = e.type;
  const hasValidTimestamp = typeof e.event_timestamp === "number";

  if (!hasValidTimestamp) return false;

  if (type === "post_call_transcription") {
    return isPostCallTranscriptionWebhook(event);
  }

  if (type === "post_call_audio") {
    const data = e.data as Record<string, unknown>;
    return (
      data &&
      typeof data === "object" &&
      typeof data.conversation_id === "string" &&
      typeof data.agent_id === "string" &&
      typeof data.audio === "string"
    );
  }

  if (type === "post_call_initiation_failure") {
    const data = e.data as Record<string, unknown>;
    return (
      data &&
      typeof data === "object" &&
      typeof data.agent_id === "string" &&
      typeof data.error === "string"
    );
  }

  return false;
}
