import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";

function generateMockCallId(): string {
  return `mock_call_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export class MockProvider implements WorkerProvider {
  async dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    const providerCallId = generateMockCallId();
    return {
      providerType: "MOCK",
      providerCallId,
      conversationId: `mock_conversation_${crypto.randomUUID()}`,
      status: "SIMULATED",
      message: `Mock dispatch accepted for brief ${request.workerBriefId}. Objective: ${request.objective}.`,
      createdAt: new Date().toISOString(),
    };
  }
}
