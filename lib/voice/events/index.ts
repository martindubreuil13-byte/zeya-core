// ElevenLabs events module — post-call webhook handling

// Event types
export type {
  ElevenLabsWebhook,
  ElevenLabsPostCallTranscriptionWebhook,
  ElevenLabsPostCallTranscriptionData,
  ElevenLabsTranscriptSegment,
} from "./elevenlabs-event-types";

// Event validation
export { isPostCallTranscriptionWebhook, isValidElevenLabsWebhook } from "./elevenlabs-event-validator";

// Conversation storage
export type { CapturedElevenLabsConversation } from "./elevenlabs-conversation-store";
export { conversationStore, ConversationStore } from "./elevenlabs-conversation-store";

// Event processing
export { processElevenLabsWebhook, getConversation, getAllConversations, clearAllState } from "./elevenlabs-event-processor";
export type { ProcessedWebhookResult } from "./elevenlabs-event-processor";

// Signature verification
export {
  verifyElevenLabsSignature,
  shouldVerifySignature,
  getWebhookSecret,
  logSignatureWarning,
} from "./elevenlabs-signature-verifier";

// Webhook logging
export { logWebhookReceived, logWebhookDuplicate, logWebhookError, logSignatureVerificationFailed, logValidationFailed } from "./elevenlabs-webhook-logger";
export type { WebhookLogEntry } from "./elevenlabs-webhook-logger";

// WorkerBrief correlation
export type { ConversationBriefMapping } from "./conversation-brief-mapping";
export { mappingStore, MappingStore } from "./conversation-brief-mapping";

// Conversation context resolution
export { getConversationContext, getConversationsByBrief } from "./conversation-context-resolver";
export type { ConversationContext } from "./conversation-context-resolver";

// Test utilities (development only)
export { registerConversationMapping, createTestConversationWithBrief, clearAllMappingsAndConversations } from "./conversation-brief-testing";
