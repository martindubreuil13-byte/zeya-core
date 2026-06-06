export type ExperienceState =
  | "LANDING"
  | "INTRODUCTION"
  | "DISCOVERY"
  | "EXPERIMENT_INVITATION"
  | "CONTACT_CAPTURE"
  | "PREPARING_BRIEF"
  | "WAITING_FOR_CALL"
  | "CALL_IN_PROGRESS"
  | "RETURNING"
  | "DEBRIEF"
  | "NEXT_STEP"
  | "COMPLETED";

export type ExperienceEvent =
  | "START"
  | "DISCOVERY_COMPLETE"
  | "EXPERIMENT_ACCEPTED"
  | "CONTACT_PROVIDED"
  | "BRIEF_READY"
  | "CALL_STARTED"
  | "CALL_COMPLETED"
  | "USER_RETURNED"
  | "DEBRIEF_COMPLETED"
  | "FINISH";

export interface ExperienceSession {
  id: string;
  state: ExperienceState;
  demoSessionId?: string;
  createdAt: string;
  updatedAt: string;
}
