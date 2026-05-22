import { createElevenLabsSession, type ElevenLabsVoiceSession } from "@/lib/voice/elevenlabs";
import type {
  VoiceConnectionStatus,
  VoiceService,
  VoiceServiceOptions,
  VoiceServiceSnapshot,
  VoiceState,
  VoiceStateListener,
  VoiceTranscriptEntry,
} from "@/types/voice";

const initialSnapshot: VoiceServiceSnapshot = {
  state: "idle",
  connectionStatus: "disconnected",
  transcript: [],
  diagnostics: {},
};

const STABLE_CONNECTION_DELAY_MS = 700;
const AUDIO_DIAGNOSTICS_INTERVAL_MS = 1250;

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice] ${message}`, details ?? {});
}

function resolveStateFromStatus(status: VoiceConnectionStatus): VoiceState {
  if (status === "connecting") return "connecting";
  if (status === "connected") return "listening";
  return "disconnected";
}

export function createVoiceService(options: VoiceServiceOptions): VoiceService {
  let session: ElevenLabsVoiceSession | undefined;
  let activeSessionToken = 0;
  let explicitDisconnectRequested = false;
  let diagnosticWebSocketFallbackUsed = false;
  let activeTransport: "webrtc" | "websocket" = "webrtc";
  let stableConnectionTimer: ReturnType<typeof setTimeout> | undefined;
  let audioDiagnosticsTimer: ReturnType<typeof setInterval> | undefined;
  let snapshot: VoiceServiceSnapshot = initialSnapshot;
  const listeners = new Set<VoiceStateListener>();

  // Provider boundaries live here so future Twilio, routing, memory, and scheduling
  // layers can attach without leaking vendor details into the interface components.
  function emit(next: Partial<VoiceServiceSnapshot>) {
    snapshot = { ...snapshot, ...next };
    devLog("state update", {
      state: snapshot.state,
      connectionStatus: snapshot.connectionStatus,
      conversationId: snapshot.conversationId,
      hasError: Boolean(snapshot.error),
    });
    listeners.forEach((listener) => listener(snapshot));
  }

  function clearStableConnectionTimer() {
    if (!stableConnectionTimer) return;
    clearTimeout(stableConnectionTimer);
    stableConnectionTimer = undefined;
  }

  function stopAudioDiagnostics() {
    if (!audioDiagnosticsTimer) return;
    clearInterval(audioDiagnosticsTimer);
    audioDiagnosticsTimer = undefined;
  }

  function startAudioDiagnostics(currentToken: number) {
    stopAudioDiagnostics();
    audioDiagnosticsTimer = setInterval(() => {
      if (currentToken !== activeSessionToken || !session) {
        stopAudioDiagnostics();
        return;
      }

      try {
        const diagnostics = session.getRuntimeDiagnostics();
        devLog("runtime stream state", diagnostics);
        emit({ diagnostics });
      } catch (error) {
        devLog("runtime diagnostics unavailable", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, AUDIO_DIAGNOSTICS_INTERVAL_MS);
  }

  function appendTranscript(entry: VoiceTranscriptEntry) {
    emit({
      transcript: [...snapshot.transcript, entry].slice(-12),
    });
  }

  async function startConversation() {
    if (session || snapshot.state === "connecting") return;

    const currentToken = activeSessionToken + 1;
    activeSessionToken = currentToken;
    explicitDisconnectRequested = false;
    clearStableConnectionTimer();
    stopAudioDiagnostics();

    diagnosticWebSocketFallbackUsed = false;
    activeTransport = "webrtc";

    devLog("session lifecycle start", { token: currentToken, transport: activeTransport });
    emit({
      state: "connecting",
      connectionStatus: "connecting",
      error: undefined,
      disconnectDetails: undefined,
    });

    try {
      const openProviderSession = async (transport: "webrtc" | "websocket") =>
        createElevenLabsSession(options, {
        onMicPermissionChange: (status) => {
          devLog("mic permission status", { status });
        },
        onConnect: (conversationId) => {
          if (currentToken !== activeSessionToken) return;

          devLog("connection success", { token: currentToken, conversationId });
          clearStableConnectionTimer();
          stableConnectionTimer = setTimeout(() => {
            if (currentToken !== activeSessionToken || !session?.isOpen()) return;

            devLog("connection stable", {
              token: currentToken,
              conversationId: conversationId ?? session.id,
            });
            emit({
              state: "listening",
              connectionStatus: "connected",
              conversationId: conversationId ?? session.id,
            });
          }, STABLE_CONNECTION_DELAY_MS);
        },
        onDisconnect: (disconnectDetails) => {
          if (currentToken !== activeSessionToken) return;

          devLog("connection disconnected", {
            token: currentToken,
            transport: activeTransport,
            explicitDisconnectRequested,
            ...disconnectDetails,
          });
          clearStableConnectionTimer();
          stopAudioDiagnostics();
          session = undefined;

          if (
            !explicitDisconnectRequested &&
            options.diagnosticFallbackToWebSocket !== false &&
            activeTransport === "webrtc" &&
            !diagnosticWebSocketFallbackUsed
          ) {
            diagnosticWebSocketFallbackUsed = true;
            activeTransport = "websocket";
            emit({
              state: "connecting",
              connectionStatus: "connecting",
              disconnectDetails,
              error:
                disconnectDetails?.message ??
                disconnectDetails?.closeReason ??
                disconnectDetails?.contextReason ??
                "WebRTC interrupted. Trying WebSocket for diagnostics.",
            });

            devLog("starting diagnostic websocket fallback", {
              token: currentToken,
              previousDisconnect: disconnectDetails,
            });

            openProviderSession("websocket")
              .then((fallbackSession) => {
                if (currentToken !== activeSessionToken) {
                  void fallbackSession.end().catch(() => undefined);
                  return;
                }

                session = fallbackSession;
                startAudioDiagnostics(currentToken);
                emit({
                  conversationId: fallbackSession.id,
                  connectionStatus: fallbackSession.isOpen() ? "connected" : "disconnected",
                  state: fallbackSession.isOpen() ? "connecting" : "error",
                });
              })
              .catch((error: unknown) => {
                if (currentToken !== activeSessionToken) return;
                const message = error instanceof Error ? error.message : String(error);
                devLog("diagnostic websocket fallback failed", { token: currentToken, message });
                emit({
                  state: "error",
                  connectionStatus: "disconnected",
                  error: message,
                  disconnectDetails,
                });
              });

            return;
          }

          emit({
            state: explicitDisconnectRequested ? "disconnected" : "error",
            connectionStatus: "disconnected",
            disconnectDetails,
            error: explicitDisconnectRequested
              ? undefined
              : disconnectDetails?.message ??
                disconnectDetails?.closeReason ??
                disconnectDetails?.contextReason ??
                "Connection interrupted.",
          });
        },
        onError: (error) => {
          if (currentToken !== activeSessionToken) return;

          devLog("connection error", { token: currentToken, message: error.message });
          emit({ state: "error", error: error.message });
        },
        onStatusChange: (connectionStatus) => {
          if (currentToken !== activeSessionToken) return;

          devLog("agent connection status", { token: currentToken, connectionStatus });

          if (connectionStatus === "disconnected" && session?.isOpen()) {
            devLog("ignored transient disconnected status while session is open", {
              token: currentToken,
            });
            return;
          }

          emit({
            connectionStatus,
            state:
              connectionStatus === "connected" && snapshot.state === "connecting"
                ? "connecting"
                : resolveStateFromStatus(connectionStatus),
          });
        },
        onModeChange: (mode) => {
          if (currentToken !== activeSessionToken) return;

          devLog("voice mode", { token: currentToken, mode });
          emit({ state: mode === "speaking" ? "speaking" : "listening" });
        },
        onTranscript: (entry) => {
          if (currentToken !== activeSessionToken) return;

          appendTranscript(entry);
          if (entry.role === "user" && entry.isFinal) emit({ state: "thinking" });
          if (entry.role === "agent" && entry.isFinal) emit({ state: "listening" });
        },
        onRuntimeDiagnostics: (diagnostics) => {
          devLog("session runtime diagnostics", diagnostics);
          emit({ diagnostics });
        },
      }, transport);

      const nextSession = await openProviderSession(activeTransport);

      if (currentToken !== activeSessionToken) {
        await nextSession.end().catch(() => undefined);
        return;
      }

      session = nextSession;
      startAudioDiagnostics(currentToken);

      emit({
        conversationId: session.id,
        connectionStatus: session.isOpen() ? "connected" : "disconnected",
        state: session.isOpen() ? "connecting" : "error",
      });
    } catch (error) {
      if (currentToken !== activeSessionToken) return;

      const message = error instanceof Error ? error.message : String(error);
      session = undefined;
      clearStableConnectionTimer();
      stopAudioDiagnostics();
      devLog("connection failure", { message });
      emit({ state: "error", connectionStatus: "disconnected", error: message });
    }
  }

  async function stopConversation() {
    explicitDisconnectRequested = true;
    activeSessionToken += 1;
    clearStableConnectionTimer();
    stopAudioDiagnostics();

    if (!session) {
      emit({ state: "disconnected", connectionStatus: "disconnected" });
      return;
    }

    const sessionToEnd = session;
    session = undefined;
    emit({ state: "processing" });
    await sessionToEnd.end();
    emit({ state: "disconnected", connectionStatus: "disconnected" });
  }

  return {
    connect: startConversation,
    disconnect: stopConversation,
    startConversation,
    stopConversation,
    sendTextMessage: async (message: string) => {
      if (!session) throw new Error("Voice conversation has not started.");
      await session.sendTextMessage(message);
      appendTranscript({
        id: `${Date.now()}-local`,
        role: "user",
        text: message,
        isFinal: true,
        createdAt: Date.now(),
      });
      emit({ state: "thinking" });
    },
    receiveTranscript: (listener: VoiceStateListener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    onStateChange: (listener: VoiceStateListener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
