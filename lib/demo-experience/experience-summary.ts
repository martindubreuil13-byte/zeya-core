import { getExperienceMessage } from "./experience-messages";
import { getAllowedTransitions } from "./experience-state-machine";
import type { ExperienceSession, ExperienceState } from "./experience-state-types";

export interface ExperienceSummary {
  sessionId: string;
  currentState: ExperienceState;
  demoSessionId?: string;
  message: string;
  allowedTransitions: ReturnType<typeof getAllowedTransitions>;
  description: string;
}

export const EXPERIENCE_STATE_SEQUENCE: ExperienceState[] = [
  "LANDING",
  "INTRODUCTION",
  "DISCOVERY",
  "EXPERIMENT_INVITATION",
  "CONTACT_CAPTURE",
  "PREPARING_BRIEF",
  "WAITING_FOR_CALL",
  "CALL_IN_PROGRESS",
  "RETURNING",
  "DEBRIEF",
  "NEXT_STEP",
  "COMPLETED",
];

export function buildExperienceStateDiagram(): string {
  return EXPERIENCE_STATE_SEQUENCE.join(" -> ");
}

export function buildExperienceSummary(session: ExperienceSession): ExperienceSummary {
  return {
    sessionId: session.id,
    currentState: session.state,
    demoSessionId: session.demoSessionId,
    message: getExperienceMessage(session.state),
    allowedTransitions: getAllowedTransitions(session.state),
    description: `Experience session ${session.id} is currently in ${session.state}.`,
  };
}
