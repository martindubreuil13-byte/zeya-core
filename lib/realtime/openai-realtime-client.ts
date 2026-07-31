import {
  stateFromRealtimeEvent,
  transcriptFromRealtimeEvent,
} from "@/lib/realtime/realtime-events";
import type { RealtimeSessionEvent } from "@/types/realtime";
import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";
import { EXPERIENCE_DEBUG_ENABLED, experienceDebugLog, experienceDebugTable, type ExperienceDebugStage } from "@/lib/experience/experience-debug";

const REALTIME_DEBUG = process.env.NEXT_PUBLIC_REALTIME_DEBUG === "true";

type RealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  value?: string;
  model?: string;
  error?: string;
  details?: Record<string, unknown>;
  type?: string;
  voice_context_id?: string;
  experience_token?: string;
  expires_at?: string;
  stage?: string;
};

export class RealtimeSessionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly stage: string,
  ) {
    super(code);
    this.name = "RealtimeSessionRequestError";
  }
}

export type OpenAIRealtimeClientEvents = {
  onStateChange?: (state: VoiceState) => void;
  onTranscript?: (entry: VoiceTranscriptEntry) => void;
  onError?: (message: string) => void;
  onEvent?: (event: RealtimeSessionEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onSessionCreated?: (session: { voiceContextId?: string; experienceToken?: string; expiresAt?: string }) => void;
  // Optional overrides — if omitted, defaults to the onboarding session endpoint
  sessionEndpoint?: string;
  sessionBody?: Record<string, unknown>;
  sessionHeaders?: Record<string, string>;
  sessionRequest?: (
    endpoint: string,
    init: RequestInit,
  ) => Promise<Response>;
};

function devLog(message: string, details?: Record<string, unknown>) {
  if (!REALTIME_DEBUG && process.env.NODE_ENV !== "development") return;
  console.info(`[ZEYA REALTIME] ${message}`, details ?? {});
}

export class OpenAIRealtimeClient {
  private static instanceCounter = 0;
  private instanceId: string;

  private peerConnection?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private localStream?: MediaStream;
  private audioElement?: HTMLAudioElement;
  private connected = false;
  private pendingEvents: RealtimeSessionEvent[] = [];
  private responseActive = false;
  private audioOutputActive = false;
  private hasReceivedAudioForResponse = false;
  private hasPlayedAudioForResponse = false;
  private speechStoppedAt?: number;
  private responseStartedAt?: number;
  private firstAudioReceivedAt?: number;
  private firstAudioPlayedAt?: number;
  private responseCreatedTimeout?: ReturnType<typeof setTimeout>;
  private remoteAudioTrackReceived = false;
  private experienceDebugStages: Partial<Record<ExperienceDebugStage, number>> = {};

  // Transport readiness tracking
  private connectionReadyPromise?: {
    promise: Promise<void>;
    resolve?: () => void;
    reject?: (error: Error) => void;
  };

  constructor(private readonly events: OpenAIRealtimeClientEvents = {}) {
    OpenAIRealtimeClient.instanceCounter++;
    this.instanceId = `OpenAIRealtimeClient-${OpenAIRealtimeClient.instanceCounter}`;
    console.log("[INSTANCE] Constructor called", {
      instanceId: this.instanceId,
      instanceCounter: OpenAIRealtimeClient.instanceCounter,
      timestamp: Math.round(performance.now()),
    });
  }

  get isConnected() {
    return this.connected;
  }

  private checkTransportReady(): void {
    if (!this.connectionReadyPromise) return;
    if (this.connectionReadyPromise.promise === null) return; // Already resolved

    const isConnected = this.connected === true;
    const isDataChannelOpen = this.dataChannel?.readyState === "open";

    console.log("[CONNECTION] Transport readiness check", {
      instanceId: this.instanceId,
      isConnected,
      isDataChannelOpen,
      dataChannelState: this.dataChannel?.readyState,
      timestamp: Math.round(performance.now()),
    });

    if (isConnected && isDataChannelOpen) {
      console.log("[CONNECTION] ✅ Transport fully ready", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      this.connectionReadyPromise.resolve?.();
      // Mark as resolved by nullifying
      this.connectionReadyPromise.promise = null as any;
    }
  }

  async connect(initialResponseInstructions?: string) {
    this.markExperienceDebugStage("session_started");
    console.log("[INSTANCE] connect() called", {
      instanceId: this.instanceId,
      hasInitialInstructions: Boolean(initialResponseInstructions),
      timestamp: Math.round(performance.now()),
    });

    if (this.peerConnection) {
      if (this.connected) {
        // Active session already exists — just send the response if requested
        if (initialResponseInstructions) this.requestResponse(initialResponseInstructions);
        return;
      }
      // Stale peerConnection from a previous error — clean it up before reconnecting
      devLog("stale peer connection found, cleaning up before reconnect");
      this.peerConnection.close();
      this.peerConnection = undefined;
    }

    this.ensureAudioElement();
    this.events.onStateChange?.("connecting");

    try {
      const session = await this.createSession();
      const ephemeralKey = session.client_secret?.value ?? session.value;

      if (!ephemeralKey) {
        throw new Error("Realtime session did not return a client secret.");
      }

      const pc = new RTCPeerConnection();
      this.peerConnection = pc;

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        this.remoteAudioTrackReceived = true;
        console.log("[VOICE][AUDIO] pc.ontrack", {
          track: {
            id: event.track.id,
            kind: event.track.kind,
            enabled: event.track.enabled,
            muted: event.track.muted,
            readyState: event.track.readyState,
          },
          streamCount: event.streams.length,
          remoteTracks: remoteStream.getTracks().map((track) => ({
            id: track.id,
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          })),
        });
        const audioElement = this.ensureAudioElement();
        devLog("first audio track received");
        audioElement.srcObject = remoteStream;
        console.log("[VOICE][AUDIO] audio element srcObject assigned", {
          srcObjectIsRemoteStream: audioElement.srcObject === remoteStream,
          paused: audioElement.paused,
          readyState: audioElement.readyState,
          muted: audioElement.muted,
        });

        console.log("[VOICE][AUDIO] calling audio.play()", this.audioElementState(audioElement));
        audioElement.play().then(() => {
          console.log("[VOICE][AUDIO] audio.play() succeeded", this.audioElementState(audioElement));
        }).catch((error) => {
          const errorName = error instanceof DOMException ? error.name : "PlaybackError";
          const category = errorName === "NotAllowedError"
            ? "c) audio track received but playback blocked"
            : "d) browser playback error";
          console.error(`[VOICE][AUDIO] ${category}`, {
            name: errorName,
            message: error instanceof Error ? error.message : String(error),
            ...this.audioElementState(audioElement),
          });
          devLog("audio autoplay blocked", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      };

      pc.onconnectionstatechange = () => {
        devLog("pc connection state:", {
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState,
        });

        console.log("[CONNECTION] pc.onconnectionstatechange fired", {
          connectionState: pc.connectionState,
          timestamp: Math.round(performance.now()),
        });

        if (pc.connectionState === "connected") {
          const connectedTimestamp = performance.now();
          console.log("[CONNECTION] connected=true", {
            instanceId: this.instanceId,
            timestamp: Math.round(connectedTimestamp),
            millisecondsSincePageLoad: Math.round(connectedTimestamp),
          });
          this.connected = true;
          this.events.onConnected?.();
          this.events.onStateChange?.("listening");
          this.checkTransportReady();
        }

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          console.log("[CONNECTION] connected=false", {
            reason: pc.connectionState,
            timestamp: Math.round(performance.now()),
          });
          this.connected = false;
          this.events.onDisconnected?.();
          if (pc.connectionState !== "closed") {
            this.events.onStateChange?.("disconnected");
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[CONNECTION] ice state change", {
          iceConnectionState: pc.iceConnectionState,
          timestamp: Math.round(performance.now()),
        });
        devLog("ice state:", { iceConnectionState: pc.iceConnectionState });
      };

      console.log("[CONNECTION] Requesting microphone access", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.markExperienceDebugStage("microphone_opened");
      console.log("[CONNECTION] Microphone access granted, adding audio tracks", {
        instanceId: this.instanceId,
        trackCount: this.localStream.getAudioTracks().length,
        timestamp: Math.round(performance.now()),
      });
      this.localStream.getAudioTracks().forEach((track) => {
        console.log("[CONNECTION] Adding audio track to peer connection", {
          instanceId: this.instanceId,
          trackEnabled: track.enabled,
          trackReadyState: track.readyState,
        });
        pc.addTrack(track, this.localStream!);
      });

      const dc = pc.createDataChannel("oai-events");
      console.log("[CONNECTION] Data channel created", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      this.dataChannel = dc;
      this.attachDataChannel(dc);
      if (initialResponseInstructions) {
        this.requestResponse(initialResponseInstructions);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (!offer.sdp) {
        throw new Error("Could not create a realtime audio offer.");
      }

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        const body = await sdpResponse.text().catch(() => "");
        throw new Error(body || `Realtime connection failed with ${sdpResponse.status}.`);
      }

      const answerSdp = await sdpResponse.text();

      // Create deferred promise BEFORE setRemoteDescription
      // (callbacks fire immediately after, must exist when they check)
      let resolveReady!: () => void;
      let rejectReady!: (error?: any) => void;

      const promise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });

      this.connectionReadyPromise = {
        promise,
        resolve: resolveReady,
        reject: rejectReady,
      };

      console.log("[CONNECTION] Setting remote SDP", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // Wait for BOTH conditions: connected=true AND dataChannel.readyState="open"
      await this.connectionReadyPromise.promise;

      console.log("[CONNECTION] Transport ready, connect() resolving", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
        connected: this.connected,
        dataChannelState: this.dataChannel?.readyState,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.onError?.(message);
      this.events.onStateChange?.("error");
      this.close();
      throw error;
    }
  }

  close() {
    console.log("[CONNECTION] close() called, setting connected=false", {
      timestamp: Math.round(performance.now()),
      wasConnected: this.connected,
    });
    this.connected = false;
    this.dataChannel?.close();
    this.dataChannel = undefined;

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = undefined;

    this.peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
    this.peerConnection?.close();
    this.peerConnection = undefined;

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement.remove();
      this.audioElement = undefined;
    }

    this.pendingEvents = [];
    this.responseActive = false;
    this.audioOutputActive = false;
    this.hasReceivedAudioForResponse = false;
    this.hasPlayedAudioForResponse = false;
    this.speechStoppedAt = undefined;
    this.responseStartedAt = undefined;
    this.firstAudioReceivedAt = undefined;
    this.firstAudioPlayedAt = undefined;
    if (this.responseCreatedTimeout) clearTimeout(this.responseCreatedTimeout);
    this.responseCreatedTimeout = undefined;
    this.remoteAudioTrackReceived = false;
    this.events.onDisconnected?.();
  }

  requestResponse(instructions?: string) {
    const event: RealtimeSessionEvent = {
      type: "response.create",
      response: instructions
        ? {
            instructions,
          }
        : undefined,
    };
    devLog("response.create sent", { hasInstructions: Boolean(instructions) });
    this.markExperienceDebugStage("transcript_sent_to_llm");
    this.markExperienceDebugStage("tts_request_started");
    this.sendEvent(event);
  }

  speakExact(text: string): void {
    const speakExactTimestamp = performance.now();
    const dcState = this.dataChannel?.readyState ?? "undefined";
    console.log("[VOICE] speakExact() called", {
      instanceId: this.instanceId,
      timestamp: speakExactTimestamp,
      millisecondsSincePageLoad: Math.round(speakExactTimestamp),
      textLength: text.length,
      connected: this.connected,
      dataChannelReady: Boolean(this.dataChannel),
      dataChannelState: dcState,
    });

    if (!this.connected) {
      console.error("[VOICE] ERROR: Not connected to Realtime!", {
        timestamp: performance.now(),
        millisecondsSincePageLoad: Math.round(performance.now()),
      });
      return;
    }

    if (!this.dataChannel) {
      console.error("[VOICE] ERROR: Data channel not ready!", {
        timestamp: performance.now(),
        millisecondsSincePageLoad: Math.round(performance.now()),
      });
      return;
    }

    // A client-created assistant item is conversation history; it is not a TTS
    // request. Ask the model to speak via the supported response input contract.
    const responseEvent: RealtimeSessionEvent = {
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `Speak exactly the supplied text. Do not add, remove, or paraphrase any words. Supplied text: ${JSON.stringify(text)}`,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Speak this exact text aloud: ${text}`,
              },
            ],
          },
        ],
      },
    };

    console.log("[VOICE] Sending response.create event (exact audio response)");
    this.markExperienceDebugStage("transcript_sent_to_llm");
    this.markExperienceDebugStage("tts_request_started");
    devLog("response.create (exact audio response)", { text: text.slice(0, 50) });
    this.sendEvent(responseEvent);
    console.log("[VOICE] response.create event sent");

    if (this.responseCreatedTimeout) clearTimeout(this.responseCreatedTimeout);
    this.responseCreatedTimeout = setTimeout(() => {
      if (!this.responseActive) {
        console.error("[VOICE][DIAGNOSTIC] a) no response generated", {
          reason: "No response.created event received within 8 seconds of response.create",
        });
      }
      this.responseCreatedTimeout = undefined;
    }, 8_000);
  }

  private async createSession() {
    const endpoint = this.events.sessionEndpoint ?? "/api/openai/realtime/session";
    const bodyPayload = this.events.sessionBody;

    devLog("Creating session", { endpoint });

    let data: RealtimeSessionResponse;
    try {
      const sessionRequest =
        this.events.sessionRequest ??
        ((requestEndpoint: string, init: RequestInit) =>
          fetch(requestEndpoint, init));
      const response = await sessionRequest(endpoint, {
        method: "POST",
        headers: {
          ...(bodyPayload ? { "Content-Type": "application/json" } : {}),
          ...(this.events.sessionHeaders ?? {}),
        },
        body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
        cache: "no-store",
      });

      devLog("Session response received", {
        status: response.status,
        statusText: response.statusText,
      });

      data = (await response.json()) as RealtimeSessionResponse;

      if (!response.ok) {
        const errorMsg =
          data.error ?? `HTTP ${response.status}: ${response.statusText}`;
        devLog("Session creation failed", {
          status: response.status,
          error: errorMsg,
          stage: data.stage,
        });
        throw new RealtimeSessionRequestError(
          response.status,
          errorMsg,
          data.stage ?? "client_connection",
        );
      }
    } catch (e) {
      if (e instanceof RealtimeSessionRequestError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      devLog("Session fetch failed", { error: msg });
      throw new RealtimeSessionRequestError(
        0,
        "experience_session_failed",
        "client_connection",
      );
    }

    devLog("Session created successfully", {
      hasClientSecret: !!data.client_secret?.value,
      model: data.model,
    });
    this.events.onSessionCreated?.({
      voiceContextId: data.voice_context_id,
      experienceToken: data.experience_token,
      expiresAt: data.expires_at,
    });

    return data;
  }

  private attachDataChannel(dc: RTCDataChannel) {
    console.log("[CONNECTION] attachDataChannel called", {
      instanceId: this.instanceId,
      timestamp: Math.round(performance.now()),
    });

    dc.onopen = () => {
      const dataChannelOpenTimestamp = performance.now();
      console.log("[CONNECTION] data channel opened", {
        instanceId: this.instanceId,
        timestamp: Math.round(dataChannelOpenTimestamp),
        millisecondsSincePageLoad: Math.round(dataChannelOpenTimestamp),
        connected: this.connected,
        pendingEventCount: this.pendingEvents.length,
      });
      devLog("data channel state: open");
      this.flushPendingEvents();
      this.events.onStateChange?.("listening");
      this.checkTransportReady();
    };

    dc.onclose = () => {
      console.log("[CONNECTION] data channel closed", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      devLog("data channel state: closed");
    };

    dc.onerror = (e) => {
      console.log("[CONNECTION] data channel error", {
        instanceId: this.instanceId,
        error: String(e),
        timestamp: Math.round(performance.now()),
      });
      devLog("data channel state: error", { event: String(e) });
      this.events.onError?.("Realtime data channel interrupted.");
    };

    dc.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as RealtimeSessionEvent;
        this.events.onEvent?.(event);
        console.info("[ZEYA REALTIME][SERVER EVENT]", event.type ?? "unknown", event);

        this.handleRealtimeTiming(event);

        const nextState = stateFromRealtimeEvent(event);
        if (nextState) this.events.onStateChange?.(nextState);

        const transcript = transcriptFromRealtimeEvent(event);
        if (transcript) this.events.onTranscript?.(transcript);

        if (event.type === "error") {
          const messageText =
            typeof event.message === "string"
              ? event.message
              : typeof event.error === "object" && event.error
                ? String((event.error as Record<string, unknown>).message ?? "Realtime error.")
                : "Realtime error.";
          devLog("server error event", { message: messageText, code: (event.error as Record<string, unknown> | undefined)?.code });
          this.events.onError?.(messageText);
        }
      } catch (error) {
        this.events.onError?.(
          error instanceof Error ? error.message : "Could not read realtime event.",
        );
      }
    };
  }

  private sendEvent(event: RealtimeSessionEvent) {
    const dcState = this.dataChannel?.readyState ?? "undefined";
    console.log("[VOICE] sendEvent()", {
      instanceId: this.instanceId,
      type: event.type,
      dataChannelReady: dcState === "open",
      dataChannelState: dcState,
      timestamp: Math.round(performance.now()),
    });

    if (this.dataChannel?.readyState === "open") {
      console.log("[VOICE] Sending event immediately", {
        instanceId: this.instanceId,
        type: event.type,
        timestamp: Math.round(performance.now()),
      });
      this.dataChannel.send(JSON.stringify(event));
      return;
    }

    console.log("[VOICE] Data channel not open, queuing event", {
      instanceId: this.instanceId,
      dataChannelState: dcState,
      pendingEventCount: this.pendingEvents.length,
      timestamp: Math.round(performance.now()),
    });
    this.pendingEvents.push(event);
  }

  private flushPendingEvents() {
    if (this.dataChannel?.readyState !== "open") return;
    const events = this.pendingEvents.splice(0);
    console.log("[VOICE] Flushing pending events", {
      instanceId: this.instanceId,
      count: events.length,
      timestamp: Math.round(performance.now()),
    });
    events.forEach((event) => {
      console.log("[VOICE] Sending flushed event", {
        instanceId: this.instanceId,
        type: event.type,
      });
      this.dataChannel?.send(JSON.stringify(event));
    });
  }

  private handleRealtimeTiming(event: RealtimeSessionEvent) {
    switch (event.type) {
      case "input_audio_buffer.speech_started": {
        this.resetTurnTiming();
        this.resetExperienceDebugTurn();
        this.markExperienceDebugStage("user_speech_started");
        const wasInterruption = this.responseActive || this.audioOutputActive;
        devLog("user speech started:", {
          t: Math.round(performance.now()),
          responseActive: this.responseActive,
          audioOutputActive: this.audioOutputActive,
          isInterruption: wasInterruption,
        });
        if (wasInterruption) {
          devLog("correction-like user turn: user spoke while Zeya was active");
        }
        if (this.responseActive) {
          // Only cancel when a response is genuinely active — avoids "no active response" errors
          // that occur in the race window between response.done and output_audio_buffer.stopped.
          devLog("response lifecycle: cancelling in-progress response");
          this.sendEvent({ type: "response.cancel" });
        }
        if (this.audioOutputActive || this.responseActive) {
          // Pause local playback. Audio element resumes automatically when next response audio arrives.
          this.audioElement?.pause();
          this.audioOutputActive = false;
        }
        if (!this.responseActive && this.audioOutputActive) {
          devLog("stuck guard fired: audio active but no response — orphaned audio, resetting");
        }
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedAt = performance.now();
        this.markExperienceDebugStage("vad_speech_ended");
        devLog("user speech stopped:", { t: Math.round(performance.now()) });
        break;
      case "conversation.item.input_audio_transcription.completed": {
        this.markExperienceDebugStage("transcript_finalized");
        const text = typeof event.transcript === "string" ? event.transcript : "";
        const inferredState = this.responseActive
          ? this.audioOutputActive ? "speaking" : "thinking"
          : "listening";
        devLog("transcript received while state:", { text, inferredState });
        break;
      }
      case "response.created":
        if (this.responseCreatedTimeout) clearTimeout(this.responseCreatedTimeout);
        this.responseCreatedTimeout = undefined;
        if (this.responseActive) {
          devLog("stuck guard fired: response.created while responseActive=true — possible missed response.done");
        }
        this.responseActive = true;
        this.hasReceivedAudioForResponse = false;
        this.hasPlayedAudioForResponse = false;
        this.responseStartedAt = performance.now();
        this.markExperienceDebugStage("llm_response_received");
        devLog("response lifecycle: response.created", { t: Math.round(performance.now()) });
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
      case "output_audio_buffer.started":
        this.audioOutputActive = true;
        // Resume the audio element if it was paused during a prior interruption.
        // The srcObject (live WebRTC track) is still connected — play() picks up
        // the current position in the stream so the new response is audible.
        if (this.audioElement?.paused) {
          this.audioElement.play().catch((e) => {
            devLog("audio resume failed after interruption", { message: String(e) });
          });
        }
        if (!this.hasReceivedAudioForResponse) {
          this.hasReceivedAudioForResponse = true;
          this.firstAudioReceivedAt = performance.now();
          this.markExperienceDebugStage("first_audio_byte_received");
          if (this.audioElement && !this.audioElement.paused) {
            this.markFirstAudioPlayed("audio element already playing");
          }
        }
        break;
      case "response.done":
        this.responseActive = false;
        devLog("response lifecycle: response.done", {
          t: Math.round(performance.now()),
          status: (event.response as Record<string, unknown> | undefined)?.status,
        });
        if (!this.hasReceivedAudioForResponse) {
          console.error("[VOICE][DIAGNOSTIC] b) response generated but no audio", {
            remoteAudioTrackReceived: this.remoteAudioTrackReceived,
            response: event.response,
          });
        }
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.markExperienceDebugStage("speech_playback_finished");
        this.markExperienceDebugStage("next_listening_entered");
        this.reportExperienceDebugTurn();
        this.responseActive = false;
        this.audioOutputActive = false;
        break;
      default:
        break;
    }
  }

  private ensureAudioElement() {
    if (this.audioElement) return this.audioElement;

    const audioElement = document.createElement("audio");
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.setAttribute("playsinline", "true");
    audioElement.style.display = "none";
    audioElement.onplaying = () => {
      console.log("[VOICE][AUDIO] playing", this.audioElementState(audioElement));
      devLog("audio playing");
      this.markFirstAudioPlayed();
      this.markExperienceDebugStage("speech_playback_started");
    };
    audioElement.onpause = () => {
      console.log("[VOICE][AUDIO] paused", this.audioElementState(audioElement));
    };
    audioElement.onended = () => {
      console.log("[VOICE][AUDIO] ended", this.audioElementState(audioElement));
      devLog("audio ended");
    };
    audioElement.onerror = () => {
      console.error("[VOICE][AUDIO] d) browser playback error", {
        mediaErrorCode: audioElement.error?.code,
        mediaErrorMessage: audioElement.error?.message,
        ...this.audioElementState(audioElement),
      });
    };
    document.body.appendChild(audioElement);
    this.audioElement = audioElement;

    return audioElement;
  }

  private audioElementState(audioElement = this.audioElement) {
    return {
      paused: audioElement?.paused,
      readyState: audioElement?.readyState,
      muted: audioElement?.muted,
      hasSrcObject: Boolean(audioElement?.srcObject),
    };
  }

  private resetTurnTiming() {
    this.speechStoppedAt = undefined;
    this.responseStartedAt = undefined;
    this.firstAudioReceivedAt = undefined;
    this.firstAudioPlayedAt = undefined;
  }

  private reportTurnLatency() {
    if (!this.speechStoppedAt || !this.responseStartedAt || !this.firstAudioReceivedAt) return;

    console.info("[Zeya realtime latency]", {
      speechEndToResponseStarted: Math.round(this.responseStartedAt - this.speechStoppedAt),
      responseStartedToFirstAudio: Math.round(this.firstAudioReceivedAt - this.responseStartedAt),
      firstAudioReceivedToPlayed: this.firstAudioPlayedAt
        ? Math.round(this.firstAudioPlayedAt - this.firstAudioReceivedAt)
        : undefined,
      totalPerceived: this.firstAudioPlayedAt
        ? Math.round(this.firstAudioPlayedAt - this.speechStoppedAt)
        : undefined,
    });
  }

  private markFirstAudioPlayed(reason?: string) {
    if (this.hasPlayedAudioForResponse) return;

    this.hasPlayedAudioForResponse = true;
    this.firstAudioPlayedAt = performance.now();
    devLog("first audio played", reason ? { reason } : {});
    this.reportTurnLatency();
  }

  private markExperienceDebugStage(stage: ExperienceDebugStage) {
    if (!EXPERIENCE_DEBUG_ENABLED) return;
    const now=performance.now();
    this.experienceDebugStages[stage]=now;
    experienceDebugLog(stage,{elapsedMs:Math.round(now-(this.experienceDebugStages.session_started??now))});
  }

  private resetExperienceDebugTurn() {
    if (!EXPERIENCE_DEBUG_ENABLED) return;
    const sessionStarted=this.experienceDebugStages.session_started;
    const microphoneOpened=this.experienceDebugStages.microphone_opened;
    this.experienceDebugStages={session_started:sessionStarted,microphone_opened:microphoneOpened};
  }

  private reportExperienceDebugTurn() {
    if (!EXPERIENCE_DEBUG_ENABLED) return;
    const stage=this.experienceDebugStages;
    const duration=(start:ExperienceDebugStage,end:ExperienceDebugStage)=>stage[start]!==undefined&&stage[end]!==undefined?Math.round(stage[end]!-stage[start]!):"n/a";
    experienceDebugTable({
      "Microphone open":duration("session_started","microphone_opened"),
      "VAD":duration("user_speech_started","vad_speech_ended"),
      "Transcript":duration("vad_speech_ended","transcript_finalized"),
      "LLM":duration("transcript_sent_to_llm","llm_response_received"),
      "TTS generation":duration("tts_request_started","first_audio_byte_received"),
      "Audio startup":duration("first_audio_byte_received","speech_playback_started"),
      "Audio playback":duration("speech_playback_started","speech_playback_finished"),
      "TOTAL":duration("user_speech_started","next_listening_entered"),
    });
  }
}
