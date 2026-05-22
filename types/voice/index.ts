export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "processing"
  | "disconnected"
  | "error";

export type VoiceProvider = "elevenlabs";

export type VoiceTranscriptRole = "user" | "agent" | "system";

export type VoiceTranscriptEntry = {
  id: string;
  role: VoiceTranscriptRole;
  text: string;
  isFinal: boolean;
  createdAt: number;
};

export type VoiceConnectionStatus = "disconnected" | "connecting" | "connected";

export type VoiceConversationMode = "listening" | "speaking";

export type VoiceDisconnectDetails = {
  reason?: string;
  message?: string;
  closeCode?: number;
  closeReason?: string;
  contextType?: string;
  contextReason?: string;
  contextCode?: number;
};

export type VoiceRuntimeDiagnostics = {
  transport?: "webrtc" | "websocket" | "public-agent";
  sessionOpen?: boolean;
  inputVolume?: number;
  outputVolume?: number;
  browserAudioContextState?: AudioContextState | "unavailable";
  liveKitRoomState?: string;
  liveKitRoomName?: string;
  roomConnected?: boolean;
  localMicTracks?: number;
  activeLocalMicTracks?: number;
  localTrackStates?: string[];
  localTrackMutedStates?: string[];
  remoteParticipants?: number;
  agentParticipants?: number;
  participantIds?: string[];
  peerConnectionCount?: number;
  peerConnectionState?: string;
  iceConnectionState?: string;
  iceGatheringState?: string;
  signalingState?: string;
  dataChannelStates?: string[];
  websocketStates?: string[];
  localStreamCount?: number;
  localStreamTrackStates?: string[];
  lastUpdatedAt?: number;
};

export type VoiceServiceSnapshot = {
  state: VoiceState;
  connectionStatus: VoiceConnectionStatus;
  transcript: VoiceTranscriptEntry[];
  conversationId?: string;
  error?: string;
  disconnectDetails?: VoiceDisconnectDetails;
  diagnostics?: VoiceRuntimeDiagnostics;
};

export type VoiceStateListener = (snapshot: VoiceServiceSnapshot) => void;

export type VoiceServiceOptions = {
  agentId: string;
  provider?: VoiceProvider;
  userId?: string;
  diagnosticFallbackToWebSocket?: boolean;
};

export type VoiceService = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  startConversation: () => Promise<void>;
  stopConversation: () => Promise<void>;
  sendTextMessage: (message: string) => Promise<void>;
  receiveTranscript: (listener: VoiceStateListener) => () => void;
  onStateChange: (listener: VoiceStateListener) => () => void;
  getSnapshot: () => VoiceServiceSnapshot;
};
