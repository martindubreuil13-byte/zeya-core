"use client";

import { useRealtimeOnboardingSession } from "@/hooks/realtime/useRealtimeOnboardingSession";
import { useAuth } from "@/components/auth/auth-provider";

/** The public Experience is deliberately OpenAI Realtime-only and has no silent fallback. */
export function usePublicExperienceVoiceConversation(
  options: { disabled?: boolean } = {},
) {
  const { session } = useAuth();
  return useRealtimeOnboardingSession({
    publicExperience: true,
    session,
    disabled: options.disabled,
  });
}
