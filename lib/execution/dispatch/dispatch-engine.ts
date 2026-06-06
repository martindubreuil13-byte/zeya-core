// Dispatch engine — coordinates dispatch of prepared executions

import type { PreparedExecution } from "../adapters/provider-types";
import type { DispatchResult } from "./dispatch-types";
import { simulateDispatch } from "./dispatch-simulator";
import { buildExecutionResult, buildBlockedExecutionResult } from "./execution-result-builder";
import { buildMemoryEventsFromDispatch, buildBlockedMemoryEvent } from "./memory-event-builder";

export function dispatchPreparedExecution(
  prepared: PreparedExecution,
  businessId: string
): DispatchResult {
  const dispatchedAt = new Date().toISOString();

  // If not ready, return blocked result
  if (!prepared.ready) {
    const executionResult = buildBlockedExecutionResult(prepared);
    const memoryEvent = buildBlockedMemoryEvent(
      prepared.requestId,
      businessId,
      prepared.blocker
    );

    return {
      requestId: prepared.requestId,
      channel: prepared.channel,
      provider: prepared.provider,
      executionResult,
      memoryEvents: [memoryEvent],
      refreshRequired: false,
      dispatchedAt,
    };
  }

  // Ready: simulate dispatch
  const dispatch = simulateDispatch(prepared);
  const executionResult = buildExecutionResult(prepared, dispatch);
  const memoryEvents = buildMemoryEventsFromDispatch(dispatch, businessId);

  // Dispatch successful or failed events require loop refresh
  const refreshRequired = dispatch.success || !dispatch.success; // Always true for completed/failed

  return {
    requestId: prepared.requestId,
    channel: prepared.channel,
    provider: prepared.provider,
    executionResult,
    memoryEvents,
    refreshRequired,
    dispatchedAt,
  };
}

export function dispatchPreparedExecutionBatch(
  prepared: PreparedExecution[],
  businessId: string
): DispatchResult[] {
  return prepared.map((p) => dispatchPreparedExecution(p, businessId));
}

export function shouldRefreshOperatingLoop(dispatchResults: DispatchResult[]): boolean {
  // Refresh if ANY dispatch requires it (success or failure)
  return dispatchResults.some((result) => result.refreshRequired);
}
