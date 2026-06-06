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
