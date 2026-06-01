// Phase 11B — Execution Adapter Boundary types

import type { ExecutionChannelType, ExecutionRequest } from "../execution-types";

// Supported provider implementations
export type ExecutionProviderType =
  | "TWILIO"
  | "ELEVENLABS"
  | "VAPI"
  | "RETELL"
  | "OPENAI_REALTIME"
  | "MOCK";

// Adapter operational status
export type ExecutionAdapterStatus =
  | "AVAILABLE"
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "ERROR";

// Result from provider execution (model only — no actual execution)
export interface ProviderExecutionResult {
  requestId: string;
  provider: ExecutionProviderType;
  channel: ExecutionChannelType;
  success: boolean;
  status: "QUEUED" | "STARTED" | "COMPLETED" | "FAILED" | "BLOCKED";
  providerReferenceId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Validation result from an adapter
export interface AdapterValidationResult {
  valid: boolean;
  blocker?: string;
  missingFields: string[];
  warnings: string[];
}

// Prepared execution ready to dispatch
export interface PreparedExecution {
  requestId: string;
  provider: ExecutionProviderType;
  channel: ExecutionChannelType;
  ready: boolean;
  instruction: string;
  payload: Record<string, unknown>;
  blocker?: string;
}

// Adapter summary statistics
export interface AdapterSummaryData {
  totalAdapters: number;
  availableAdapters: number;
  disabledAdapters: number;
  notConfiguredAdapters: number;
  supportedChannels: ExecutionChannelType[];
  readyRequests: number;
  blockedRequests: number;
  nextSetupAction: string;
}

// Base adapter interface — all adapters implement this
export interface ExecutionAdapter {
  provider: ExecutionProviderType;
  supportedChannels: ExecutionChannelType[];
  status: ExecutionAdapterStatus;
  canHandle(request: ExecutionRequest): boolean;
  validate(request: ExecutionRequest): AdapterValidationResult;
  prepare(request: ExecutionRequest): PreparedExecution;
}
