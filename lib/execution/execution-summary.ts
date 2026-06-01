// Executive summaries of execution state

import type { ExecutionRequest, ExecutionChannel, ExecutionSummary } from "./execution-types";

export function buildExecutionSummary(
  requests: ExecutionRequest[],
  channels: ExecutionChannel[] = []
): ExecutionSummary {
  const totalRequests = requests.length;
  const readyRequests = requests.filter((r) => r.status === "READY").length;
  const blockedRequests = requests.filter((r) => r.status === "BLOCKED").length;

  const availableChannels = channels.filter((c) => c.enabled).map((c) => c.type);

  const readiness = totalRequests > 0 ? Math.round((readyRequests / totalRequests) * 100) : 0;

  const nextExecutionAction = deriveNextExecutionAction(
    totalRequests,
    readyRequests,
    blockedRequests,
    availableChannels
  );

  return {
    totalRequests,
    readyRequests,
    blockedRequests,
    availableChannels,
    nextExecutionAction,
    readiness,
  };
}

// Determine next action via priority waterfall
function deriveNextExecutionAction(
  totalRequests: number,
  readyRequests: number,
  blockedRequests: number,
  availableChannels: string[]
): string {
  if (totalRequests === 0) {
    return "No execution requests generated";
  }

  if (blockedRequests > 0) {
    return `Resolve ${blockedRequests} blocked request(s) before execution`;
  }

  if (readyRequests === 0) {
    return "Pending requests awaiting readiness evaluation";
  }

  if (readyRequests > 0) {
    const pendingRequests = totalRequests - readyRequests - blockedRequests;
    if (pendingRequests > 0) {
      return `Execute ${readyRequests} ready request(s); ${pendingRequests} pending`;
    }
    return `Execute ${readyRequests} ready request(s)`;
  }

  return "Monitor execution progress";
}
