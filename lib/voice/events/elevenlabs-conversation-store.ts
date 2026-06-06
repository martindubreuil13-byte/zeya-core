// In-memory conversation store — captures complete post-call webhook data

import type { ElevenLabsPostCallTranscriptionData, ElevenLabsTranscriptSegment } from "./elevenlabs-event-types";

export interface CapturedElevenLabsConversation {
  conversationId: string;
  agentId: string;
  status: "done" | "failed";
  transcript: ElevenLabsTranscriptSegment[];
  summary?: string;
  callDuration?: number;
  extractedData?: Record<string, unknown>;
  hasAudio?: boolean;
  hasUserAudio?: boolean;
  hasResponseAudio?: boolean;
  userId?: string;
  agentName?: string;
  metadata?: Record<string, unknown>;
  eventTimestamp: number;
  receivedAt: string;
  rawPayload?: Record<string, unknown>;
}

class ConversationStore {
  private conversations: Map<string, CapturedElevenLabsConversation> = new Map();

  saveConversation(
    conversationId: string,
    agentId: string,
    data: ElevenLabsPostCallTranscriptionData,
    eventTimestamp: number,
    rawPayload?: Record<string, unknown>
  ): CapturedElevenLabsConversation {
    const conversation: CapturedElevenLabsConversation = {
      conversationId,
      agentId,
      status: data.status,
      transcript: data.transcript,
      summary: data.summary,
      callDuration: data.call_duration,
      extractedData: data.extracted_data,
      hasAudio: data.has_audio,
      hasUserAudio: data.has_user_audio,
      hasResponseAudio: data.has_response_audio,
      userId: data.user_id,
      agentName: data.agent_name,
      metadata: data.metadata,
      eventTimestamp,
      receivedAt: new Date().toISOString(),
      rawPayload,
    };

    this.conversations.set(conversationId, conversation);
    return conversation;
  }

  getConversation(conversationId: string): CapturedElevenLabsConversation | null {
    return this.conversations.get(conversationId) ?? null;
  }

  hasConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  getAllConversations(): CapturedElevenLabsConversation[] {
    return Array.from(this.conversations.values());
  }

  getConversationsSince(seconds: number): CapturedElevenLabsConversation[] {
    const cutoff = Date.now() / 1000 - seconds;
    return this.getAllConversations().filter((c) => c.eventTimestamp > cutoff);
  }

  getLatestConversation(): CapturedElevenLabsConversation | null {
    const conversations = this.getAllConversations();
    if (conversations.length === 0) return null;
    return conversations.reduce((latest, current) =>
      current.eventTimestamp > latest.eventTimestamp ? current : latest
    );
  }

  getConversationIdsSorted(): string[] {
    return this.getAllConversations()
      .sort((a, b) => b.eventTimestamp - a.eventTimestamp)
      .map((c) => c.conversationId);
  }

  clear(): void {
    this.conversations.clear();
  }
}

const conversationStore = new ConversationStore();

export { conversationStore, ConversationStore };
