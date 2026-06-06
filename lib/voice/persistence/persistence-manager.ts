// Persistence manager — orchestrate persistence of conversations, outcomes, and memory events

import type { CapturedElevenLabsConversation } from "../events/elevenlabs-conversation-store";
import type { CallOutcome } from "../outcomes/call-outcome-types";
import type { MemoryEvent } from "../../memory/events/memory-event-types";

import {
  saveOutcome,
  countOutcomes,
  loadRecentOutcomes,
} from "./outcome-repository";
import {
  saveMemoryEvent,
  countMemoryEvents,
  loadRecentMemoryEvents,
} from "./memory-event-repository";

/**
 * Persist a CallOutcome to Supabase
 * Failures are logged but do not block outcome processing
 */
export async function persistOutcome(outcome: CallOutcome): Promise<void> {
  // Fire and forget - don't await
  saveOutcome(outcome).catch((error) => {
    console.error("[persistence-manager] Failed to persist outcome:", {
      outcomeId: outcome.outcomeId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

/**
 * Persist a MemoryEvent to Supabase
 * Failures are logged but do not block memory event processing
 */
export async function persistMemoryEvent(event: MemoryEvent): Promise<void> {
  // Fire and forget - don't await
  saveMemoryEvent(event).catch((error) => {
    console.error("[persistence-manager] Failed to persist memory event:", {
      memoryEventId: event.memoryEventId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

/**
 * Get persistence statistics
 */
export async function getPersistenceStats() {
  const [outcomeCount, memoryEventCount] = await Promise.all([
    countOutcomes(),
    countMemoryEvents(),
  ]);

  return {
    outcomes: outcomeCount,
    memoryEvents: memoryEventCount,
    total: outcomeCount + memoryEventCount,
  };
}

/**
 * Load recent data from Supabase for recovery (after restart)
 */
export async function loadRecentDataForRecovery() {
  try {
    const [outcomes, memoryEvents] = await Promise.all([
      loadRecentOutcomes(100),
      loadRecentMemoryEvents(100),
    ]);

    if (process.env.NODE_ENV === "development") {
      console.log("[persistence-manager] Loaded data for recovery:", {
        outcomes: outcomes.length,
        memoryEvents: memoryEvents.length,
      });
    }

    return {
      outcomes,
      memoryEvents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[persistence-manager] Failed to load data for recovery:", message);
    return {
      outcomes: [],
      memoryEvents: [],
    };
  }
}

/**
 * Get latest persisted record info
 */
export async function getLatestPersistenceInfo() {
  const stats = await getPersistenceStats();

  return {
    outcomesCount: stats.outcomes,
    memoryEventsCount: stats.memoryEvents,
    totalRecords: stats.total,
  };
}
