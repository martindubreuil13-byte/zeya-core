import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";
import type { OnboardingMemory } from "@/types/onboarding";

export type OnboardingVoiceProvider = "elevenlabs" | "openai-realtime";

export type RealtimeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type RealtimeSessionEvent = {
  type?: string;
  [key: string]: unknown;
};

export type RealtimeOnboardingSnapshot = {
  state: VoiceState;
  connectionStatus: RealtimeConnectionStatus;
  transcript: VoiceTranscriptEntry[];
  memory: OnboardingMemory;
  error?: string;
};
