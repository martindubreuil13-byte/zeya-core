// In-memory call session store — tracks session lifecycle

export type CallSessionStatus = "created" | "started" | "ended";

export interface CallSession {
  sessionId: string;
  agentId: string;
  status: CallSessionStatus;
  phoneNumberCalled?: string;
  fromNumber?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  duration?: number;
}

class SessionStore {
  private sessions: Map<string, CallSession> = new Map();

  createSession(
    sessionId: string,
    agentId: string,
    phoneNumberCalled?: string,
    fromNumber?: string
  ): CallSession {
    const session: CallSession = {
      sessionId,
      agentId,
      status: "created",
      phoneNumberCalled,
      fromNumber,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  startSession(sessionId: string): CallSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = "started";
    session.startedAt = new Date().toISOString();
    return session;
  }

  endSession(sessionId: string, duration?: number): CallSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    session.duration = duration;
    return session;
  }

  getSession(sessionId: string): CallSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getAllSessions(): CallSession[] {
    return Array.from(this.sessions.values());
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }
}

const sessionStore = new SessionStore();

export {
  sessionStore,
  SessionStore,
};
