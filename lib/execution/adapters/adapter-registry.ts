// Adapter registry — manages all execution adapters

import type { ExecutionRequest, ExecutionChannelType } from "../execution-types";
import type { ExecutionAdapter } from "./provider-types";
import { PhoneAdapter } from "./phone-adapter";
import { VoiceAdapter } from "./voice-adapter";

// ─── Adapter Registration ────────────────────────────────────────────────────

const REGISTERED_ADAPTERS: ExecutionAdapter[] = [
  new PhoneAdapter(),
  new VoiceAdapter(),
];

// ─── Registry Functions ─────────────────────────────────────────────────────

// Find the first adapter that can handle a request
export function getAdapterForRequest(request: ExecutionRequest): ExecutionAdapter | null {
  return REGISTERED_ADAPTERS.find((adapter) => adapter.canHandle(request)) || null;
}

// Get all adapters that support a specific channel
export function getAdaptersForChannel(channel: ExecutionChannelType): ExecutionAdapter[] {
  return REGISTERED_ADAPTERS.filter((adapter) =>
    adapter.supportedChannels.includes(channel)
  );
}

// List all registered adapters
export function listExecutionAdapters(): ExecutionAdapter[] {
  return [...REGISTERED_ADAPTERS];
}

// Get adapter by provider type
export function getAdapterByProvider(provider: string): ExecutionAdapter | null {
  return REGISTERED_ADAPTERS.find((adapter) => adapter.provider === provider) || null;
}
