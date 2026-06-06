// Call Outcomes module — Structured call results and aggregation

export { buildCallOutcome } from "./call-outcome-builder";
export type { CallOutcomeInput } from "./call-outcome-builder";

export { simulateCallOutcome } from "./call-outcome-simulator";

export { buildCallOutcomeSummary } from "./call-outcome-summary";
export type { CallOutcomeSummary } from "./call-outcome-summary";

export { aggregateCallOutcomes } from "./call-outcome-aggregator";

export type { CallOutcome, OutcomeType, Sentiment, AggregatedOutcomes } from "./call-outcome-types";
