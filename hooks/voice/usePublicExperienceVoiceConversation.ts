"use client";

import { useRealtimeOnboardingSession } from "@/hooks/realtime/useRealtimeOnboardingSession";

/** The public Experience is deliberately OpenAI Realtime-only and has no silent fallback. */
export function usePublicExperienceVoiceConversation() {
  return useRealtimeOnboardingSession({ publicExperience: true });
}
