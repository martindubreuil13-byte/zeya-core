// Adapter summary — high-level overview of adapter state

import type { ExecutionAdapter, AdapterSummaryData, PreparedExecution } from "./provider-types";

export function buildAdapterSummary(
  adapters: ExecutionAdapter[],
  prepared: PreparedExecution[]
): AdapterSummaryData {
  const totalAdapters = adapters.length;
  const availableAdapters = adapters.filter((a) => a.status === "AVAILABLE").length;
  const disabledAdapters = adapters.filter((a) => a.status === "DISABLED").length;
  const notConfiguredAdapters = adapters.filter((a) => a.status === "NOT_CONFIGURED").length;

  const supportedChannels: Set<string> = new Set();
  adapters.forEach((a) => {
    a.supportedChannels.forEach((ch) => supportedChannels.add(ch));
  });

  const readyRequests = prepared.filter((p) => p.ready).length;
  const blockedRequests = prepared.filter((p) => !p.ready && p.blocker).length;

  const nextSetupAction = deriveNextSetupAction(
    adapters,
    prepared,
    readyRequests,
    blockedRequests
  );

  return {
    totalAdapters,
    availableAdapters,
    disabledAdapters,
    notConfiguredAdapters,
    supportedChannels: Array.from(supportedChannels) as any,
    readyRequests,
    blockedRequests,
    nextSetupAction,
  };
}

// Determine next action via priority waterfall
function deriveNextSetupAction(
  adapters: ExecutionAdapter[],
  prepared: PreparedExecution[],
  readyRequests: number,
  blockedRequests: number
): string {
  // Priority 1: Any adapter ERROR
  if (adapters.some((a) => a.status === "ERROR")) {
    return "Fix adapter error before proceeding";
  }

  // Priority 2: All adapters NOT_CONFIGURED
  if (adapters.every((a) => a.status === "NOT_CONFIGURED" || a.status === "DISABLED")) {
    return "Configure a provider to enable execution";
  }

  // Priority 3: Blocked requests
  if (blockedRequests > 0) {
    return `Resolve ${blockedRequests} blocked preparation(s)`;
  }

  // Priority 4: Ready requests
  if (readyRequests > 0) {
    return "Ready for dispatch once provider is connected";
  }

  // Default
  return "No execution requests pending";
}
