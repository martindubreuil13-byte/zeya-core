// Execution adapter engine — prepares execution requests for dispatch

import type { ExecutionRequest } from "../execution-types";
import type { PreparedExecution } from "./provider-types";
import { getAdapterForRequest } from "./adapter-registry";

// Prepare a single execution request
export function prepareExecution(request: ExecutionRequest): PreparedExecution {
  // Find adapter for this request
  const adapter = getAdapterForRequest(request);

  if (!adapter) {
    return {
      requestId: request.id,
      provider: "MOCK",
      channel: request.channel,
      ready: false,
      instruction: `No adapter available for ${request.channel}`,
      payload: {},
      blocker: `No adapter available for ${request.channel}.`,
    };
  }

  // Validate request
  const validation = adapter.validate(request);

  if (!validation.valid) {
    return {
      requestId: request.id,
      provider: adapter.provider,
      channel: request.channel,
      ready: false,
      instruction: "Validation failed",
      payload: {},
      blocker: validation.blocker || `Missing: ${validation.missingFields.join(", ")}`,
    };
  }

  // Prepare execution
  return adapter.prepare(request);
}

// Prepare multiple execution requests
export function prepareExecutionBatch(requests: ExecutionRequest[]): PreparedExecution[] {
  return requests.map((request) => prepareExecution(request));
}
