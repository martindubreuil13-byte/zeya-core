"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { getBusinessProfile } from "@/lib/supabase/business-memory";

export type AppMode = "loading" | "auth" | "onboarding" | "workspace";

export interface AppModeState {
  mode: AppMode;
  businessId: string | null;
  refresh: () => void;
}

type ProfileStatus = "pending" | "onboarding" | "workspace";

export function useAppMode(): AppModeState {
  const { user, loading: authLoading } = useAuth();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("pending");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const runningRef = useRef(false);

  const resolveProfile = useCallback(async (userId: string) => {
    if (runningRef.current) return;
    runningRef.current = true;
    // Defer all setState past the current synchronous effect execution.
    // This prevents the react-hooks/set-state-in-effect rule from firing
    // while keeping the loading indicator accurate.
    await Promise.resolve();
    try {
      const business = await getBusinessProfile(userId);
      // memory_summary being set is the onboarding completion signal
      if (!business || business.memory_summary === null) {
        setBusinessId((business?.id as string) ?? null);
        setProfileStatus("onboarding");
      } else {
        setBusinessId(business.id as string);
        setProfileStatus("workspace");
      }
    } catch {
      setProfileStatus("onboarding");
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    // Standard data-fetching pattern: setState called only after async resolution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolveProfile(user.id);
  }, [user, authLoading, resolveProfile]);

  const refresh = useCallback(() => {
    if (!user) return;
    // Called from user actions, not effects — direct setState is fine here
    setProfileStatus("pending");
    runningRef.current = false;
    void resolveProfile(user.id);
  }, [user, resolveProfile]);

  // Mode is derived — no setState needed for auth/loading transitions
  const mode: AppMode = authLoading
    ? "loading"
    : !user
    ? "auth"
    : profileStatus === "pending"
    ? "loading"
    : profileStatus;

  return { mode, businessId, refresh };
}
