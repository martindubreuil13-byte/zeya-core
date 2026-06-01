// V1 Channel registry — defines all 7 channels and their capabilities

import type { ExecutionChannel, ExecutionChannelType } from "./execution-types";

// ─── V1 Enabled Channels ────────────────────────────────────────────────────

const VOICE_CHANNEL: ExecutionChannel = {
  type: "VOICE",
  enabled: true,
  supportsVoice: true,
  supportsConversation: true,
  supportsOutbound: true,
  supportsInbound: true,
  description: "AI voice conversation channel (ElevenLabs / OpenAI Realtime)",
};

const PHONE_CHANNEL: ExecutionChannel = {
  type: "PHONE",
  enabled: true,
  supportsVoice: true,
  supportsConversation: true,
  supportsOutbound: true,
  supportsInbound: false,
  description: "Outbound phone call channel (Twilio)",
};

// ─── Future-Ready Channels (V1 Disabled) ──────────────────────────────────

const EMAIL_CHANNEL: ExecutionChannel = {
  type: "EMAIL",
  enabled: false,
  supportsVoice: false,
  supportsConversation: false,
  supportsOutbound: true,
  supportsInbound: false,
  description: "Email channel (SMTP / SendGrid) — future",
};

const SMS_CHANNEL: ExecutionChannel = {
  type: "SMS",
  enabled: false,
  supportsVoice: false,
  supportsConversation: false,
  supportsOutbound: true,
  supportsInbound: true,
  description: "SMS channel (Twilio SMS) — future",
};

const WHATSAPP_CHANNEL: ExecutionChannel = {
  type: "WHATSAPP",
  enabled: false,
  supportsVoice: true,
  supportsConversation: true,
  supportsOutbound: true,
  supportsInbound: true,
  description: "WhatsApp channel (Twilio WhatsApp) — future",
};

const LINKEDIN_CHANNEL: ExecutionChannel = {
  type: "LINKEDIN",
  enabled: false,
  supportsVoice: false,
  supportsConversation: false,
  supportsOutbound: true,
  supportsInbound: false,
  description: "LinkedIn outreach channel — future",
};

const CUSTOM_CHANNEL: ExecutionChannel = {
  type: "CUSTOM",
  enabled: false,
  supportsVoice: false,
  supportsConversation: false,
  supportsOutbound: true,
  supportsInbound: false,
  description: "Custom integration channel — future",
};

// ─── Registry ───────────────────────────────────────────────────────────────

const CHANNEL_REGISTRY: Record<ExecutionChannelType, ExecutionChannel> = {
  VOICE: VOICE_CHANNEL,
  PHONE: PHONE_CHANNEL,
  EMAIL: EMAIL_CHANNEL,
  SMS: SMS_CHANNEL,
  WHATSAPP: WHATSAPP_CHANNEL,
  LINKEDIN: LINKEDIN_CHANNEL,
  CUSTOM: CUSTOM_CHANNEL,
};

export function getChannelRegistry(): Record<ExecutionChannelType, ExecutionChannel> {
  return CHANNEL_REGISTRY;
}

export function getChannel(type: ExecutionChannelType): ExecutionChannel {
  return CHANNEL_REGISTRY[type];
}

export function getEnabledChannels(): ExecutionChannel[] {
  return Object.values(CHANNEL_REGISTRY).filter((ch) => ch.enabled);
}
