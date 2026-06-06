export {
  processMissionForExecution,
  type MissionExecutionBridgeOptions,
  type MissionExecutionBridgeResult,
} from "./mission-to-operational-intelligence";

export {
  createMemoryEventsFromCallOutcome,
  type CallOutcomeMemoryBridgeInput,
} from "./call-outcome-to-memory-event";

export {
  processMission,
  processCallOutcome,
  type CallOutcomeBridgeOptions,
} from "./bridge-orchestrator";
