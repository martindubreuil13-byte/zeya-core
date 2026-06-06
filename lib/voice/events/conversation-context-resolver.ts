// Conversation context resolver — retrieves conversation with linked brief

import type { CapturedElevenLabsConversation } from "./elevenlabs-conversation-store";
import { conversationStore } from "./elevenlabs-conversation-store";
import { mappingStore } from "./conversation-brief-mapping";

export interface ConversationContext {
  conversation: CapturedElevenLabsConversation;
  workerBriefId: string | null;
  mappingExists: boolean;
}

export function getConversationContext(
  conversationId: string
): ConversationContext | null {
  const conversation = conversationStore.getConversation(conversationId);

  if (!conversation) {
    return null;
  }

  const workerBriefId = mappingStore.getWorkerBriefId(conversationId);

  return {
    conversation,
    workerBriefId,
    mappingExists: workerBriefId !== null,
  };
}

export function getConversationsByBrief(
  workerBriefId: string
): ConversationContext | null {
  const conversationId = mappingStore.getConversationId(workerBriefId);

  if (!conversationId) {
    return null;
  }

  return getConversationContext(conversationId);
}
