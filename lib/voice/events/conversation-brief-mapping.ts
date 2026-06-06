// WorkerBrief ↔ Conversation mapping — tracks which conversation belongs to which brief

export interface ConversationBriefMapping {
  conversationId: string;
  workerBriefId: string;
  createdAt: string;
}

class MappingStore {
  // conversation_id -> worker_brief_id
  private conversationToBrief: Map<string, string> = new Map();
  // worker_brief_id -> conversation_id
  private briefToConversation: Map<string, string> = new Map();
  // metadata for debugging
  private mappings: Map<string, ConversationBriefMapping> = new Map();

  createMapping(
    conversationId: string,
    workerBriefId: string
  ): ConversationBriefMapping {
    const mapping: ConversationBriefMapping = {
      conversationId,
      workerBriefId,
      createdAt: new Date().toISOString(),
    };

    this.conversationToBrief.set(conversationId, workerBriefId);
    this.briefToConversation.set(workerBriefId, conversationId);
    this.mappings.set(conversationId, mapping);

    return mapping;
  }

  getWorkerBriefId(conversationId: string): string | null {
    return this.conversationToBrief.get(conversationId) ?? null;
  }

  getConversationId(workerBriefId: string): string | null {
    return this.briefToConversation.get(workerBriefId) ?? null;
  }

  hasMapping(conversationId: string): boolean {
    return this.conversationToBrief.has(conversationId);
  }

  getMapping(conversationId: string): ConversationBriefMapping | null {
    return this.mappings.get(conversationId) ?? null;
  }

  getAllMappings(): ConversationBriefMapping[] {
    return Array.from(this.mappings.values());
  }

  removeMappingByConversation(conversationId: string): boolean {
    const workerBriefId = this.conversationToBrief.get(conversationId);
    if (!workerBriefId) return false;

    this.conversationToBrief.delete(conversationId);
    this.briefToConversation.delete(workerBriefId);
    this.mappings.delete(conversationId);

    return true;
  }

  removeMappingByBrief(workerBriefId: string): boolean {
    const conversationId = this.briefToConversation.get(workerBriefId);
    if (!conversationId) return false;

    this.conversationToBrief.delete(conversationId);
    this.briefToConversation.delete(workerBriefId);
    this.mappings.delete(conversationId);

    return true;
  }

  clear(): void {
    this.conversationToBrief.clear();
    this.briefToConversation.clear();
    this.mappings.clear();
  }
}

const mappingStore = new MappingStore();

export { mappingStore, MappingStore };
