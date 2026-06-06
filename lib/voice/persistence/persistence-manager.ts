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

export type PersistOutcomeError = {
  code?: string;
  message: string;
  details?: string;
};

/**
 * Persist a CallOutcome to Supabase
 * Waits for persistence to complete before returning
 * Throws error with full details if persistence fails
 */
export async function persistOutcome(outcome: CallOutcome): Promise<void> {
  console.log("[persistence-manager] 🔵 persistOutcome: Starting", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    outcomeType: outcome.outcome,
  });

  try {
    const result = await saveOutcome(outcome);

    if (result.success) {
      console.log("[persistence-manager] 🟢 persistOutcome: Success", {
        conversationId: outcome.conversationId,
        workerBriefId: outcome.workerBriefId,
        outcomeType: outcome.outcome,
      });
      return;
    }

    console.error("[persistence-manager] 🔴 persistOutcome: Failed", {
      conversationId: outcome.conversationId,
      workerBriefId: outcome.workerBriefId,
      outcomeType: outcome.outcome,
      error: result.error,
    });

    const error = result.error || { code: "UNKNOWN", message: "Unknown error" };
    const err = new Error(error.message);
    (err as any).code = error.code;
    (err as any).details = error.details;
    throw err;
  } catch (error) {
    console.error("[persistence-manager] 🔴 persistOutcome: Exception", {
      conversationId: outcome.conversationId,
      workerBriefId: outcome.workerBriefId,
      outcomeType: outcome.outcome,
      error: error instanceof Error ? error.message : "Unknown error",
      code: (error as any)?.code,
      details: (error as any)?.details,
    });
    throw error;
  }
}

/**
 * Persist a MemoryEvent to Supabase
 * Waits for persistence to complete before returning
 * Throws error with full details if persistence fails
 */
export async function persistMemoryEvent(event: MemoryEvent, businessId?: string | null): Promise<void> {
  console.log("[persistence-manager] 🔵 persistMemoryEvent: Starting", {
    memoryEventId: event.memoryEventId,
    memoryType: event.memoryType,
    businessId,
  });

  try {
    const result = await saveMemoryEvent(event, businessId || undefined);

    if (result.success) {
      console.log("[persistence-manager] 🟢 persistMemoryEvent: Success", {
        memoryEventId: event.memoryEventId,
        memoryType: event.memoryType,
      });
      return;
    }

    console.error("[persistence-manager] 🔴 persistMemoryEvent: Failed", {
      memoryEventId: event.memoryEventId,
      memoryType: event.memoryType,
      error: result.error,
    });

    const error = result.error || { code: "UNKNOWN", message: "Unknown error" };
    const err = new Error(error.message);
    (err as any).code = error.code;
    (err as any).details = error.details;
    throw err;
  } catch (error) {
    console.error("[persistence-manager] 🔴 persistMemoryEvent: Exception", {
      memoryEventId: event.memoryEventId,
      memoryType: event.memoryType,
      error: error instanceof Error ? error.message : "Unknown error",
      code: (error as any)?.code,
      details: (error as any)?.details,
    });
    throw error;
  }
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
