"use client";

// Voice session hook for the Zeya Briefing Room.
//
// Lifecycle:
//   startSession() → creates OpenAIRealtimeClient with briefing-session endpoint
//                  → optionally creates a Supabase session row for persistence
//                  → connects WebRTC
//   endSession()  → closes the client
//                  → fires process-memory (fire-and-forget) to extract structured intelligence
//
// Each call to startSession() creates a fresh client instance — no stale state.

import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeClient } from "@/lib/realtime/openai-realtime-client";
import { appendMessage, createSession } from "@/lib/supabase/business-memory";
import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BriefingSessionOptions {
  businessContext: string;
  businessId?: string;
  accessToken?: string;
}

export type BriefingConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface BriefingSessionSnapshot {
  voiceState: VoiceState;
  connectionStatus: BriefingConnectionStatus;
  transcript: VoiceTranscriptEntry[];
  error?: string;
}

const INITIAL: BriefingSessionSnapshot = {
  voiceState: "idle",
  connectionStatus: "idle",
  transcript: [],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeBriefingSession({
  businessContext,
  businessId,
  accessToken,
}: BriefingSessionOptions) {
  const clientRef    = useRef<OpenAIRealtimeClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [snapshot, setSnapshot] = useState<BriefingSessionSnapshot>(INITIAL);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  // ── startSession ────────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    // Tear down any prior session
    clientRef.current?.close();
    clientRef.current = null;
    sessionIdRef.current = null;

    setSnapshot({ voiceState: "connecting", connectionStatus: "connecting", transcript: [] });

    // Create a Supabase session row for persistence (non-fatal if it fails)
    if (businessId) {
      try {
        const row = await createSession(businessId, "briefing_voice");
        sessionIdRef.current = row.id;
      } catch {
        // continue without persistence
      }
    }

    const client = new OpenAIRealtimeClient({
      sessionEndpoint: "/api/openai/realtime/briefing-session",
      sessionBody: { business_context: businessContext },

      onStateChange: (state) => {
        setSnapshot((prev) => {
          const connectionStatus: BriefingConnectionStatus =
            state === "connecting" ? "connecting"
            : state === "error" ? "error"
            : state === "disconnected" ? "disconnected"
            : prev.connectionStatus === "connecting" ? "connected"
            : prev.connectionStatus;

          if (prev.voiceState === state && prev.connectionStatus === connectionStatus) return prev;
          return { ...prev, voiceState: state, connectionStatus };
        });
      },

      onTranscript: (entry: VoiceTranscriptEntry) => {
        // Only process final turns to avoid noisy partial renders
        if (!entry.isFinal) return;

        setSnapshot((prev) => ({
          ...prev,
          transcript: [...prev.transcript, entry].slice(-24),
        }));

        // Persist turn to Supabase
        const dbSessionId = sessionIdRef.current;
        if (dbSessionId) {
          const role: "user" | "assistant" = entry.role === "user" ? "user" : "assistant";
          void appendMessage(dbSessionId, role, entry.text, {
            source: "briefing_voice",
          }).catch(console.error);
        }
      },

      onError: (error) => {
        setSnapshot((prev) => ({
          ...prev,
          voiceState: "error",
          connectionStatus: "error",
          error,
        }));
      },

      onConnected: () => {
        setSnapshot((prev) => ({
          ...prev,
          voiceState: "listening",
          connectionStatus: "connected",
          error: undefined,
        }));
      },

      onDisconnected: () => {
        setSnapshot((prev) => ({
          ...prev,
          voiceState: prev.voiceState === "error" ? "error" : "disconnected",
          connectionStatus: prev.voiceState === "error" ? "error" : "disconnected",
        }));
      },
    });

    clientRef.current = client;

    try {
      await client.connect();
    } catch {
      // Error state is already set via onError callback
    }
  }, [businessContext, businessId]);

  // ── endSession ──────────────────────────────────────────────────────────────

  const endSession = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;

    const sessionId     = sessionIdRef.current;
    const currentBizId  = businessId;
    const currentToken  = accessToken;

    sessionIdRef.current = null;

    setSnapshot((prev) => ({
      ...prev,
      voiceState: "disconnected",
      connectionStatus: "disconnected",
    }));

    // Fire memory extraction in the background — extract structured intelligence
    // from the transcript now stored in Supabase messages.
    if (sessionId && currentBizId) {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

      void fetch("/api/zeya/process-memory", {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId, businessId: currentBizId }),
      }).catch(console.error);
    }
  }, [businessId, accessToken]);

  // ── resetIdle ───────────────────────────────────────────────────────────────
  // Resets the snapshot back to idle after a disconnected/error session,
  // so the activation surface returns to its pre-session appearance.

  const resetIdle = useCallback(() => {
    setSnapshot(INITIAL);
  }, []);

  return { ...snapshot, startSession, endSession, resetIdle };
}
