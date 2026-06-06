// ElevenLabs events module — event types, validators, stores, and processor

export type {
  ElevenLabsEventType,
  ElevenLabsSessionCreated,
  ElevenLabsSessionStarted,
  ElevenLabsSessionEnded,
  ElevenLabsEvent,
} from "./elevenlabs-event-types";

export {
  isSessionCreated,
  isSessionStarted,
  isSessionEnded,
  isValidElevenLabsEvent,
} from "./elevenlabs-event-validator";

export type { CallSession, CallSessionStatus } from "./call-session-store";
export { sessionStore, SessionStore } from "./call-session-store";

export type { TranscriptSegment, CapturedTranscript } from "./transcript-capture";
export { transcriptStore, TranscriptStore } from "./transcript-capture";

export type { StoredCallOutcome } from "./call-outcome-store";
export { outcomeStore, OutcomeStore } from "./call-outcome-store";

export { processElevenLabsEvent, getSessionState, getAllState, clearAllState } from "./elevenlabs-event-processor";
export type { ProcessedEvent } from "./elevenlabs-event-processor";
