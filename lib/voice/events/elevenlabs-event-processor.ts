// ElevenLabs event processor — handles post-call webhook data

import { isPostCallTranscriptionWebhook } from "./elevenlabs-event-validator";
import type { ElevenLabsPostCallTranscriptionWebhook } from "./elevenlabs-event-types";
import { conversationStore } from "./elevenlabs-conversation-store";
import { mappingStore } from "./conversation-brief-mapping";
import { processAndStoreOutcome } from "../outcomes/call-outcome-processor";

export interface ProcessedWebhookResult {
  success: boolean;
  type: string;
  conversationId: string;
  duplicate?: boolean;
  message: string;
}

// Simple deduplication: track conversation_id + event_timestamp
interface SeenWebhookKey {
  eventTimestamp: number;
  conversationId: string;
}

const seenWebhooks = new Set<string>();

function getWebhookKey(
  eventTimestamp: number,
  conversationId: string
): string {
  return `${eventTimestamp}:${conversationId}`;
}

function isDuplicate(
  eventTimestamp: number,
  conversationId: string
): boolean {
  const key = getWebhookKey(eventTimestamp, conversationId);
  return seenWebhooks.has(key);
}

function markAsSeen(
  eventTimestamp: number,
  conversationId: string
): void {
  const key = getWebhookKey(eventTimestamp, conversationId);
  seenWebhooks.add(key);
}

export function processElevenLabsWebhook(
  webhook: unknown,
  rawPayload?: Record<string, unknown>
): ProcessedWebhookResult {
  if (!isPostCallTranscriptionWebhook(webhook)) {
    return {
      success: false,
      type: "unknown",
      conversationId: "",
      message: "Invalid webhook structure or unsupported type",
    };
  }

  const webhook_typed = webhook as ElevenLabsPostCallTranscriptionWebhook;
  const conversationId = webhook_typed.data.conversation_id;
  const eventTimestamp = webhook_typed.event_timestamp;

  // Check for duplicates
  if (isDuplicate(eventTimestamp, conversationId)) {
    return {
      success: true,
      type: "post_call_transcription",
      conversationId,
      duplicate: true,
      message: `Duplicate webhook for conversation ${conversationId}`,
    };
  }

  try {
    // Save conversation to store
    const conversation = conversationStore.saveConversation(
      conversationId,
      webhook_typed.data.agent_id,
      webhook_typed.data,
      eventTimestamp,
      rawPayload
    );

    // Mark as seen
    markAsSeen(eventTimestamp, conversationId);

    // Generate CallOutcome from conversation
    const workerBriefId = mappingStore.getWorkerBriefId(conversationId);
    processAndStoreOutcome(conversation, workerBriefId);

    return {
      success: true,
      type: "post_call_transcription",
      conversationId,
      message: `Post-call webhook processed for conversation ${conversationId}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      type: "post_call_transcription",
      conversationId,
      message: `Failed to process post-call webhook: ${message}`,
    };
  }
}

export function getConversation(conversationId: string) {
  return conversationStore.getConversation(conversationId);
}

export function getAllConversations() {
  return conversationStore.getAllConversations();
}

export function clearAllState() {
  conversationStore.clear();
  seenWebhooks.clear();
}
