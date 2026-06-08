export type ProviderType = "MOCK" | "TWILIO" | "ELEVENLABS";

export type ProviderDispatchStatus = "SIMULATED" | "DISPATCHED" | "FAILED";

export interface ProviderDispatchRequest {
  workerBriefId: string;
  missionId: string;
  targetName: string | null;
  targetPhone: string | null;
  objective: string;
  dynamicVariables: Record<string, string | number | boolean | null>;
}

export interface ProviderDispatchResult {
  providerType: ProviderType;
  providerCallId: string;
  status: ProviderDispatchStatus;
  message: string;
  createdAt: string;
  conversationId?: string; // ElevenLabs conversation ID for webhook routing
}

export interface ProviderWebhookEvent {
  providerType: ProviderType;
  providerCallId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
