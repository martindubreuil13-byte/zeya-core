import {
  stateFromRealtimeEvent,
  transcriptFromRealtimeEvent,
} from "@/lib/realtime/realtime-events";
import type { RealtimeSessionEvent } from "@/types/realtime";
import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";

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
};

export type OpenAIRealtimeClientEvents = {
  onStateChange?: (state: VoiceState) => void;
  onTranscript?: (entry: VoiceTranscriptEntry) => void;
  onError?: (message: string) => void;
  onEvent?: (event: RealtimeSessionEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  // Optional overrides — if omitted, defaults to the onboarding session endpoint
  sessionEndpoint?: string;
  sessionBody?: Record<string, unknown>;
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

  async connect(initialResponseInstructions?: string) {
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
        console.log("[VOICE] Audio track received from Realtime");
        const audioElement = this.ensureAudioElement();
        devLog("first audio track received");
        audioElement.srcObject = event.streams[0];

        // Add event listeners for playback
        audioElement.addEventListener("play", () => {
          console.log("[VOICE] Audio playback started");
        });
        audioElement.addEventListener("ended", () => {
          console.log("[VOICE] Audio playback finished");
        });
        audioElement.addEventListener("error", (e) => {
          console.error("[VOICE] Audio playback error", e);
        });

        console.log("[VOICE] Calling audioElement.play()");
        audioElement.play().catch((error) => {
          console.error("[VOICE] Audio autoplay failed", {
            message: error instanceof Error ? error.message : String(error),
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
      console.log("[CONNECTION] Setting remote SDP", {
        instanceId: this.instanceId,
        timestamp: Math.round(performance.now()),
      });
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      console.log("[CONNECTION] connect() complete, returning", {
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

    // Inject the exact text as an assistant message in the conversation
    const itemEvent: RealtimeSessionEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: text,
          },
        ],
      },
    };

    console.log("[VOICE] Sending conversation.item.create event");
    devLog("conversation.item.create (speakExact)", { text: text.slice(0, 50) });
    this.sendEvent(itemEvent);
    console.log("[VOICE] conversation.item.create event sent");

    // Request synthesis of the message (no model generation, only TTS)
    const responseEvent: RealtimeSessionEvent = {
      type: "response.create",
      response: {
        modalities: ["audio"],
      },
    };

    console.log("[VOICE] Sending response.create event (synthesis)");
    devLog("response.create (synthesis only)", {});
    this.sendEvent(responseEvent);
    console.log("[VOICE] response.create event sent");
  }

  private async createSession() {
    const endpoint = this.events.sessionEndpoint ?? "/api/openai/realtime/session";
    const bodyPayload = this.events.sessionBody;

    devLog("Creating session", { endpoint });

    let data: RealtimeSessionResponse;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: bodyPayload ? { "Content-Type": "application/json" } : {},
        body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
        cache: "no-store",
      });

      devLog("Session response received", {
        status: response.status,
        statusText: response.statusText,
      });

      data = (await response.json()) as RealtimeSessionResponse;

      if (!response.ok) {
        const errorMsg = data.error ?? `HTTP ${response.status}: ${response.statusText}`;
        devLog("Session creation failed", {
          status: response.status,
          error: errorMsg,
          details: data.details,
        });
        throw new Error(errorMsg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      devLog("Session fetch failed", { error: msg });
      throw new Error(`Session creation failed: ${msg}`);
    }

    devLog("Session created successfully", {
      hasClientSecret: !!data.client_secret?.value,
      model: data.model,
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

        if (REALTIME_DEBUG) {
          console.info("[Zeya realtime event]", event.type, event);
        }

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
        devLog("user speech stopped:", { t: Math.round(performance.now()) });
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript : "";
        const inferredState = this.responseActive
          ? this.audioOutputActive ? "speaking" : "thinking"
          : "listening";
        devLog("transcript received while state:", { text, inferredState });
        break;
      }
      case "response.created":
        if (this.responseActive) {
          devLog("stuck guard fired: response.created while responseActive=true — possible missed response.done");
        }
        this.responseActive = true;
        this.hasReceivedAudioForResponse = false;
        this.hasPlayedAudioForResponse = false;
        this.responseStartedAt = performance.now();
        devLog("response lifecycle: response.created", { t: Math.round(performance.now()) });
        break;
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
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
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
      devLog("audio playing");
      this.markFirstAudioPlayed();
    };
    audioElement.onended = () => {
      devLog("audio ended");
    };
    document.body.appendChild(audioElement);
    this.audioElement = audioElement;

    return audioElement;
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
}
