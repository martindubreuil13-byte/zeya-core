/**
 * Experience Layer: Beat Definitions and Scripts
 *
 * Each beat is a step in the scripted 5-beat conversation.
 * The model does NOT decide the script. The script is fixed.
 * The model only extracts information from visitor responses.
 */

export enum ExperienceBeat {
  GREETING = "greeting",
  PRODUCT = "product",
  CUSTOMER = "customer",
  EXPERIMENT = "experiment",
  PHONE = "phone",
  CLOSED = "closed",
}

export interface BeatConfig {
  primary: string | ((context: { visitorName?: string }) => string);
  fallback: string | null;
  extractField: string | null;
  successCriteria: string;
  timeout: number; // milliseconds
  maxAttempts: number;
}

export const BEAT_SCRIPTS: Record<ExperienceBeat, BeatConfig> = {
  [ExperienceBeat.GREETING]: {
    primary:
      "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?",
    fallback: "Sorry, could you repeat your name?",
    extractField: "visitor.name",
    successCriteria: "name extracted",
    timeout: 10000,
    maxAttempts: 2,
  },

  [ExperienceBeat.PRODUCT]: {
    primary: (context) =>
      `Nice to meet you, ${context.visitorName || "there"}. What does your business sell?`,
    fallback:
      "Got it. And when you help them, what exactly are they paying for?",
    extractField: "visitor.business.offer",
    successCriteria: "product/service described",
    timeout: 12000,
    maxAttempts: 2,
  },

  [ExperienceBeat.CUSTOMER]: {
    primary: "Who usually buys it?",
    fallback: "Tell me more about who your ideal customer is.",
    extractField: "visitor.business.target_buyer",
    successCriteria: "customer type identified",
    timeout: 12000,
    maxAttempts: 2,
  },

  [ExperienceBeat.EXPERIMENT]: {
    primary:
      "Got it. I'd like to show you something. We run a small experiment with businesses like yours — gives you a real sense of how this works before you decide anything. Would you be willing to try it?",
    fallback: "I know this might be unexpected. Does it sound interesting to you?",
    extractField: "decision",
    successCriteria: "yes/no detected",
    timeout: 15000,
    maxAttempts: 2,
  },

  [ExperienceBeat.PHONE]: {
    primary:
      "Great. I'll need your phone number to set this up. What's the best number to reach you?",
    fallback: "Sorry, can you repeat that number?",
    extractField: "visitor.phone",
    successCriteria: "phone number captured",
    timeout: 12000,
    maxAttempts: 3,
  },

  [ExperienceBeat.CLOSED]: {
    primary:
      "No problem at all. If you ever want to see how it works, you know where to find me.",
    fallback: null,
    extractField: null,
    successCriteria: "conversation ended gracefully",
    timeout: 5000,
    maxAttempts: 1,
  },
};

/**
 * Get the script line for a beat.
 * If primary is a function, evaluate it with context.
 */
export function getBeatScript(
  beat: ExperienceBeat,
  context?: { visitorName?: string }
): string {
  const config = BEAT_SCRIPTS[beat];
  const primary = config.primary;

  if (typeof primary === "function") {
    return primary(context || {});
  }

  return primary;
}

/**
 * Determine the next beat based on current beat and extraction result
 */
export function getNextBeat(
  currentBeat: ExperienceBeat,
  extractedValue: string | null,
  decision?: "yes" | "no"
): ExperienceBeat {
  switch (currentBeat) {
    case ExperienceBeat.GREETING:
      return ExperienceBeat.PRODUCT;

    case ExperienceBeat.PRODUCT:
      return ExperienceBeat.CUSTOMER;

    case ExperienceBeat.CUSTOMER:
      return ExperienceBeat.EXPERIMENT;

    case ExperienceBeat.EXPERIMENT:
      return decision === "yes" ? ExperienceBeat.PHONE : ExperienceBeat.CLOSED;

    case ExperienceBeat.PHONE:
      return ExperienceBeat.CLOSED;

    default:
      return ExperienceBeat.CLOSED;
  }
}

/**
 * Check if beat requires phone extraction
 */
export function isBeatWithPhone(beat: ExperienceBeat): boolean {
  return beat === ExperienceBeat.PHONE;
}

/**
 * Check if beat requires yes/no decision
 */
export function isBeatWithDecision(beat: ExperienceBeat): boolean {
  return beat === ExperienceBeat.EXPERIMENT;
}

/**
 * Minimum system prompt for the model.
 * The model is NOT a conversationalist. It is an extractor.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are an extraction assistant for a brief voice experience.

Your job is to identify and extract specific information from what the visitor says.

You do NOT:
- Reason about the business
- Interpret the context
- Add information
- Analyze tone
- Make judgments

You ONLY:
- Extract the requested field from the transcript
- Rate your confidence (0-1)
- Indicate if clarification is needed

Return ONLY valid JSON.`;
