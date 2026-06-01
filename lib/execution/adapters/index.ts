// Execution Adapter Boundary — Public API exports

// Adapter engine
export { prepareExecution, prepareExecutionBatch } from "./execution-adapter";

// Adapter management
export { getAdapterForRequest, getAdaptersForChannel, listExecutionAdapters, getAdapterByProvider } from "./adapter-registry";

// Summaries
export { buildAdapterSummary } from "./adapter-summary";

// Adapter implementations
export { PhoneAdapter } from "./phone-adapter";
export { VoiceAdapter } from "./voice-adapter";

// Types
export type {
  ExecutionProviderType,
  ExecutionAdapterStatus,
  ProviderExecutionResult,
  AdapterValidationResult,
  PreparedExecution,
  ExecutionAdapter,
  AdapterSummaryData,
} from "./provider-types";
