// ElevenLabs event validator — type guards for event discrimination

import type {
  ElevenLabsEvent,
  ElevenLabsSessionCreated,
  ElevenLabsSessionStarted,
  ElevenLabsSessionEnded,
} from "./elevenlabs-event-types";

export function isSessionCreated(event: unknown): event is ElevenLabsSessionCreated {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return (
    e.event_type === "session_created" &&
    typeof e.session_id === "string" &&
    typeof e.agent_id === "string" &&
    typeof e.timestamp === "string"
  );
}

export function isSessionStarted(event: unknown): event is ElevenLabsSessionStarted {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return (
    e.event_type === "session_started" &&
    typeof e.session_id === "string" &&
    typeof e.agent_id === "string" &&
    typeof e.timestamp === "string"
  );
}

export function isSessionEnded(event: unknown): event is ElevenLabsSessionEnded {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return (
    e.event_type === "session_ended" &&
    typeof e.session_id === "string" &&
    typeof e.agent_id === "string" &&
    typeof e.timestamp === "string"
  );
}

export function isValidElevenLabsEvent(event: unknown): event is ElevenLabsEvent {
  return isSessionCreated(event) || isSessionStarted(event) || isSessionEnded(event);
}
