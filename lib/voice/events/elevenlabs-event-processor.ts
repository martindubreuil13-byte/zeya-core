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
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
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

export async function processElevenLabsWebhook(
  webhook: unknown,
  rawPayload?: Record<string, unknown>,
  workerBriefId?: string
): Promise<ProcessedWebhookResult> {
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

  // Extract workerBriefId from webhook's user_id field if not provided as parameter
  // ElevenLabs returns user_id in webhook if it was passed during conversation init
  if (!workerBriefId && webhook_typed.data.user_id) {
    workerBriefId = webhook_typed.data.user_id;
    console.log("[event-processor] 🟢 Found workerBriefId in webhook user_id field", { workerBriefId });
  }

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
    console.log("[event-processor] 🔵 Saving conversation to in-memory store", { conversationId });

    // Save conversation to store
    const conversation = conversationStore.saveConversation(
      conversationId,
      webhook_typed.data.agent_id,
      webhook_typed.data,
      eventTimestamp,
      rawPayload
    );

    console.log("[event-processor] 🟢 Conversation saved to in-memory store", { conversationId });

    // Mark as seen
    markAsSeen(eventTimestamp, conversationId);

    // Generate CallOutcome from conversation
    console.log("[event-processor] 🔵 Generating CallOutcome from conversation", { conversationId });

    // Try to get mapping by conversationId first
    let resolvedWorkerBriefId = mappingStore.getWorkerBriefId(conversationId);
    let businessId = mappingStore.getBusinessId(conversationId);
    let missionId = mappingStore.getMissionId(conversationId);

    // If workerBriefId provided in request, try to resolve by that
    if (workerBriefId && !businessId) {
      const briefinessId = mappingStore.getBusinessIdByWorkerBriefId(workerBriefId);
      const briefMissionId = mappingStore.getConversationId(workerBriefId)
        ? mappingStore.getMissionId(mappingStore.getConversationId(workerBriefId) || "")
        : null;

      if (briefinessId) {
        resolvedWorkerBriefId = workerBriefId;
        businessId = briefinessId;
        missionId = briefMissionId;

        // Register new mapping with real conversationId using data from provisional mapping
        if (briefMissionId) {
          mappingStore.createMapping(conversationId, workerBriefId, briefMissionId, briefinessId);
          console.log("[event-processor] 🟢 Updated mapping with real conversationId", {
            conversationId,
            workerBriefId,
            businessId,
            missionId: briefMissionId,
          });
        }
      }
    }

    console.log("[event-processor] 🔵 Retrieved context from mapping", {
      conversationId,
      workerBriefId: resolvedWorkerBriefId,
      businessId,
      missionId,
    });

    await processAndStoreOutcome(conversation, resolvedWorkerBriefId, businessId);

    console.log("[event-processor] 🟢 CallOutcome and MemoryEvent persisted successfully", {
      conversationId,
      workerBriefId: resolvedWorkerBriefId,
    });

    return {
      success: true,
      type: "post_call_transcription",
      conversationId,
      message: `Post-call webhook processed for conversation ${conversationId}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = (error as any)?.code;
    const details = (error as any)?.details;

    console.error("[event-processor] 🔴 Failed to process webhook", {
      conversationId,
      error: message,
      code,
      details,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      type: "post_call_transcription",
      conversationId,
      message: `Failed to process post-call webhook: ${message}`,
      error: {
        code: code || "UNKNOWN",
        message,
        details,
      },
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
