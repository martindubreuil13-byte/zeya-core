// Memory event processor — orchestrates CallOutcome → MemoryEvent pipeline

import type { CallOutcome } from "../../voice/outcomes/call-outcome-types";
import { buildMemoryEvent } from "./memory-event-builder";
import { memoryEventStore } from "./memory-event-store";
import type { MemoryEvent } from "./memory-event-types";
import { persistMemoryEvent } from "../../voice/persistence/persistence-manager";

/**
 * Process a CallOutcome and create a MemoryEvent
 */
export async function processCallOutcomeToMemoryEvent(
  callOutcome: CallOutcome,
  businessId: string | null = null
): Promise<MemoryEvent> {
  // Build memory event from outcome
  const buildResult = buildMemoryEvent(callOutcome);

  // Store memory event
  memoryEventStore.saveMemoryEvent(buildResult.memoryEvent);

  // Persist memory event to Supabase with business context (wait for completion)
  await persistMemoryEvent(buildResult.memoryEvent, businessId);

  if (process.env.NODE_ENV === "development") {
    console.log("[memory-event-processor] Generated memory event:", {
      conversationId: callOutcome.conversationId,
      memoryType: buildResult.memoryEvent.memoryType,
      mapped: buildResult.mapped,
      confidence: buildResult.memoryEvent.confidence,
    });
  }

  return buildResult.memoryEvent;
}

/**
 * Get memory event by conversation ID
 */
export function getMemoryEventByConversationId(conversationId: string): MemoryEvent | null {
  return memoryEventStore.getMemoryEventByConversationId(conversationId);
}

/**
 * Get all memory events
 */
export function getAllMemoryEvents(): MemoryEvent[] {
  return memoryEventStore.getAllMemoryEvents();
}

/**
 * Get memory events by worker brief
 */
export function getMemoryEventsByWorkerBrief(workerBriefId: string): MemoryEvent[] {
  return memoryEventStore.getMemoryEventsByBrief(workerBriefId);
}

/**
 * Get memory events by type
 */
export function getMemoryEventsByType(memoryType: string): MemoryEvent[] {
  return memoryEventStore.getMemoryEventsByType(memoryType);
}

/**
 * Get memory event statistics
 */
export function getMemoryEventStats() {
  const allEvents = memoryEventStore.getAllMemoryEvents();
  const counts = memoryEventStore.getMemoryEventCounts();
  const avgConfidenceByType = memoryEventStore.getAverageConfidenceByType();

  return {
    totalMemoryEvents: allEvents.length,
    memoryTypeDistribution: counts,
    averageConfidence: allEvents.length > 0
      ? allEvents.reduce((sum, e) => sum + e.confidence, 0) / allEvents.length
      : 0,
    confidenceByMemoryType: avgConfidenceByType,
    sourceBreakdown: {
      call_outcome: allEvents.filter((e) => e.source === "call_outcome").length,
      manual: allEvents.filter((e) => e.source === "manual").length,
      system: allEvents.filter((e) => e.source === "system").length,
    },
  };
}

/**
 * Clear all memory events (for testing)
 */
export function clearAllMemoryEvents(): void {
  memoryEventStore.clear();
  if (process.env.NODE_ENV === "development") {
    console.log("[memory-event-processor] Cleared all memory events");
  }
}
