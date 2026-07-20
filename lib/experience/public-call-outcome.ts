export type PublicExperienceVisitorInterest = "interested" | "uncertain" | "not_interested";

export type PublicExperienceCallOutcome = {
  callCompleted: true;
  visitorInterest: PublicExperienceVisitorInterest;
  relevantVisitorResponse: string | null;
  nextStepSignal: string | null;
};

type OutcomeTurn = { role?: unknown; text?: unknown };

export function derivePublicExperienceCallOutcome(
  turns: readonly OutcomeTurn[],
  sanitize: (value: unknown) => string,
): PublicExperienceCallOutcome {
  const responses = turns
    .filter((turn) => turn.role === "customer")
    .map((turn) => sanitize(turn.text))
    .filter(Boolean);
  const relevantVisitorResponse = responses.at(-1) ?? null;
  const combined = responses.join(" ").toLocaleLowerCase();
  const notInterested = /\b(not interested|no thanks|no thank you|don'?t need|wouldn'?t use|not for me)\b/.test(combined);
  const interested = !notInterested && /\b(yes|interested|useful|helpful|definitely|absolutely|sounds good|makes sense|explore|learn more)\b/.test(combined);
  const visitorInterest: PublicExperienceVisitorInterest = notInterested ? "not_interested" : interested ? "interested" : "uncertain";
  return {
    callCompleted: true,
    visitorInterest,
    relevantVisitorResponse,
    nextStepSignal: visitorInterest === "interested"
      ? "The visitor is open to exploring what comes next."
      : visitorInterest === "not_interested"
        ? "No follow-up was requested."
        : "The visitor may benefit from more context before deciding.",
  };
}
