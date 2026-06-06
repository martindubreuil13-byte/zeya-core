// Execution result builder — construct ExecutionResult objects from dispatch data

import type { ExecutionResult } from "../execution-types";
import type { DispatchAttempt } from "./dispatch-types";
import type { PreparedExecution } from "../adapters/provider-types";

export function buildExecutionResult(
  prepared: PreparedExecution,
  dispatch: DispatchAttempt
): ExecutionResult {
  return {
    requestId: prepared.requestId,
    channel: prepared.channel,
    success: dispatch.success,
    outcome: dispatch.outcome,
    completedAt: dispatch.attemptedAt,
  };
}

export function buildBlockedExecutionResult(prepared: PreparedExecution): ExecutionResult {
  return {
    requestId: prepared.requestId,
    channel: prepared.channel,
    success: false,
    outcome: prepared.blocker || "Request is blocked and cannot be dispatched.",
    completedAt: new Date().toISOString(),
  };
}
