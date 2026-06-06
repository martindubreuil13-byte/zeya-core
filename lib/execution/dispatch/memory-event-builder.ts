// Memory event builder — create memory events from dispatch outcomes

import type { MemoryEvent } from "@/lib/memory/memory-types";
import type { DispatchAttempt } from "./dispatch-types";

function generateId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function buildMemoryEventsFromDispatch(
  dispatch: DispatchAttempt,
  businessId: string
): MemoryEvent[] {
  const events: MemoryEvent[] = [];
  const now = new Date().toISOString();

  if (dispatch.success) {
    // Successful dispatch event
    events.push({
      id: generateId(),
      businessId,
      type: "EXECUTION_COMPLETED",
      category: "WORKFLOW",
      source: "SYSTEM",
      field: null,
      previousValue: null,
      newValue: {
        channel: dispatch.channel,
        provider: dispatch.provider,
        outcome: dispatch.outcome,
      },
      confidence: 100,
      strength: "strong",
      createdAt: now,
      updatedAt: now,
      notes: `${dispatch.channel} execution completed in ${dispatch.durationMs}ms`,
    });
  } else {
    // Failed dispatch event
    events.push({
      id: generateId(),
      businessId,
      type: "EXECUTION_FAILED",
      category: "WORKFLOW",
      source: "SYSTEM",
      field: null,
      previousValue: null,
      newValue: {
        channel: dispatch.channel,
        provider: dispatch.provider,
        outcome: dispatch.outcome,
      },
      confidence: 100,
      strength: "strong",
      createdAt: now,
      updatedAt: now,
      notes: `${dispatch.channel} execution failed: ${dispatch.outcome}`,
    });
  }

  return events;
}

export function buildBlockedMemoryEvent(
  requestId: string,
  businessId: string,
  blocker: string | undefined
): MemoryEvent {
  const now = new Date().toISOString();

  return {
    id: generateId(),
    businessId,
    type: "EXECUTION_BLOCKED",
    category: "WORKFLOW",
    source: "SYSTEM",
    field: null,
    previousValue: null,
    newValue: {
      requestId,
      blocker: blocker || "Unknown blocker",
    },
    confidence: 100,
    strength: "strong",
    createdAt: now,
    updatedAt: now,
    notes: `Execution request blocked: ${blocker}`,
  };
}
