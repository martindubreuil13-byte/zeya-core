"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { updateOnboardingMemoryFromTranscript } from "@/lib/onboarding/onboarding-memory";
import { OpenAIRealtimeClient } from "@/lib/realtime/openai-realtime-client";
import type { OnboardingMemory } from "@/types/onboarding";
import type { RealtimeOnboardingSnapshot } from "@/types/realtime";
import type { VoiceTranscriptEntry } from "@/types/voice";
import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

const REALTIME_DEBUG = process.env.NEXT_PUBLIC_REALTIME_DEBUG === "true";

const initialSnapshot: RealtimeOnboardingSnapshot = {
  state: "idle",
  connectionStatus: "idle",
  transcript: [],
  memory: {},
};

function upsertTranscriptEntry(
  entries: VoiceTranscriptEntry[],
  entry: VoiceTranscriptEntry,
  limit: number,
) {
  const existingIndex = entries.findIndex((existing) => existing.id === entry.id);

  if (existingIndex === -1) {
    return [...entries, entry].slice(-limit);
  }

  const existing = entries[existingIndex];
  const text = entry.isFinal
    ? entry.text
    : entry.text.startsWith(existing.text)
      ? entry.text
      : `${existing.text}${entry.text}`;
  const updated = [...entries];

  updated[existingIndex] = {
    ...existing,
    ...entry,
    text,
    createdAt: existing.createdAt,
  };

  return updated.slice(-limit);
}

export function useRealtimeOnboardingSession(
  options: { publicExperience?: boolean; session?: Session | null } = {},
) {
  const clientRef = useRef<OpenAIRealtimeClient | null>(null);
  const memoryRef = useRef<OnboardingMemory>({});
  const transcriptLogRef = useRef<VoiceTranscriptEntry[]>([]);
  const stuckGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapshot, setSnapshot] = useState<RealtimeOnboardingSnapshot>(initialSnapshot);
  const [experienceSession, setExperienceSession] = useState<{ token: string; expiresAt: string } | null>(null);

  const appendTranscript = useCallback((entry: VoiceTranscriptEntry) => {
    const existingEntry = transcriptLogRef.current.find((existing) => existing.id === entry.id);
    if (entry.isFinal && existingEntry?.isFinal) {
      return;
    }
    transcriptLogRef.current = upsertTranscriptEntry(transcriptLogRef.current, entry, 80);

    if (REALTIME_DEBUG || process.env.NODE_ENV === "development") {
      console.info("[Zeya realtime timing] transcript received", {
        role: entry.role,
        isFinal: entry.isFinal,
        t: Math.round(performance.now()),
      });
    }

    if (entry.role === "user" && entry.isFinal) {
      window.setTimeout(() => {
        if (REALTIME_DEBUG || process.env.NODE_ENV === "development") {
          console.info("[Zeya realtime timing] memory extraction started", {
            t: Math.round(performance.now()),
          });
        }

        const memory = updateOnboardingMemoryFromTranscript(memoryRef.current, entry);
        memoryRef.current = memory;

        if (REALTIME_DEBUG) {
          setSnapshot((current) => ({
            ...current,
            memory,
          }));
        }

        if (REALTIME_DEBUG || process.env.NODE_ENV === "development") {
          console.info("[Zeya realtime timing] memory extraction finished", {
            t: Math.round(performance.now()),
          });
        }
      }, 0);
    }

    // Non-final deltas only update snapshot in debug mode (avoids noisy re-renders).
    // Final entries always update so the Supabase persistence effect can fire.
    if (!entry.isFinal && !REALTIME_DEBUG) return;

    setSnapshot((current) => ({
      ...current,
      transcript: upsertTranscriptEntry(current.transcript, entry, 24),
      ...(REALTIME_DEBUG ? { memory: memoryRef.current } : {}),
    }));
  }, []);

  useEffect(() => {
    console.log("[HOOK] useRealtimeOnboardingSession: Creating OpenAIRealtimeClient", {
      timestamp: Math.round(performance.now()),
    });
    const client = new OpenAIRealtimeClient({
      ...(options.publicExperience ? { sessionEndpoint: "/api/experience/session" } : {}),
      ...(options.publicExperience && options.session
        ? {
            sessionRequest: (endpoint: string, init: RequestInit) =>
              authenticatedFetch(endpoint, options.session ?? null, init),
          }
        : {}),
      onSessionCreated: ({ experienceToken, expiresAt }) => {
        if (options.publicExperience && experienceToken && expiresAt) {
          setExperienceSession({ token: experienceToken, expiresAt });
        }
      },
      onStateChange: (state) => {
        setSnapshot((current) => {
          const connectionStatus =
            state === "connecting"
              ? "connecting"
              : state === "error"
                ? "error"
                : state === "disconnected"
                  ? "disconnected"
                  : current.connectionStatus === "connecting"
                    ? "connected"
                    : current.connectionStatus;

          if (current.state === state && current.connectionStatus === connectionStatus) {
            return current;
          }

          if (REALTIME_DEBUG || process.env.NODE_ENV === "development") {
            console.info("[ZEYA REALTIME] state transition:", {
              from: current.state,
              to: state,
              connectionStatus,
              t: Math.round(performance.now()),
            });
          }

          return {
            ...current,
            state,
            connectionStatus,
          };
        });
      },
      onTranscript: appendTranscript,
      onError: (error) => {
        setSnapshot((current) => ({
          ...current,
          state: "error",
          connectionStatus: "error",
          error,
        }));
      },
      onConnected: () => {
        setSnapshot((current) => ({
          ...current,
          state: "listening",
          connectionStatus: "connected",
          error: undefined,
        }));
      },
      onDisconnected: () => {
        setSnapshot((current) => ({
          ...current,
          state: current.state === "error" ? "error" : "disconnected",
          connectionStatus: current.state === "error" ? "error" : "disconnected",
        }));
      },
    });

    console.log("[HOOK] useRealtimeOnboardingSession: Client created and stored in clientRef", {
      timestamp: Math.round(performance.now()),
    });
    clientRef.current = client;
    return () => {
      console.log("[HOOK] useRealtimeOnboardingSession: Cleanup - calling client.close()", {
        timestamp: Math.round(performance.now()),
      });
      client.close();
      clientRef.current = null;
    };
  }, [appendTranscript, options.publicExperience, options.session]);

  // Safety net: if the session stays in "thinking" for more than 1500ms after the user
  // finishes speaking and no response has arrived, force a transition back to "listening".
  // This covers cases where create_response:true silently fails (e.g. after a correction
  // that triggered response.cancel, leaving VAD committed but no new response created).
  // Does NOT reconnect — the WebRTC peer connection is kept alive.
  useEffect(() => {
    if (stuckGuardRef.current) {
      clearTimeout(stuckGuardRef.current);
      stuckGuardRef.current = null;
    }

    if (snapshot.connectionStatus !== "connected") return;
    if (snapshot.state !== "thinking") return;

    stuckGuardRef.current = setTimeout(() => {
      if (REALTIME_DEBUG || process.env.NODE_ENV === "development") {
        console.info("[ZEYA REALTIME] stuck guard fired:", {
          state: snapshot.state,
          t: Math.round(performance.now()),
        });
      }
      setSnapshot((current) => {
        if (current.state !== "thinking") return current;
        if (current.connectionStatus !== "connected") return current;
        return { ...current, state: "listening" };
      });
    }, 1500);

    return () => {
      if (stuckGuardRef.current) {
        clearTimeout(stuckGuardRef.current);
        stuckGuardRef.current = null;
      }
    };
  }, [snapshot.state, snapshot.connectionStatus]);

  const startConversation = useCallback(async (initialResponseInstructions?: string) => {
    console.log("[HOOK] startConversation() called", { hasInstructions: Boolean(initialResponseInstructions) });
    setSnapshot((current) => ({
      ...current,
      state: "connecting",
      connectionStatus: "connecting",
      error: undefined,
    }));

    const client = clientRef.current;
    if (!client) {
      throw new Error("Realtime client is unavailable.");
    }

    console.log("[HOOK] Calling client.connect()");
    await client.connect(initialResponseInstructions);
    console.log("[HOOK] client.connect() returned");
    console.log("[CONNECTION] After connect(), client state", {
      timestamp: Math.round(performance.now()),
      connected: clientRef.current?.isConnected,
    });
  }, []);

  const stopConversation = useCallback(async () => {
    clientRef.current?.close();
    setSnapshot((current) => ({
      ...current,
      state: "disconnected",
      connectionStatus: "disconnected",
    }));
  }, []);

  const resetConversation = useCallback(() => {
    clientRef.current?.close();
    memoryRef.current = {};
    transcriptLogRef.current = [];
    setExperienceSession(null);
    setSnapshot(initialSnapshot);
  }, []);

  const speakExact = useCallback((text: string) => {
    console.log("[HOOK] speakExact() callback called", { textLength: text.length, clientExists: Boolean(clientRef.current) });
    if (!clientRef.current) {
      console.error("[HOOK] ERROR: No Realtime client available!");
      return;
    }
    console.log("[HOOK] Calling client.speakExact()");
    clientRef.current.speakExact(text);
    console.log("[HOOK] client.speakExact() returned");
  }, []);

  return {
    ...snapshot,
    experienceSession,
    isConfigured: true,
    provider: "openai-realtime" as const,
    startConversation,
    stopConversation,
    resetConversation,
    speakExact,
    connect: startConversation,
    disconnect: stopConversation,
    sendTextMessage: async (_message: string) => {
      throw new Error("Text messages are not implemented for OpenAI Realtime onboarding.");
    },
  };
}
