import type { RealtimeSessionEvent } from "@/types/realtime";
import type { VoiceState, VoiceTranscriptEntry, VoiceTranscriptRole } from "@/types/voice";

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getNestedString(event: RealtimeSessionEvent, path: string[]) {
  let current: unknown = event;

  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return getString(current);
}

export function stateFromRealtimeEvent(event: RealtimeSessionEvent): VoiceState | undefined {
  switch (event.type) {
    case "input_audio_buffer.speech_started":
      return "interrupted";
    case "input_audio_buffer.speech_stopped":
      return "thinking";
    case "response.created":
    case "response.output_item.added":
      return "thinking";
    case "response.audio.delta":
    case "output_audio_buffer.started":
      return "speaking";
    case "response.done":
    case "output_audio_buffer.stopped":
      return "listening";
    case "error":
      return "error";
    default:
      return undefined;
  }
}

export function transcriptFromRealtimeEvent(
  event: RealtimeSessionEvent,
): VoiceTranscriptEntry | undefined {
  const type = event.type;
  let text: string | undefined;
  let role: VoiceTranscriptRole = "agent";
  let isFinal = true;

  if (type === "conversation.item.input_audio_transcription.completed") {
    text = getString(event.transcript);
    role = "user";
  }

  if (type === "response.audio_transcript.delta") {
    text = getString(event.delta);
    role = "agent";
    isFinal = false;
  }

  if (type === "response.audio_transcript.done") {
    text = getString(event.transcript);
    role = "agent";
  }

  if (!text) {
    text =
      getNestedString(event, ["item", "content", "0", "transcript"]) ??
      getNestedString(event, ["response", "output", "0", "content", "0", "transcript"]);
  }

  if (!text?.trim()) return undefined;

  return {
    id:
      getString(event.event_id) ??
      getString(event.item_id) ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    isFinal,
    createdAt: Date.now(),
  };
}
