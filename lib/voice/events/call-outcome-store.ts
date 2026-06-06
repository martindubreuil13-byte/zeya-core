// Call outcome store — stores call results in memory

export interface StoredCallOutcome {
  sessionId: string;
  outcome?: string;
  sentiment?: string;
  duration?: number;
  keyPoints?: string[];
  nextAction?: string;
  storedAt: string;
}

class OutcomeStore {
  private outcomes: Map<string, StoredCallOutcome> = new Map();

  saveOutcome(
    sessionId: string,
    outcome?: string,
    sentiment?: string,
    duration?: number,
    keyPoints?: string[],
    nextAction?: string
  ): StoredCallOutcome {
    const callOutcome: StoredCallOutcome = {
      sessionId,
      outcome,
      sentiment,
      duration,
      keyPoints,
      nextAction,
      storedAt: new Date().toISOString(),
    };
    this.outcomes.set(sessionId, callOutcome);
    return callOutcome;
  }

  getOutcome(sessionId: string): StoredCallOutcome | null {
    return this.outcomes.get(sessionId) ?? null;
  }

  hasOutcome(sessionId: string): boolean {
    return this.outcomes.has(sessionId);
  }

  getAllOutcomes(): StoredCallOutcome[] {
    return Array.from(this.outcomes.values());
  }

  clear(): void {
    this.outcomes.clear();
  }
}

const outcomeStore = new OutcomeStore();

export {
  outcomeStore,
  OutcomeStore,
};
