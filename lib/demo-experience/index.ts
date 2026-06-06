export { buildDemoDiscoverySession } from "./demo-discovery-builder";
export { buildDemoWorkerBriefFromDiscovery } from "./demo-brief-builder";
export { buildDemoDebrief } from "./demo-debrief-builder";
export { buildDemoLearningPatterns } from "./demo-learning-builder";
export { prepareDemoExperience, completeDemoExperience } from "./demo-experience-orchestrator";
export { getExperienceMessage, EXPERIENCE_MESSAGES } from "./experience-messages";
export {
  createExperienceSession,
  transitionState,
  getAllowedTransitions,
  EXPERIENCE_TRANSITIONS,
} from "./experience-state-machine";
export {
  startExperience,
  advanceExperience,
  getCurrentExperienceMessage,
} from "./experience-orchestrator";
export {
  buildExperienceSummary,
  buildExperienceStateDiagram,
  EXPERIENCE_STATE_SEQUENCE,
} from "./experience-summary";

export type {
  DemoDiscoveryInput,
  DemoDiscoverySession,
  DemoDiscoveryStatus,
} from "./demo-discovery-types";
export type { DemoDebrief } from "./demo-debrief-types";
export type { DemoLearningPattern } from "./demo-learning-types";
export type {
  PreparedDemoExperience,
  CompletedDemoExperience,
} from "./demo-experience-orchestrator";
export type {
  ExperienceEvent,
  ExperienceSession,
  ExperienceState,
} from "./experience-state-types";
export type {
  AllowedExperienceTransition,
  ExperienceTransition,
} from "./experience-state-machine";
export type {
  AdvancedExperience,
  StartedExperience,
} from "./experience-orchestrator";
export type { ExperienceSummary } from "./experience-summary";
