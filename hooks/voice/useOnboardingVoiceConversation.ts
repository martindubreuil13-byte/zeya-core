"use client";

import { useRealtimeOnboardingSession } from "@/hooks/realtime/useRealtimeOnboardingSession";
import { useVoiceConversation } from "@/hooks/voice/useVoiceConversation";
import type { OnboardingVoiceProvider } from "@/types/realtime";

function getOnboardingVoiceProvider(): OnboardingVoiceProvider {
  return process.env.NEXT_PUBLIC_ONBOARDING_VOICE_PROVIDER === "openai-realtime"
    ? "openai-realtime"
    : "elevenlabs";
}

export function useOnboardingVoiceConversation() {
  const realtime = useRealtimeOnboardingSession();
  const elevenLabs = useVoiceConversation();
  const provider = getOnboardingVoiceProvider();

  if (provider === "openai-realtime") return realtime;

  return {
    ...elevenLabs,
    provider: "elevenlabs" as const,
  };
}
