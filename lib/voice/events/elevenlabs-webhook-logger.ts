// Webhook logging — development debugging without logging sensitive data

import type { CapturedElevenLabsConversation } from "./elevenlabs-conversation-store";

export interface WebhookLogEntry {
  conversationId: string;
  eventType: string;
  status: "done" | "failed";
  callDurationSeconds?: number;
  transcriptSegmentCount: number;
  summaryLength: number;
  extractedDataKeys: string[];
  receivedAt: string;
  timestamp: string;
}

export function logWebhookReceived(
  conversation: CapturedElevenLabsConversation
): WebhookLogEntry {
  const entry: WebhookLogEntry = {
    conversationId: conversation.conversationId,
    eventType: "post_call_transcription",
    status: conversation.status,
    callDurationSeconds: conversation.callDuration,
    transcriptSegmentCount: conversation.transcript.length,
    summaryLength: conversation.summary?.length ?? 0,
    extractedDataKeys: conversation.extractedData ? Object.keys(conversation.extractedData) : [],
    receivedAt: conversation.receivedAt,
    timestamp: new Date(conversation.eventTimestamp * 1000).toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    console.log("[webhook] Conversation received:", {
      conversationId: entry.conversationId,
      duration: entry.callDurationSeconds,
      segments: entry.transcriptSegmentCount,
      status: entry.status,
      receivedAt: entry.receivedAt,
    });
  }

  return entry;
}

export function logWebhookDuplicate(conversationId: string): void {
  if (process.env.NODE_ENV === "development") {
    console.log("[webhook] Duplicate detected:", { conversationId });
  }
}

export function logWebhookError(error: string, conversationId?: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn("[webhook] Error:", { error, conversationId });
  }
}

export function logSignatureVerificationFailed(conversationId?: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn("[webhook] Signature verification failed:", { conversationId });
  }
}

export function logValidationFailed(reason: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn("[webhook] Validation failed:", { reason });
  }
}
