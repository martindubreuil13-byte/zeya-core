// Phase 11C — Dispatch Simulation types

import type { MemoryEvent } from "@/lib/memory/memory-types";
import type { ExecutionResult } from "../execution-types";

// Represents a dispatch attempt with its outcomes
export interface DispatchAttempt {
  requestId: string;
  channel: string;
  provider: string;
  instruction: string;
  attemptedAt: string;
  success: boolean;
  outcome: string;
  durationMs: number;
}

// Complete result of a dispatch operation
export interface DispatchResult {
  requestId: string;
  channel: string;
  provider: string;
  executionResult: ExecutionResult;
  memoryEvents: MemoryEvent[];
  refreshRequired: boolean;
  dispatchedAt: string;
}

// Summary of dispatch operations
export interface DispatchSummaryData {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  blockedRequests: number;
  refreshRequired: boolean;
  nextAction: string;
}
