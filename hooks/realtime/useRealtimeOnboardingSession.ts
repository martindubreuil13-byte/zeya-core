"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { updateOnboardingMemoryFromTranscript } from "@/lib/onboarding/onboarding-memory";
import { OpenAIRealtimeClient } from "@/lib/realtime/openai-realtime-client";
import type { OnboardingMemory } from "@/types/onboarding";
import type { RealtimeOnboardingSnapshot } from "@/types/realtime";
import type { VoiceTranscriptEntry } from "@/types/voice";

const REALTIME_DEBUG = process.env.NEXT_PUBLIC_REALTIME_DEBUG === "true";

const initialSnapshot: RealtimeOnboardingSnapshot = {
  state: "idle",
  connectionStatus: "idle",
  transcript: [],
  memory: {},
};

export function useRealtimeOnboardingSession() {
  const clientRef = useRef<OpenAIRealtimeClient | null>(null);
  const memoryRef = useRef<OnboardingMemory>({});
  const transcriptLogRef = useRef<VoiceTranscriptEntry[]>([]);
  const stuckGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapshot, setSnapshot] = useState<RealtimeOnboardingSnapshot>(initialSnapshot);

  const appendTranscript = useCallback((entry: VoiceTranscriptEntry) => {
    if (entry.isFinal && transcriptLogRef.current.some((e) => e.isFinal && e.id === entry.id)) {
      return;
    }
    transcriptLogRef.current = [...transcriptLogRef.current, entry].slice(-80);

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
      transcript: [...current.transcript, entry].slice(-24),
      ...(REALTIME_DEBUG ? { memory: memoryRef.current } : {}),
    }));
  }, []);

  useEffect(() => {
    const client = new OpenAIRealtimeClient({
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

    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [appendTranscript]);

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
    setSnapshot((current) => ({
      ...current,
      state: "connecting",
      connectionStatus: "connecting",
      error: undefined,
    }));

    await clientRef.current?.connect(initialResponseInstructions);
  }, []);

  const stopConversation = useCallback(async () => {
    clientRef.current?.close();
    setSnapshot((current) => ({
      ...current,
      state: "disconnected",
      connectionStatus: "disconnected",
    }));
  }, []);

  return {
    ...snapshot,
    isConfigured: true,
    provider: "openai-realtime" as const,
    startConversation,
    stopConversation,
    connect: startConversation,
    disconnect: stopConversation,
    sendTextMessage: async (_message: string) => {
      throw new Error("Text messages are not implemented for OpenAI Realtime onboarding.");
    },
  };
}
