// In-memory MemoryEvent store

import type { MemoryEvent } from "./memory-event-types";

class MemoryEventStore {
  private events = new Map<string, MemoryEvent>();
  private conversationToMemoryEvent = new Map<string, string>(); // conversationId -> memoryEventId

  /**
   * Save a memory event
   */
  saveMemoryEvent(event: MemoryEvent): MemoryEvent {
    this.events.set(event.memoryEventId, event);
    this.conversationToMemoryEvent.set(event.conversationId, event.memoryEventId);
    return event;
  }

  /**
   * Get memory event by ID
   */
  getMemoryEvent(memoryEventId: string): MemoryEvent | null {
    return this.events.get(memoryEventId) ?? null;
  }

  /**
   * Get memory event by conversation ID
   */
  getMemoryEventByConversationId(conversationId: string): MemoryEvent | null {
    const memoryEventId = this.conversationToMemoryEvent.get(conversationId);
    if (!memoryEventId) {
      return null;
    }
    return this.events.get(memoryEventId) ?? null;
  }

  /**
   * Get all memory events
   */
  getAllMemoryEvents(): MemoryEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Get memory events by worker brief ID
   */
  getMemoryEventsByBrief(workerBriefId: string): MemoryEvent[] {
    return Array.from(this.events.values()).filter(
      (event) => event.workerBriefId === workerBriefId
    );
  }

  /**
   * Get memory events by type
   */
  getMemoryEventsByType(memoryType: string): MemoryEvent[] {
    return Array.from(this.events.values()).filter(
      (event) => event.memoryType === memoryType
    );
  }

  /**
   * Check if memory event exists for conversation
   */
  hasMemoryEventForConversation(conversationId: string): boolean {
    return this.conversationToMemoryEvent.has(conversationId);
  }

  /**
   * Get count of all memory events
   */
  getMemoryEventCount(): number {
    return this.events.size;
  }

  /**
   * Get count of memory events by type
   */
  getMemoryEventCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.events.values()) {
      counts[event.memoryType] = (counts[event.memoryType] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Get average confidence by memory type
   */
  getAverageConfidenceByType(): Record<string, number> {
    const events = this.getAllMemoryEvents();
    const confidenceByType: Record<string, number[]> = {};

    for (const event of events) {
      if (!confidenceByType[event.memoryType]) {
        confidenceByType[event.memoryType] = [];
      }
      confidenceByType[event.memoryType].push(event.confidence);
    }

    const avgConfidence: Record<string, number> = {};
    for (const [type, confidences] of Object.entries(confidenceByType)) {
      avgConfidence[type] = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    return avgConfidence;
  }

  /**
   * Clear all memory events
   */
  clear(): void {
    this.events.clear();
    this.conversationToMemoryEvent.clear();
  }
}

// Singleton instance
export const memoryEventStore = new MemoryEventStore();
export { MemoryEventStore };
