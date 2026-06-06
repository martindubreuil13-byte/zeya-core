// WorkerBrief ↔ Conversation mapping — tracks which conversation belongs to which brief

export interface ConversationBriefMapping {
  conversationId: string;
  workerBriefId: string;
  missionId: string;
  businessId: string;
  createdAt: string;
}

class MappingStore {
  // conversation_id -> full mapping
  private conversationToMapping: Map<string, ConversationBriefMapping> = new Map();
  // worker_brief_id -> conversation_id
  private briefToConversation: Map<string, string> = new Map();

  createMapping(
    conversationId: string,
    workerBriefId: string,
    missionId: string,
    businessId: string
  ): ConversationBriefMapping {
    const mapping: ConversationBriefMapping = {
      conversationId,
      workerBriefId,
      missionId,
      businessId,
      createdAt: new Date().toISOString(),
    };

    this.conversationToMapping.set(conversationId, mapping);
    this.briefToConversation.set(workerBriefId, conversationId);

    return mapping;
  }

  getWorkerBriefId(conversationId: string): string | null {
    const mapping = this.conversationToMapping.get(conversationId);
    return mapping?.workerBriefId ?? null;
  }

  getBusinessId(conversationId: string): string | null {
    const mapping = this.conversationToMapping.get(conversationId);
    return mapping?.businessId ?? null;
  }

  getMissionId(conversationId: string): string | null {
    const mapping = this.conversationToMapping.get(conversationId);
    return mapping?.missionId ?? null;
  }

  getConversationId(workerBriefId: string): string | null {
    return this.briefToConversation.get(workerBriefId) ?? null;
  }

  getBusinessIdByWorkerBriefId(workerBriefId: string): string | null {
    const conversationId = this.briefToConversation.get(workerBriefId);
    if (!conversationId) return null;
    const mapping = this.conversationToMapping.get(conversationId);
    return mapping?.businessId ?? null;
  }

  hasMapping(conversationId: string): boolean {
    return this.conversationToMapping.has(conversationId);
  }

  getMapping(conversationId: string): ConversationBriefMapping | null {
    return this.conversationToMapping.get(conversationId) ?? null;
  }

  getAllMappings(): ConversationBriefMapping[] {
    return Array.from(this.conversationToMapping.values());
  }

  removeMappingByConversation(conversationId: string): boolean {
    const mapping = this.conversationToMapping.get(conversationId);
    if (!mapping) return false;

    this.conversationToMapping.delete(conversationId);
    this.briefToConversation.delete(mapping.workerBriefId);

    return true;
  }

  removeMappingByBrief(workerBriefId: string): boolean {
    const conversationId = this.briefToConversation.get(workerBriefId);
    if (!conversationId) return false;

    this.conversationToMapping.delete(conversationId);
    this.briefToConversation.delete(workerBriefId);

    return true;
  }

  clear(): void {
    this.conversationToMapping.clear();
    this.briefToConversation.clear();
  }
}

const mappingStore = new MappingStore();

export { mappingStore, MappingStore };
