export {
  ACADEMY_BRIEF as SCREEN_LAB_BRIEF,
  ACADEMY_TRANSCRIPT as SCREEN_LAB_TRANSCRIPT,
} from "../testing/fixtures/academy";

export const EXPERIENCE_SCREEN_LAB_PHASES = [
  ["initial_owner", "Initial owner entry"],
  ["voice_active", "Voice active"],
  ["handoff", "Handoff"],
  ["collecting_phone", "Collecting phone"],
  ["submitting_handoff", "Submitting handoff"],
  ["waiting_for_call", "Waiting for call"],
  ["call_delayed", "Call delayed"],
  ["call_failed", "Call failed"],
  ["reflection_processing", "Reflection processing"],
  ["valid_brief", "Valid Representation Brief"],
  ["clarification_brief", "Clarification-required brief"],
  ["calibration", "Calibration"],
  ["bridge_recognition", "Commercial bridge recognition"],
  ["bridge_role", "Commercial bridge role"],
  ["bridge_boundaries", "Commercial bridge boundaries"],
  ["hiring_decision", "Hiring decision"],
  ["onboarding_preview", "Onboarding preview"],
  ["identity_confirmation", "Identity confirmation"],
  ["representation_preview", "In-page Representation preview"],
  ["completed", "Completed"],
  ["formation_error", "Formation preparation error"],
] as const;

export type ExperienceScreenLabPhase =
  typeof EXPERIENCE_SCREEN_LAB_PHASES[number][0];

export function isExperienceScreenLabEnabled(environmentTarget: string | undefined) {
  return environmentTarget === "preview";
}

type ExperienceVisualPhase =
  | "initial"
  | "voice_active"
  | "handoff"
  | "collecting_phone"
  | "submitting_handoff"
  | "waiting_for_call"
  | "brief_review"
  | "calibration"
  | "bridge_recognition"
  | "bridge_role"
  | "bridge_boundaries"
  | "hiring_decision"
  | "onboarding_preview"
  | "identity_confirmation"
  | "living_representation"
  | "completed";

export type ExperienceScreenLabState = {
  phase: ExperienceVisualPhase;
  durableCallStatus: string | null;
  includeBrief: boolean;
  includeClarification: boolean;
  formationError: string | null;
};

export function experienceScreenLabState(
  phase: ExperienceScreenLabPhase,
): ExperienceScreenLabState {
  const base = {
    durableCallStatus: null,
    includeBrief: false,
    includeClarification: false,
    formationError: null,
  };
  switch (phase) {
    case "initial_owner": return { ...base, phase: "initial" };
    case "voice_active": return { ...base, phase: "voice_active" };
    case "handoff": return { ...base, phase: "handoff" };
    case "collecting_phone": return { ...base, phase: "collecting_phone" };
    case "submitting_handoff": return { ...base, phase: "submitting_handoff" };
    case "waiting_for_call": return { ...base, phase: "waiting_for_call" };
    case "call_delayed": return { ...base, phase: "waiting_for_call", durableCallStatus: "completion_delayed" };
    case "call_failed": return { ...base, phase: "waiting_for_call", durableCallStatus: "call_failed" };
    case "reflection_processing": return { ...base, phase: "waiting_for_call", durableCallStatus: "reviewing_what_was_learned" };
    case "valid_brief": return { ...base, phase: "brief_review", includeBrief: true };
    case "clarification_brief": return { ...base, phase: "brief_review", includeClarification: true };
    case "calibration": return { ...base, phase: "calibration", includeBrief: true };
    case "bridge_recognition": return { ...base, phase: "bridge_recognition", includeBrief: true };
    case "bridge_role": return { ...base, phase: "bridge_role", includeBrief: true };
    case "bridge_boundaries": return { ...base, phase: "bridge_boundaries", includeBrief: true };
    case "hiring_decision": return { ...base, phase: "hiring_decision", includeBrief: true };
    case "onboarding_preview": return { ...base, phase: "onboarding_preview", includeBrief: true };
    case "identity_confirmation": return { ...base, phase: "identity_confirmation", includeBrief: true };
    case "representation_preview": return { ...base, phase: "living_representation", includeBrief: true };
    case "completed": return { ...base, phase: "completed", includeBrief: true };
    case "formation_error": return {
      ...base,
      phase: "completed",
      includeBrief: true,
      formationError: "Formation could not be prepared. Your confirmed brief is still saved.",
    };
  }
}
