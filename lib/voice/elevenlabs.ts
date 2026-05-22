import { Conversation, type PartialOptions } from "@elevenlabs/client";
import type {
  VoiceConnectionStatus,
  VoiceConversationMode,
  VoiceDisconnectDetails,
  VoiceRuntimeDiagnostics,
  VoiceServiceOptions,
  VoiceTranscriptEntry,
} from "@/types/voice";

type ElevenLabsConversation = Awaited<ReturnType<typeof Conversation.startSession>>;

type ConversationTokenResponse = {
  conversationToken?: string;
  mode?: "conversation-token";
  error?: string;
};

type SignedUrlResponse = {
  signedUrl: string | null;
  mode?: "signed-url" | "public-agent";
  error?: string;
};

type ElevenLabsTransport = "webrtc" | "websocket";

type ObservedPeerConnection = {
  id: string;
  pc: RTCPeerConnection;
};

type ObservedMediaStream = {
  id: string;
  stream: MediaStream;
};

type ObservedDataChannel = {
  id: string;
  label: string;
  channel: RTCDataChannel;
};

type ObservedWebSocket = {
  id: string;
  url: string;
  socket: WebSocket;
  lastClose?: {
    code: number;
    reason: string;
    wasClean: boolean;
  };
};

declare global {
  interface Window {
    __zeyaVoiceDiagnosticsInstalled?: boolean;
    __zeyaPeerConnections?: ObservedPeerConnection[];
    __zeyaMediaStreams?: ObservedMediaStream[];
    __zeyaDataChannels?: ObservedDataChannel[];
    __zeyaWebSockets?: ObservedWebSocket[];
  }
}

type ElevenLabsMessage = {
  source?: string;
  role?: string;
  message?: string;
  text?: string;
  isFinal?: boolean;
};

type ElevenLabsModeChange = {
  mode?: VoiceConversationMode;
};

type ElevenLabsStatusChange = {
  status?: VoiceConnectionStatus;
};

export type ElevenLabsSessionEvents = {
  onMicPermissionChange?: (status: PermissionState | "requesting" | "unsupported") => void;
  onConnect?: (conversationId?: string) => void;
  onDisconnect?: (details?: VoiceDisconnectDetails) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: VoiceConnectionStatus) => void;
  onModeChange?: (mode: VoiceConversationMode) => void;
  onTranscript?: (entry: VoiceTranscriptEntry) => void;
  onRuntimeDiagnostics?: (diagnostics: VoiceRuntimeDiagnostics) => void;
};

export type ElevenLabsVoiceSession = {
  id?: string;
  isOpen: () => boolean;
  getRuntimeDiagnostics: () => VoiceRuntimeDiagnostics;
  sendTextMessage: (message: string) => Promise<void>;
  end: () => Promise<void>;
};

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeDisconnect(details: unknown): VoiceDisconnectDetails | undefined {
  if (!details || typeof details !== "object") return undefined;

  const value = details as {
    reason?: string;
    message?: string;
    closeCode?: number;
    closeReason?: string;
    context?: {
      type?: string;
      reason?: string;
      code?: number;
    };
  };

  return {
    reason: value.reason,
    message: value.message,
    closeCode: value.closeCode,
    closeReason: value.closeReason,
    contextType: value.context?.type,
    contextReason: value.context?.reason,
    contextCode: value.context?.code,
  };
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice] ${message}`, details ?? {});
}

function installWebRtcDiagnostics() {
  if (process.env.NODE_ENV !== "development") return;
  if (window.__zeyaVoiceDiagnosticsInstalled) return;
  window.__zeyaVoiceDiagnosticsInstalled = true;
  window.__zeyaPeerConnections = [];
  window.__zeyaMediaStreams = [];
  window.__zeyaDataChannels = [];
  window.__zeyaWebSockets = [];

  void import("livekit-client")
    .then(({ LogLevel, setLogLevel }) => {
      setLogLevel(LogLevel.debug);
      devLog("livekit debug logging enabled");
    })
    .catch((error: unknown) => {
      devLog("livekit debug logging unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  const NativeRTCPeerConnection = window.RTCPeerConnection;
  if (NativeRTCPeerConnection) {
    window.RTCPeerConnection = class ZeyaRTCPeerConnection extends NativeRTCPeerConnection {
      private readonly zeyaPeerConnectionId: string;

      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        const id = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.zeyaPeerConnectionId = id;
        window.__zeyaPeerConnections?.push({ id, pc: this });

        devLog("rtc peer connection created", {
          id,
          connectionState: this.connectionState,
          iceConnectionState: this.iceConnectionState,
          iceGatheringState: this.iceGatheringState,
          signalingState: this.signalingState,
        });

        this.addEventListener("connectionstatechange", () => {
          devLog("rtc connection state", { id, state: this.connectionState });
        });
        this.addEventListener("iceconnectionstatechange", () => {
          devLog("rtc ice connection state", { id, state: this.iceConnectionState });
        });
        this.addEventListener("icegatheringstatechange", () => {
          devLog("rtc ice gathering state", { id, state: this.iceGatheringState });
        });
        this.addEventListener("signalingstatechange", () => {
          devLog("rtc signaling state", { id, state: this.signalingState });
        });
        this.addEventListener("track", (event) => {
          devLog("rtc remote track", {
            id,
            kind: event.track.kind,
            readyState: event.track.readyState,
            streamIds: event.streams.map((stream) => stream.id),
          });
        });
        this.addEventListener("datachannel", (event) => {
          observeDataChannel(id, event.channel, "remote");
        });
      }

      createDataChannel(
        label: string,
        options?: RTCDataChannelInit,
      ): RTCDataChannel {
        const channel = super.createDataChannel(label, options);
        observeDataChannel(this.zeyaPeerConnectionId, channel, "local");
        return channel;
      }
    };
  }

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    window.WebSocket = class ZeyaWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const urlString = String(url);
        const observed: ObservedWebSocket = { id, url: urlString, socket: this };
        window.__zeyaWebSockets?.push(observed);

        devLog("websocket created", { id, url: sanitizeUrl(urlString), protocols });
        this.addEventListener("open", () => {
          devLog("websocket open", { id, url: sanitizeUrl(urlString) });
        });
        this.addEventListener("error", (event) => {
          devLog("websocket error", {
            id,
            url: sanitizeUrl(urlString),
            type: event.type,
            readyState: this.readyState,
          });
        });
        this.addEventListener("close", (event) => {
          observed.lastClose = {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          };
          devLog("websocket close", {
            id,
            url: sanitizeUrl(urlString),
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
        });
      }
    };
  }

  if (navigator.mediaDevices?.getUserMedia) {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      devLog("getUserMedia requested", { constraints });
      const stream = await nativeGetUserMedia(constraints);
      window.__zeyaMediaStreams?.push({ id: stream.id, stream });
      devLog("getUserMedia resolved", {
        streamId: stream.id,
        audioTracks: stream.getAudioTracks().map((track) => ({
          id: track.id,
          label: track.label,
          readyState: track.readyState,
          enabled: track.enabled,
          muted: track.muted,
        })),
      });
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          devLog("media track ended", { streamId: stream.id, trackId: track.id });
        });
        track.addEventListener("mute", () => {
          devLog("media track muted", { streamId: stream.id, trackId: track.id });
        });
        track.addEventListener("unmute", () => {
          devLog("media track unmuted", { streamId: stream.id, trackId: track.id });
        });
      });
      return stream;
    };
  }
}

function sanitizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

function observeDataChannel(peerConnectionId: string, channel: RTCDataChannel, origin: "local" | "remote") {
  const id = `${peerConnectionId}:dc-${channel.label || "unlabeled"}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  window.__zeyaDataChannels?.push({ id, label: channel.label, channel });

  devLog("datachannel created", {
    id,
    origin,
    label: channel.label,
    ordered: channel.ordered,
    protocol: channel.protocol,
    readyState: channel.readyState,
  });
  channel.addEventListener("open", () => {
    devLog("datachannel open", { id, label: channel.label, readyState: channel.readyState });
  });
  channel.addEventListener("error", (event) => {
    devLog("datachannel error", {
      id,
      label: channel.label,
      readyState: channel.readyState,
      type: event.type,
    });
  });
  channel.addEventListener("close", () => {
    devLog("datachannel close", { id, label: channel.label, readyState: channel.readyState });
  });
}

function normalizeStatus(status: unknown): VoiceConnectionStatus | undefined {
  if (typeof status === "string") {
    return status === "connected" || status === "connecting" || status === "disconnected"
      ? status
      : undefined;
  }

  const next = (status as ElevenLabsStatusChange | undefined)?.status;
  return next === "connected" || next === "connecting" || next === "disconnected"
    ? next
    : undefined;
}

function normalizeMode(mode: unknown): VoiceConversationMode | undefined {
  if (typeof mode === "string") {
    return mode === "speaking" || mode === "listening" ? mode : undefined;
  }

  const next = (mode as ElevenLabsModeChange | undefined)?.mode;
  return next === "speaking" || next === "listening" ? next : undefined;
}

function normalizeTranscript(message: ElevenLabsMessage): VoiceTranscriptEntry | undefined {
  const text = message.message ?? message.text;
  if (!text) return undefined;

  const role = message.source === "ai" || message.role === "agent" ? "agent" : "user";

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text,
    isFinal: message.isFinal ?? true,
    createdAt: Date.now(),
  };
}

export async function requestMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

async function readMicrophonePermission(): Promise<PermissionState | "unsupported"> {
  if (!navigator.permissions?.query) return "unsupported";

  try {
    const permission = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return permission.state;
  } catch {
    return "unsupported";
  }
}

async function resolveConversationToken() {
  const response = await fetch("/api/elevenlabs/conversation-token", {
    method: "GET",
    cache: "no-store",
  });

  const data = (await response.json()) as ConversationTokenResponse;

  if (!response.ok) {
    throw new Error(data.error ?? "Unable to prepare ElevenLabs WebRTC connection.");
  }

  if (!data.conversationToken) {
    throw new Error("ElevenLabs conversation token response was empty.");
  }

  return data.conversationToken;
}

async function resolveSignedUrl() {
  const response = await fetch("/api/elevenlabs/signed-url", {
    method: "GET",
    cache: "no-store",
  });

  const data = (await response.json()) as SignedUrlResponse;

  if (!response.ok) {
    throw new Error(data.error ?? "Unable to prepare ElevenLabs WebSocket connection.");
  }

  if (!data.signedUrl) {
    throw new Error("ElevenLabs signed URL response was empty.");
  }

  return data.signedUrl;
}

function getBrowserAudioContextState(
  conversation: ElevenLabsConversation,
): VoiceRuntimeDiagnostics["browserAudioContextState"] {
  const conversationInternals = conversation as ElevenLabsConversation & {
    connection?: {
      audioAdapter?: {
        inputAudioContext?: AudioContext | null;
        audioCaptureContext?: AudioContext | null;
      };
    };
  };
  const inputState = conversationInternals.connection?.audioAdapter?.inputAudioContext?.state;
  const captureState = conversationInternals.connection?.audioAdapter?.audioCaptureContext?.state;
  const contexts = Array.from(document.querySelectorAll("audio"))
    .map((audioElement) => ({
      paused: audioElement.paused,
      readyState: audioElement.readyState,
      muted: audioElement.muted,
      volume: audioElement.volume,
    }))
    .slice(0, 5);

  devLog("browser audio state", {
    inputAudioContextState: inputState,
    audioCaptureContextState: captureState,
    audioElements: contexts,
  });

  return inputState ?? captureState ?? "unavailable";
}

function getInternalConnection(conversation: ElevenLabsConversation) {
  return (conversation as ElevenLabsConversation & {
    connection?: {
      getRoom?: () => {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        state?: string;
        name?: string;
        remoteParticipants?: Map<string, { identity?: string; sid?: string }>;
        localParticipant?: {
          identity?: string;
          sid?: string;
          audioTrackPublications?: Map<
            string,
            {
              track?: {
                sid?: string;
                isMuted?: boolean;
                mediaStreamTrack?: MediaStreamTrack;
              };
            }
          >;
        };
      };
      audioAdapter?: {
        inputAudioContext?: AudioContext | null;
        audioCaptureContext?: AudioContext | null;
      };
    };
  }).connection;
}

function getInternalRoom(conversation: ElevenLabsConversation) {
  return getInternalConnection(conversation)?.getRoom?.();
}

function getLatestPeerConnection() {
  const peerConnections = window.__zeyaPeerConnections ?? [];
  return peerConnections.at(-1)?.pc;
}

function getMediaStreamDiagnostics() {
  const streams = window.__zeyaMediaStreams ?? [];
  return {
    localStreamCount: streams.length,
    localStreamTrackStates: streams.flatMap(({ stream }) =>
      stream.getAudioTracks().map((track) =>
        [
          track.readyState,
          track.enabled ? "enabled" : "disabled",
          track.muted ? "muted" : "unmuted",
        ].join("/"),
      ),
    ),
  };
}

function getChannelDiagnostics() {
  return {
    dataChannelStates: (window.__zeyaDataChannels ?? []).map(
      ({ label, channel }) => `${label || "unlabeled"}:${channel.readyState}`,
    ),
    websocketStates: (window.__zeyaWebSockets ?? []).map(({ url, socket, lastClose }) => {
      const close = lastClose
        ? ` close=${lastClose.code}/${lastClose.wasClean ? "clean" : "dirty"}`
        : "";
      return `${sanitizeUrl(url)}:${socket.readyState}${close}`;
    }),
  };
}

function collectRuntimeDiagnostics(
  conversation: ElevenLabsConversation,
  transport: VoiceRuntimeDiagnostics["transport"],
): VoiceRuntimeDiagnostics {
  const room = getInternalRoom(conversation);
  const peerConnection = getLatestPeerConnection();
  const mediaStreamDiagnostics = getMediaStreamDiagnostics();
  const channelDiagnostics = getChannelDiagnostics();
  const localTracks = room?.localParticipant?.audioTrackPublications
    ? [...room.localParticipant.audioTrackPublications.values()]
    : [];
  const remoteParticipants = room?.remoteParticipants ? [...room.remoteParticipants.values()] : [];

  const diagnostics: VoiceRuntimeDiagnostics = {
    transport,
    sessionOpen: typeof conversation.isOpen === "function" ? conversation.isOpen() : undefined,
    browserAudioContextState: getBrowserAudioContextState(conversation),
    liveKitRoomState: typeof room?.state === "string" ? room.state : undefined,
    liveKitRoomName: typeof room?.name === "string" ? room.name : undefined,
    roomConnected: room?.state === "connected",
    localMicTracks: localTracks.length,
    activeLocalMicTracks: localTracks.filter(
      (publication) =>
        publication.track?.mediaStreamTrack?.readyState === "live" &&
        publication.track.mediaStreamTrack.enabled,
    ).length,
    localTrackStates: localTracks.map((publication) =>
      [
        publication.track?.mediaStreamTrack?.readyState ?? "missing",
        publication.track?.mediaStreamTrack?.enabled ? "enabled" : "disabled",
        publication.track?.mediaStreamTrack?.muted ? "muted" : "unmuted",
      ].join("/"),
    ),
    localTrackMutedStates: localTracks.map((publication) =>
      publication.track?.isMuted ? "muted" : "unmuted",
    ),
    remoteParticipants: remoteParticipants.length,
    agentParticipants: remoteParticipants.filter((participant) =>
      participant.identity?.startsWith("agent"),
    ).length,
    participantIds: [
      room?.localParticipant?.identity ? `local:${room.localParticipant.identity}` : undefined,
      ...remoteParticipants.map((participant) => participant.identity ?? participant.sid),
    ].filter(Boolean) as string[],
    peerConnectionCount: window.__zeyaPeerConnections?.length ?? 0,
    peerConnectionState: peerConnection?.connectionState,
    iceConnectionState: peerConnection?.iceConnectionState,
    iceGatheringState: peerConnection?.iceGatheringState,
    signalingState: peerConnection?.signalingState,
    ...channelDiagnostics,
    ...mediaStreamDiagnostics,
    lastUpdatedAt: Date.now(),
  };

  if (typeof conversation.getInputVolume === "function") {
    diagnostics.inputVolume = conversation.getInputVolume();
  }

  if (typeof conversation.getOutputVolume === "function") {
    diagnostics.outputVolume = conversation.getOutputVolume();
  }

  return diagnostics;
}

function attachRoomDiagnostics(conversation: ElevenLabsConversation) {
  const room = getInternalRoom(conversation);
  if (!room?.on) return;

  devLog("livekit room diagnostics attached", {
    roomName: room.name,
    roomState: room.state,
  });

  const logRoomEvent = (event: string) => (...args: unknown[]) => {
    devLog(`livekit ${event}`, {
      roomState: room.state,
      args: args.map((arg) => {
        if (!arg || typeof arg !== "object") return arg;
        const value = arg as {
          identity?: string;
          sid?: string;
          kind?: string;
          source?: string;
          message?: string;
          name?: string;
          reason?: string;
          toString?: () => string;
        };
        return {
          identity: value.identity,
          sid: value.sid,
          kind: value.kind,
          source: value.source,
          name: value.name,
          reason: value.reason,
          string: typeof value.toString === "function" ? value.toString() : undefined,
          message: value.message,
        };
      }),
    });
  };

  [
    "connected",
    "signalConnected",
    "connectionStateChanged",
    "reconnecting",
    "reconnected",
    "disconnected",
    "participantConnected",
    "participantDisconnected",
    "localTrackPublished",
    "localTrackUnpublished",
    "trackSubscribed",
    "trackSubscriptionFailed",
    "trackUnsubscribed",
    "mediaDevicesError",
    "audioPlaybackChanged",
    "activeSpeakersChanged",
    "dataReceived",
  ].forEach((event) => room.on?.(event, logRoomEvent(event)));
}

export async function createElevenLabsSession(
  options: VoiceServiceOptions,
  events: ElevenLabsSessionEvents,
  transport: ElevenLabsTransport = "webrtc",
): Promise<ElevenLabsVoiceSession> {
  installWebRtcDiagnostics();

  const initialMicPermission = await readMicrophonePermission();
  events.onMicPermissionChange?.(initialMicPermission);
  devLog("mic permission before start", { status: initialMicPermission });

  const transportOptions: PartialOptions =
    transport === "webrtc"
      ? { conversationToken: await resolveConversationToken() }
      : { signedUrl: await resolveSignedUrl() };
  devLog("connection credential resolved", {
    mode: transport === "webrtc" ? "conversation-token" : "signed-url",
    hasAgentId: Boolean(options.agentId),
  });

  devLog("session start requested", { transport });
  const conversation: ElevenLabsConversation = await Conversation.startSession({
    ...transportOptions,
    userId: options.userId,
    onConversationCreated: (nextConversation) => {
      devLog("conversation object created", {
        conversationId:
          typeof nextConversation.getId === "function" ? nextConversation.getId() : undefined,
      });
      attachRoomDiagnostics(nextConversation);
    },
    onConnect: ({ conversationId }: { conversationId: string }) => {
      devLog("session connected", { conversationId });
      events.onConnect?.(conversationId);
    },
    onDisconnect: (details: unknown) => {
      const disconnectDetails = normalizeDisconnect(details);
      devLog("session disconnected", disconnectDetails);
      events.onDisconnect?.(disconnectDetails);
    },
    onError: (error: unknown) => {
      const normalized = normalizeError(error);
      devLog("session error", { message: normalized.message });
      events.onError?.(normalized);
    },
    onStatusChange: (status: unknown) => {
      const nextStatus = normalizeStatus(status);
      if (nextStatus) {
        devLog("session status", { status: nextStatus });
        events.onStatusChange?.(nextStatus);
      }
    },
    onModeChange: (mode: unknown) => {
      const nextMode = normalizeMode(mode);
      if (nextMode) {
        devLog("session mode", { mode: nextMode });
        events.onModeChange?.(nextMode);
      }
    },
    onMessage: (message: ElevenLabsMessage) => {
      const entry = normalizeTranscript(message);
      if (entry) {
        devLog("session transcript", {
          role: entry.role,
          isFinal: entry.isFinal,
          length: entry.text.length,
        });
        events.onTranscript?.(entry);
      }
    },
    onDebug: (details: unknown) => {
      devLog("session debug", { details });
    },
  });

  const id = typeof conversation.getId === "function" ? conversation.getId() : undefined;
  const permissionAfterStart = await readMicrophonePermission();
  events.onMicPermissionChange?.(permissionAfterStart);
  devLog("mic permission after start", { status: permissionAfterStart });

  return {
    id,
    isOpen: () => (typeof conversation.isOpen === "function" ? conversation.isOpen() : true),
    getRuntimeDiagnostics: () => {
      const diagnostics = collectRuntimeDiagnostics(conversation, transport);
      events.onRuntimeDiagnostics?.(diagnostics);
      return diagnostics;
    },
    sendTextMessage: async (message: string) => {
      conversation.sendUserMessage(message);
    },
    end: async () => {
      await conversation.endSession();
    },
  };
}
