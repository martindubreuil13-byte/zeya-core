"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createVoiceService } from "@/lib/voice/voice-service";
import type { VoiceService, VoiceServiceSnapshot } from "@/types/voice";

const missingAgentSnapshot: VoiceServiceSnapshot = {
  state: "idle",
  connectionStatus: "disconnected",
  transcript: [],
};

let cachedAgentId: string | undefined;
let cachedService: VoiceService | undefined;

function getVoiceService(agentId: string) {
  if (!agentId) return undefined;

  if (cachedService && cachedAgentId === agentId) {
    return cachedService;
  }

  cachedAgentId = agentId;
  cachedService = createVoiceService({
    provider: "elevenlabs",
    agentId,
    diagnosticFallbackToWebSocket: true,
  });

  return cachedService;
}

export function useVoiceConversation() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";
  const service = getVoiceService(agentId);

  const snapshot = useSyncExternalStore(
    useCallback(
      (onStoreChange) => service?.onStateChange(onStoreChange) ?? (() => undefined),
      [service],
    ),
    () => service?.getSnapshot() ?? missingAgentSnapshot,
    () => missingAgentSnapshot,
  );

  return {
    ...snapshot,
    isConfigured: Boolean(agentId),
    startConversation: useCallback(() => service?.startConversation(), [service]),
    stopConversation: useCallback(() => service?.stopConversation(), [service]),
    connect: useCallback(() => service?.connect(), [service]),
    disconnect: useCallback(() => service?.disconnect(), [service]),
    sendTextMessage: useCallback((message: string) => service?.sendTextMessage(message), [service]),
  };
}
