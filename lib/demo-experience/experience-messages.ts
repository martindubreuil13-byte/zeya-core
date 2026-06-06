import type { ExperienceState } from "./experience-state-types";

export const EXPERIENCE_MESSAGES: Record<ExperienceState, string> = {
  LANDING: "You're about to meet Zeya.",
  INTRODUCTION: "Hi. I'm Zeya.\nBefore we begin, tell me what you sell.",
  DISCOVERY: "Tell me the essentials: who you help, what you offer, and what usually makes people hesitate.",
  EXPERIMENT_INVITATION:
    "I think I understand.\nWould you be willing to try a small experiment with me?",
  CONTACT_CAPTURE: "Perfect.\nWhere should my team reach you?",
  PREPARING_BRIEF: "I'm preparing a briefing.",
  WAITING_FOR_CALL:
    "Your phone should ring any moment now.\nPlease answer and stay on the line.\nWhen you're done, come back here.",
  CALL_IN_PROGRESS: "Veya is on the call now.",
  RETURNING: "Welcome back.",
  DEBRIEF: "I've reviewed the conversation.",
  NEXT_STEP:
    "If you'd like to see what I could do for your business, I can show you the next step.",
  COMPLETED: "Thanks for trying the Zeya demo experience.",
};

export function getExperienceMessage(state: ExperienceState): string {
  return EXPERIENCE_MESSAGES[state];
}
