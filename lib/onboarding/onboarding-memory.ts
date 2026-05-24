import type { OnboardingMemory, OnboardingGoal } from "@/types/onboarding";
import type { VoiceTranscriptEntry } from "@/types/voice";

const goalWords: Record<OnboardingGoal, string[]> = {
  leads: ["lead", "leads", "pipeline", "prospects"],
  revenue: ["revenue", "sales", "close", "closing", "deals"],
  operations: ["ops", "operations", "process", "workflow", "fulfillment"],
  retention: ["retention", "churn", "renewal", "renewals", "repeat"],
  other: [],
};

function appendUnique(values: string[] | undefined, next: string) {
  const trimmed = next.trim();
  if (!trimmed) return values;

  const existing = values ?? [];
  if (existing.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
    return existing;
  }

  return [...existing, trimmed].slice(-8);
}

function inferGoal(text: string): OnboardingGoal | undefined {
  const lower = text.toLowerCase();

  for (const [goal, words] of Object.entries(goalWords) as [OnboardingGoal, string[]][]) {
    if (words.some((word) => lower.includes(word))) return goal;
  }

  return undefined;
}

export function updateOnboardingMemoryFromTranscript(
  memory: OnboardingMemory,
  entry: VoiceTranscriptEntry,
): OnboardingMemory {
  if (entry.role !== "user" || !entry.isFinal) return memory;

  const text = entry.text.trim();
  if (!text) return memory;

  const next: OnboardingMemory = { ...memory };
  const lower = text.toLowerCase();
  const inferredGoal = inferGoal(text);

  if (inferredGoal) next.goal = inferredGoal;

  if (lower.includes("we sell") || lower.includes("we offer") || lower.includes("our offer")) {
    next.offer = next.offer ?? text;
  }

  if (lower.includes("we help") || lower.includes("we work with")) {
    next.audience = next.audience ?? text;
  }

  if (lower.includes("objection") || lower.includes("they say") || lower.includes("too expensive")) {
    next.objections = appendUnique(next.objections, text);
  }

  if (lower.includes("tone") || lower.includes("sound like") || lower.includes("brand voice")) {
    next.tonePreference = next.tonePreference ?? text;
  }

  if (lower.includes("pain") || lower.includes("problem") || lower.includes("struggle")) {
    next.painPoints = appendUnique(next.painPoints, text);
  }

  next.openQuestions = appendUnique(next.openQuestions, "Clarify the strongest outbound angle.");

  if (process.env.NODE_ENV === "development") {
    console.info("[Zeya onboarding memory]", next);
  }

  return next;
}
