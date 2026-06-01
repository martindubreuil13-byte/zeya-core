// Execution Channel Architecture — Public API exports

// Channel management
export { getChannelRegistry, getChannel, getEnabledChannels } from "./channel-registry";

// Routing
export { deriveChannelType, routeExecutionRequest, routeExecutionRequestDefault } from "./channel-router";

// Request building
export { buildExecutionRequest, buildExecutionRequests } from "./execution-request-builder";

// Coordination
export { evaluateExecutionReadiness, processExecutionPlan, evaluateExecutionPlan } from "./execution-channel-engine";

// Summaries
export { buildExecutionSummary } from "./execution-summary";

// Types
export type {
  ExecutionChannelType,
  ExecutionChannel,
  ExecutionRequest,
  ExecutionResult,
  ExecutionReadiness,
  ExecutionSummary,
} from "./execution-types";
