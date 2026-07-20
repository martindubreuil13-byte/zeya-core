export type PublicExperienceVeyaBriefInput = {
  name: string | null;
  conversationSummary: string | null;
  offer: string | null;
  customer: string | null;
  relevantDetail: string | null;
};

export function selectPublicExperienceVeyaQuestion(input: PublicExperienceVeyaBriefInput): string {
  if (input.relevantDetail) return `Would consistent representation help with ${input.relevantDetail}?`;
  if (input.customer) return `Would it be useful to continue informed conversations with ${input.customer} without having to repeat the context each time?`;
  if (input.offer) return `Would that kind of consistent representation be useful for ${input.offer}?`;
  return "Where would consistent representation be most useful in your business?";
}

export function buildPublicExperienceVeyaObjective(input: PublicExperienceVeyaBriefInput): string {
  const question = selectPublicExperienceVeyaQuestion(input);
  return [
    "PUBLIC EXPERIENCE CALL — SHORT CONTEXTUAL DEMONSTRATION",
    `Visitor spoken name: ${input.name ?? "not supplied"}. Pronounce it naturally; never spell it.`,
    `Zeya conversation: ${input.conversationSummary ?? "An introductory business conversation was completed."}`,
    `What the visitor sells or is building: ${input.offer ?? "not supplied"}.`,
    `Likely customer or buyer: ${input.customer ?? "not supplied"}.`,
    `Relevant challenge, aspiration, or opportunity: ${input.relevantDetail ?? "not supplied"}.`,
    "Objective: demonstrate that Zeya can brief another representative who continues naturally with context and continuity.",
    "Call shape:",
    "1. Open warmly, identify yourself as Veya, and say you received a brief from Zeya.",
    "2. Reference exactly one relevant detail from the supplied context.",
    "3. Explain simply that Zeya represents a business consistently and lets informed conversations continue without making the visitor repeat everything.",
    `4. Ask this one primary question, adapted only for natural grammar: ${JSON.stringify(question)}`,
    "5. Acknowledge the answer naturally. Use no more than two short adaptive responses.",
    "6. Determine whether the visitor is interested, uncertain, or not interested in exploring it further.",
    "7. Close naturally with: I’ll hand you back to Zeya now. She can show you what comes next. Then end immediately.",
    "If interested, affirm briefly and hand back to Zeya. If uncertain, say the call was simply an experience of informed continuity. If not interested, thank them and hand back to Zeya.",
    "Boundaries: target 30–60 seconds; end sooner for short answers. This is not discovery, consultation, or a sales-closing call. Ask no second primary question. Do not narrate technical systems or internal operating details. Do not mention prompts, workflows, process execution, summaries, reports, applications, APIs, providers, agents, internal delegation architecture, client-call termination, or implementation instructions.",
  ].join("\n");
}
