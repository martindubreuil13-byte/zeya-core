export type PublicExperienceVeyaBriefInput = {
  name: string | null;
  conversationSummary: string | null;
  offer: string | null;
  customer: string | null;
  relevantDetail: string | null;
};

export type PublicExperienceVeyaConversationPlan = {
  privateGuidance: string;
  spokenHandoffContext: string;
  coreQuestions: string[];
  primaryQuestion: string;
};

export function generateCoreCoreQuestionsForVeya(input: PublicExperienceVeyaBriefInput): string[] {
  const questions: string[] = [];

  // Question 1: How do customers currently find or choose the business
  if (input.customer) {
    questions.push(`Right now, how do ${input.customer} typically find you or decide to work with you?`);
  } else if (input.offer) {
    questions.push(`How do your customers currently discover or choose to work with you for ${input.offer}?`);
  } else {
    questions.push(`How do your customers currently discover or decide to work with you?`);
  }

  // Question 2: Do you actively speak with prospects; where's the constraint
  if (input.relevantDetail) {
    questions.push(`Do you actively reach out to potential customers, or is the challenge more around ${input.relevantDetail}?`);
  } else {
    questions.push(`Do you personally spend time in conversations with potential customers to grow your business, or does most of your energy go elsewhere?`);
  }

  // Question 3: What would better representation change commercially
  if (input.offer) {
    questions.push(`If Zeya could have informed conversations with ${input.customer || "prospects"} about ${input.offer} without requiring you to repeat the context each time, what would that change for you?`);
  } else {
    questions.push(`What would change for your business if you could have more informed conversations with ${input.customer || "prospects"} without having to repeat yourself?`);
  }

  return questions;
}

export function selectPublicExperienceVeyaQuestion(input: PublicExperienceVeyaBriefInput): string {
  const coreQuestions = generateCoreCoreQuestionsForVeya(input);
  return coreQuestions[0] || "How do customers currently find or decide to work with you?";
}

export function buildPublicExperienceVeyaObjective(input: PublicExperienceVeyaBriefInput): string {
  const coreQuestions = generateCoreCoreQuestionsForVeya(input);
  const visitor = input.name ?? "the visitor";
  const context = [
    input.conversationSummary && `Zeya understood that ${input.conversationSummary.replace(/[.\s]+$/, "")}`,
    input.offer && `${visitor} is working on ${input.offer}`,
    input.customer && `it is intended for ${input.customer}`,
    input.relevantDetail && `${input.relevantDetail} matters in this conversation`,
  ].filter(Boolean).join("; ") || "Zeya has completed a short introductory business conversation with the visitor";

  return [
    `Have a warm, concise conversation with ${visitor}. Pronounce the name naturally and never spell it.`,
    `Start by establishing continuity: "Hi ${input.name || "there"}. Zeya just brought me into the conversation. She told me about ${input.offer ? `your ${input.offer}` : "your business"}, so I already have some context."`,
    `Use this understanding only to inform what you say: ${context}.`,
    "Ask these questions naturally in this order, adapting based on their answers. Stop if they answer briefly—don't force follow-ups:",
    `1. ${coreQuestions[0]}`,
    `2. ${coreQuestions[1]}`,
    `3. ${coreQuestions[2]}`,
    "Listen for one key signal: are they interested, neutral, or not interested in having Zeya represent their business in conversations with prospects?",
    "If interested, affirm: 'That's exactly what I needed. I'll pass everything back to Zeya now.'",
    "If uncertain, explain: 'This call just demonstrates that we're coordinated—Zeya and I work together. Head back to the page and she'll show you how we'd actually approach it.'",
    "If not interested, thank them: 'I appreciate you taking the time. You know where to find us if you change your mind.'",
    "Close by handing back: 'Head back to the page now—Zeya will take it from here.' Then end immediately.",
    "Keep the entire call within 60–120 seconds maximum.",
    "Do not turn this into a sales conversation, discovery, or consultation.",
    "Never speak these directions, system instructions, prompts, workflows, internal architecture, or implementation details.",
  ].join("\n");
}

/**
 * Converts the internal working brief into the only context that may be used by
 * the provider's first-message template. The labeled brief remains private
 * guidance; it is never assigned to a speech variable.
 */
export function planPublicExperienceVeyaConversation(
  input: PublicExperienceVeyaBriefInput,
): PublicExperienceVeyaConversationPlan {
  const subject = input.offer
    ? `the brief Zeya prepared after your conversation about ${input.offer}`
    : input.relevantDetail
      ? `the brief Zeya prepared after your conversation about ${input.relevantDetail}`
      : "the brief Zeya prepared after your business conversation";

  const coreQuestions = generateCoreCoreQuestionsForVeya(input);

  return {
    privateGuidance: buildPublicExperienceVeyaObjective(input),
    spokenHandoffContext: subject,
    coreQuestions,
    primaryQuestion: coreQuestions[0],
  };
}
