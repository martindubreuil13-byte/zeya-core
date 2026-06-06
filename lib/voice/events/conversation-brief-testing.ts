// Test utilities for conversation-brief mapping — development/testing only

import { mappingStore } from "./conversation-brief-mapping";
import { conversationStore } from "./elevenlabs-conversation-store";
import type { CapturedElevenLabsConversation } from "./elevenlabs-conversation-store";
import type { ElevenLabsPostCallTranscriptionData } from "./elevenlabs-event-types";

/**
 * Test utility: Register a conversation-brief mapping
 * Used for testing scenario where we simulate an outbound call before webhook arrives
 */
export function registerConversationMapping(
  conversationId: string,
  workerBriefId: string,
  missionId: string,
  businessId: string
): void {
  mappingStore.createMapping(conversationId, workerBriefId, missionId, businessId);

  if (process.env.NODE_ENV === "development") {
    console.log("[test] Registered mapping:", {
      conversationId,
      workerBriefId,
      missionId,
      businessId,
    });
  }
}

/**
 * Test utility: Create a complete conversation with brief mapping
 * Simulates: WorkerBrief → Call → Conversation → Webhook
 */
export function createTestConversationWithBrief(
  workerBriefId: string,
  missionId: string,
  businessId: string,
  conversationOverrides?: Partial<ElevenLabsPostCallTranscriptionData>
): CapturedElevenLabsConversation {
  const now = Date.now() / 1000;
  const conversationId = `conv_test_${workerBriefId}_${Date.now()}`;

  const defaultData: ElevenLabsPostCallTranscriptionData = {
    conversation_id: conversationId,
    agent_id: "agent_test",
    status: "done",
    transcript: [
      { role: "agent", message: "Hi there" },
      { role: "user", message: "Hello" },
    ],
    summary: "Test conversation",
    call_duration: 60,
  };

  const data = { ...defaultData, ...conversationOverrides };

  // Create conversation in store
  const conversation = conversationStore.saveConversation(
    conversationId,
    data.agent_id,
    data,
    now
  );

  // Register mapping with business context
  mappingStore.createMapping(conversationId, workerBriefId, missionId, businessId);

  if (process.env.NODE_ENV === "development") {
    console.log("[test] Created test conversation:", {
      conversationId,
      workerBriefId,
      missionId,
      businessId,
      duration: data.call_duration,
    });
  }

  return conversation;
}

/**
 * Test utility: Clear all mappings and conversations
 * Used between tests to ensure clean state
 */
export function clearAllMappingsAndConversations(): void {
  mappingStore.clear();
  conversationStore.clear();

  if (process.env.NODE_ENV === "development") {
    console.log("[test] Cleared all mappings and conversations");
  }
}
