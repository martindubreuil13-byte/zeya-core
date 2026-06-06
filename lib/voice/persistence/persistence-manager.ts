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
 * Waits for persistence to complete before returning
 */
export async function persistOutcome(outcome: CallOutcome): Promise<void> {
  console.log("[persistence-manager] 🔵 persistOutcome: Starting", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    outcomeType: outcome.outcome,
  });

  return saveOutcome(outcome).then((success) => {
    if (success) {
      console.log("[persistence-manager] 🟢 persistOutcome: Success", {
        conversationId: outcome.conversationId,
        workerBriefId: outcome.workerBriefId,
        outcomeType: outcome.outcome,
      });
    } else {
      console.error("[persistence-manager] 🔴 persistOutcome: Failed (no error details)", {
        conversationId: outcome.conversationId,
        workerBriefId: outcome.workerBriefId,
        outcomeType: outcome.outcome,
      });
      throw new Error("Outcome persistence returned false without error details");
    }
  }).catch((error) => {
    console.error("[persistence-manager] 🔴 persistOutcome: Exception", {
      conversationId: outcome.conversationId,
      workerBriefId: outcome.workerBriefId,
      outcomeType: outcome.outcome,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  });
}

/**
 * Persist a MemoryEvent to Supabase
 * Waits for persistence to complete before returning
 */
export async function persistMemoryEvent(event: MemoryEvent): Promise<void> {
  console.log("[persistence-manager] 🔵 persistMemoryEvent: Starting", {
    memoryEventId: event.memoryEventId,
    memoryType: event.memoryType,
  });

  return saveMemoryEvent(event).then((success) => {
    if (success) {
      console.log("[persistence-manager] 🟢 persistMemoryEvent: Success", {
        memoryEventId: event.memoryEventId,
        memoryType: event.memoryType,
      });
    } else {
      console.error("[persistence-manager] 🔴 persistMemoryEvent: Failed (no error details)", {
        memoryEventId: event.memoryEventId,
        memoryType: event.memoryType,
      });
      throw new Error("Memory event persistence returned false without error details");
    }
  }).catch((error) => {
    console.error("[persistence-manager] 🔴 persistMemoryEvent: Exception", {
      memoryEventId: event.memoryEventId,
      memoryType: event.memoryType,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
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
