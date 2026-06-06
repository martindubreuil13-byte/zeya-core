import { getExperienceMessage } from "./experience-messages";
import {
  createExperienceSession,
  getAllowedTransitions,
  transitionState,
  type AllowedExperienceTransition,
} from "./experience-state-machine";
import type { ExperienceEvent, ExperienceSession, ExperienceState } from "./experience-state-types";

export interface StartedExperience {
  session: ExperienceSession;
  currentState: ExperienceState;
  nextState: ExperienceState;
  message: string;
  allowedTransitions: AllowedExperienceTransition[];
}

export interface AdvancedExperience {
  session: ExperienceSession;
  currentState: ExperienceState;
  nextState: ExperienceState;
  message: string;
  allowedTransitions: AllowedExperienceTransition[];
}

export function startExperience(demoSessionId?: string): StartedExperience {
  const session = createExperienceSession(demoSessionId);
  const transition = transitionState(session, "START");

  return {
    session: transition.session,
    currentState: transition.currentState,
    nextState: transition.nextState,
    message: getExperienceMessage(transition.nextState),
    allowedTransitions: getAllowedTransitions(transition.nextState),
  };
}

export function advanceExperience(
  session: ExperienceSession,
  event: ExperienceEvent
): AdvancedExperience {
  const transition = transitionState(session, event);

  return {
    session: transition.session,
    currentState: transition.currentState,
    nextState: transition.nextState,
    message: getExperienceMessage(transition.nextState),
    allowedTransitions: getAllowedTransitions(transition.nextState),
  };
}

export function getCurrentExperienceMessage(session: ExperienceSession): string {
  return getExperienceMessage(session.state);
}
