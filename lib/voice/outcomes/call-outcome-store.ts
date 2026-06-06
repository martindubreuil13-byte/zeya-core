// In-memory CallOutcome store

import type { CallOutcome } from "./call-outcome-types";

class OutcomeStore {
  private outcomes = new Map<string, CallOutcome>();
  private conversationToOutcome = new Map<string, string>(); // conversationId -> outcomeId

  /**
   * Save an outcome to the store
   */
  saveOutcome(outcome: CallOutcome): CallOutcome {
    this.outcomes.set(outcome.outcomeId, outcome);
    this.conversationToOutcome.set(outcome.conversationId, outcome.outcomeId);
    return outcome;
  }

  /**
   * Get outcome by outcomeId
   */
  getOutcome(outcomeId: string): CallOutcome | null {
    return this.outcomes.get(outcomeId) ?? null;
  }

  /**
   * Get outcome by conversationId
   */
  getOutcomeByConversationId(conversationId: string): CallOutcome | null {
    const outcomeId = this.conversationToOutcome.get(conversationId);
    if (!outcomeId) {
      return null;
    }
    return this.outcomes.get(outcomeId) ?? null;
  }

  /**
   * Get all outcomes
   */
  getAllOutcomes(): CallOutcome[] {
    return Array.from(this.outcomes.values());
  }

  /**
   * Get outcomes by worker brief ID
   */
  getOutcomesByWorkerBrief(workerBriefId: string): CallOutcome[] {
    return Array.from(this.outcomes.values()).filter(
      (outcome) => outcome.workerBriefId === workerBriefId
    );
  }

  /**
   * Check if outcome exists for conversation
   */
  hasOutcomeForConversation(conversationId: string): boolean {
    return this.conversationToOutcome.has(conversationId);
  }

  /**
   * Get count of all outcomes
   */
  getOutcomeCount(): number {
    return this.outcomes.size;
  }

  /**
   * Get count of outcomes by type
   */
  getOutcomeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const outcome of this.outcomes.values()) {
      counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Clear all outcomes
   */
  clear(): void {
    this.outcomes.clear();
    this.conversationToOutcome.clear();
  }
}

// Singleton instance
export const outcomeStore = new OutcomeStore();
export { OutcomeStore };
