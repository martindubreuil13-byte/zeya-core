// Bridge orchestrator
// Public entry points that connect existing architecture without new layers.

import type { Mission } from "@/lib/mission";
import type { CallOutcome } from "@/lib/call-outcomes";
import {
  processMissionForExecution,
  type MissionExecutionBridgeOptions,
  type MissionExecutionBridgeResult,
} from "./mission-to-operational-intelligence";
import {
  createMemoryEventsFromCallOutcome,
  type CallOutcomeMemoryBridgeInput,
} from "./call-outcome-to-memory-event";
import type { MemoryEvent } from "@/lib/memory/memory-types";

export interface CallOutcomeBridgeOptions {
  businessId?: string;
}

export function processMission(
  mission: Mission,
  options?: MissionExecutionBridgeOptions
): MissionExecutionBridgeResult {
  return processMissionForExecution(mission, options);
}

export function processCallOutcome(
  callOutcome: CallOutcome,
  options: CallOutcomeBridgeOptions = {}
): MemoryEvent[] {
  const input: CallOutcomeMemoryBridgeInput = {
    ...callOutcome,
    businessId: options.businessId ?? (callOutcome as CallOutcomeMemoryBridgeInput).businessId,
  };

  return createMemoryEventsFromCallOutcome(input);
}
