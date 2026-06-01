// Autonomous Operating Loop — Public API exports

// Main entry point and cold start
export { processAutonomyEvent, buildInitialState } from "./operating-loop-engine";

// Change detection
export { detectSystemChanges } from "./change-detector";

// Re-evaluation engine
export { reevaluateOperatingState } from "./reevaluation-engine";

// State building and computation
export {
  buildInitialOperatingState,
  calculateOperatingHealth,
  deriveOperatingBlockers,
  calculateOperatingReadiness,
  determineOperatingNextAction,
} from "./operating-state-builder";

// Summaries
export { buildAutonomySummary } from "./autonomy-summary";

// Types
export type {
  AutonomyEvent,
  AutonomyEventType,
  ReevaluationContext,
  SystemChangeMap,
  SystemName,
  OperatingState,
  OperatingHealth,
  OperatingBlocker,
  AutonomySummary,
} from "./autonomy-types";
