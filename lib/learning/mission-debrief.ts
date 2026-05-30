import type { CallResult, DerivedLearningEvent } from "@/types/zeya/learning";

const PRICE_OBJECTION_TERMS = ["price", "pricing", "cost", "expensive", "budget"];
const TIME_RECOVERY_TERMS = ["time recovery", "save time", "time back", "free up time", "recover time"];

function includesAny(value: string | null | undefined, terms: string[]) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function confidenceFromCount(count: number, threshold: number) {
  return Math.min(0.95, Number((0.55 + (count / threshold) * 0.2).toFixed(2)));
}

export function deriveMissionLearning(callResults: CallResult[]): DerivedLearningEvent[] {
  if (callResults.length === 0) return [];

  const businessId = callResults[0].business_id;
  const missionKey = null;
  const events: DerivedLearningEvent[] = [];

  const priceObjections = callResults.filter((result) =>
    includesAny(result.objection, PRICE_OBJECTION_TERMS) ||
    includesAny(result.summary, PRICE_OBJECTION_TERMS)
  );

  if (priceObjections.length >= 3) {
    events.push({
      business_id: businessId,
      mission_key: missionKey,
      learning_type: "objection_pattern",
      title: "Pricing resistance higher than expected",
      description:
        `${priceObjections.length} calls mentioned price, cost, or budget resistance. Consider tightening ROI framing before the next assignment.`,
      confidence: confidenceFromCount(priceObjections.length, 3),
      source_count: priceObjections.length,
    });
  }

  const positiveTimeRecoveryResponses = callResults.filter((result) => {
    const wasPositive = result.interest_level === "high" || result.outcome === "qualified" || result.outcome === "follow_up";
    return wasPositive && includesAny(result.summary, TIME_RECOVERY_TERMS);
  });

  if (positiveTimeRecoveryResponses.length >= 5) {
    events.push({
      business_id: businessId,
      mission_key: missionKey,
      learning_type: "message_resonance",
      title: "Time recovery messaging resonates",
      description:
        `${positiveTimeRecoveryResponses.length} positive responses referenced the time-recovery angle. Keep this message prominent in future briefs.`,
      confidence: confidenceFromCount(positiveTimeRecoveryResponses.length, 5),
      source_count: positiveTimeRecoveryResponses.length,
    });
  }

  return events;
}
