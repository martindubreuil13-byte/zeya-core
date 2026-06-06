import type { ExperienceEvent, ExperienceSession, ExperienceState } from "./experience-state-types";

export const EXPERIENCE_TRANSITIONS: Record<
  ExperienceState,
  Partial<Record<ExperienceEvent, ExperienceState>>
> = {
  LANDING: {
    START: "INTRODUCTION",
  },
  INTRODUCTION: {
    START: "DISCOVERY",
  },
  DISCOVERY: {
    DISCOVERY_COMPLETE: "EXPERIMENT_INVITATION",
  },
  EXPERIMENT_INVITATION: {
    EXPERIMENT_ACCEPTED: "CONTACT_CAPTURE",
  },
  CONTACT_CAPTURE: {
    CONTACT_PROVIDED: "PREPARING_BRIEF",
  },
  PREPARING_BRIEF: {
    BRIEF_READY: "WAITING_FOR_CALL",
  },
  WAITING_FOR_CALL: {
    CALL_STARTED: "CALL_IN_PROGRESS",
  },
  CALL_IN_PROGRESS: {
    CALL_COMPLETED: "RETURNING",
  },
  RETURNING: {
    USER_RETURNED: "DEBRIEF",
  },
  DEBRIEF: {
    DEBRIEF_COMPLETED: "NEXT_STEP",
  },
  NEXT_STEP: {
    FINISH: "COMPLETED",
  },
  COMPLETED: {},
};

export interface ExperienceTransition {
  currentState: ExperienceState;
  event: ExperienceEvent;
  nextState: ExperienceState;
  session: ExperienceSession;
}

export interface AllowedExperienceTransition {
  event: ExperienceEvent;
  nextState: ExperienceState;
}

function generateExperienceSessionId(): string {
  return `experience_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createExperienceSession(demoSessionId?: string): ExperienceSession {
  const now = new Date().toISOString();

  return {
    id: generateExperienceSessionId(),
    state: "LANDING",
    demoSessionId,
    createdAt: now,
    updatedAt: now,
  };
}

export function getAllowedTransitions(
  state: ExperienceState
): AllowedExperienceTransition[] {
  return Object.entries(EXPERIENCE_TRANSITIONS[state]).map(([event, nextState]) => ({
    event: event as ExperienceEvent,
    nextState: nextState as ExperienceState,
  }));
}

export function transitionState(
  session: ExperienceSession,
  event: ExperienceEvent
): ExperienceTransition {
  const nextState = EXPERIENCE_TRANSITIONS[session.state][event];

  if (!nextState) {
    const allowed = getAllowedTransitions(session.state)
      .map((transition) => transition.event)
      .join(", ");
    const suffix = allowed ? ` Allowed events: ${allowed}.` : " No events are allowed from this state.";

    throw new Error(`Invalid transition: ${session.state} cannot handle ${event}.${suffix}`);
  }

  const updatedSession: ExperienceSession = {
    ...session,
    state: nextState,
    updatedAt: new Date().toISOString(),
  };

  return {
    currentState: session.state,
    event,
    nextState,
    session: updatedSession,
  };
}
