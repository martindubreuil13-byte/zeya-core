// Dispatch summary — high-level overview of dispatch operations

import type { DispatchResult, DispatchSummaryData } from "./dispatch-types";

export function buildDispatchSummary(results: DispatchResult[]): DispatchSummaryData {
  const totalRequests = results.length;
  const completedRequests = results.filter(
    (r) => r.executionResult.success && r.executionResult.outcome.includes("completed")
  ).length;
  const failedRequests = results.filter((r) => !r.executionResult.success).length;
  const blockedRequests = results.filter(
    (r) => !r.executionResult.success && r.executionResult.outcome.includes("blocked")
  ).length;

  const refreshRequired = results.some((r) => r.refreshRequired);

  const nextAction = deriveNextDispatchAction(
    totalRequests,
    completedRequests,
    failedRequests,
    blockedRequests
  );

  return {
    totalRequests,
    completedRequests,
    failedRequests,
    blockedRequests,
    refreshRequired,
    nextAction,
  };
}

function deriveNextDispatchAction(
  totalRequests: number,
  completedRequests: number,
  failedRequests: number,
  blockedRequests: number
): string {
  if (totalRequests === 0) {
    return "No requests to dispatch";
  }

  if (blockedRequests > 0) {
    return `Resolve ${blockedRequests} blocked request(s)`;
  }

  if (failedRequests > 0) {
    return `Retry or resolve ${failedRequests} failed request(s)`;
  }

  if (completedRequests > 0) {
    return `${completedRequests} request(s) completed successfully`;
  }

  return "All requests processed";
}
