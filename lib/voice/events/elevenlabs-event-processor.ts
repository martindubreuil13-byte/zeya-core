// ElevenLabs event processor — orchestrates event handling across stores

import {
  isSessionCreated,
  isSessionStarted,
  isSessionEnded,
} from "./elevenlabs-event-validator";
import type {
  ElevenLabsEvent,
  ElevenLabsSessionCreated,
  ElevenLabsSessionStarted,
  ElevenLabsSessionEnded,
} from "./elevenlabs-event-types";
import { sessionStore } from "./call-session-store";
import { transcriptStore } from "./transcript-capture";
import { outcomeStore } from "./call-outcome-store";

export interface ProcessedEvent {
  success: boolean;
  eventType: string;
  sessionId: string;
  message: string;
}

export function processElevenLabsEvent(event: unknown): ProcessedEvent {
  if (isSessionCreated(event)) {
    return processSessionCreated(event);
  }

  if (isSessionStarted(event)) {
    return processSessionStarted(event);
  }

  if (isSessionEnded(event)) {
    return processSessionEnded(event);
  }

  return {
    success: false,
    eventType: "unknown",
    sessionId: "",
    message: "Unknown or invalid event type",
  };
}

function processSessionCreated(event: ElevenLabsSessionCreated): ProcessedEvent {
  try {
    sessionStore.createSession(
      event.session_id,
      event.agent_id,
      event.phone_number_called,
      event.from_number
    );

    return {
      success: true,
      eventType: "session_created",
      sessionId: event.session_id,
      message: `Session created: ${event.session_id}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      eventType: "session_created",
      sessionId: event.session_id,
      message: `Failed to process session_created: ${message}`,
    };
  }
}

function processSessionStarted(event: ElevenLabsSessionStarted): ProcessedEvent {
  try {
    const session = sessionStore.startSession(event.session_id);

    if (!session) {
      return {
        success: false,
        eventType: "session_started",
        sessionId: event.session_id,
        message: `Session not found: ${event.session_id}`,
      };
    }

    return {
      success: true,
      eventType: "session_started",
      sessionId: event.session_id,
      message: `Session started: ${event.session_id}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      eventType: "session_started",
      sessionId: event.session_id,
      message: `Failed to process session_started: ${message}`,
    };
  }
}

function processSessionEnded(event: ElevenLabsSessionEnded): ProcessedEvent {
  try {
    // End the session
    const session = sessionStore.endSession(event.session_id, event.duration_secs);

    if (!session) {
      return {
        success: false,
        eventType: "session_ended",
        sessionId: event.session_id,
        message: `Session not found: ${event.session_id}`,
      };
    }

    // Capture transcript if provided
    if (event.transcript) {
      transcriptStore.captureTranscript(
        event.session_id,
        event.transcript.text,
        event.transcript.segments ?? []
      );
    }

    // Save outcome if provided
    if (event.call_summary) {
      outcomeStore.saveOutcome(
        event.session_id,
        event.call_summary.outcome_type,
        event.call_summary.sentiment,
        event.duration_secs,
        event.call_summary.key_points,
        event.call_summary.next_action
      );
    }

    return {
      success: true,
      eventType: "session_ended",
      sessionId: event.session_id,
      message: `Session ended: ${event.session_id} (duration: ${event.duration_secs}s)`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      eventType: "session_ended",
      sessionId: event.session_id,
      message: `Failed to process session_ended: ${message}`,
    };
  }
}

export function getSessionState(sessionId: string) {
  return {
    session: sessionStore.getSession(sessionId),
    transcript: transcriptStore.getTranscript(sessionId),
    outcome: outcomeStore.getOutcome(sessionId),
  };
}

export function getAllState() {
  return {
    sessions: sessionStore.getAllSessions(),
    transcripts: transcriptStore.getAllTranscripts(),
    outcomes: outcomeStore.getAllOutcomes(),
  };
}

export function clearAllState() {
  sessionStore.clear();
  transcriptStore.clear();
  outcomeStore.clear();
}
