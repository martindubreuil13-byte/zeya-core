// Dispatch simulator — simulate execution without real providers

import type { PreparedExecution } from "../adapters/provider-types";
import type { DispatchAttempt } from "./dispatch-types";

export function simulateDispatch(prepared: PreparedExecution): DispatchAttempt {
  const attemptedAt = new Date().toISOString();
  const startMs = Date.now();

  // Simulate different channels
  let success = false;
  let outcome = "";

  if (prepared.channel === "PHONE") {
    success = true;
    outcome = "Simulated phone call completed.";
  } else if (prepared.channel === "VOICE") {
    success = true;
    outcome = "Simulated voice interaction completed.";
  } else {
    success = false;
    outcome = `No dispatch simulator available for ${prepared.channel}.`;
  }

  const durationMs = Date.now() - startMs;

  return {
    requestId: prepared.requestId,
    channel: prepared.channel,
    provider: prepared.provider,
    instruction: prepared.instruction,
    attemptedAt,
    success,
    outcome,
    durationMs,
  };
}
