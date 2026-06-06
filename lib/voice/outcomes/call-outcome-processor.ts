// CallOutcome processor — orchestrates conversation → outcome pipeline

import type { CapturedElevenLabsConversation } from "../events/elevenlabs-conversation-store";
import { detectOutcome } from "./call-outcome-builder";
import { outcomeStore } from "./call-outcome-store";
import type { CallOutcome } from "./call-outcome-types";
import { processCallOutcomeToMemoryEvent } from "../../memory/events/memory-event-processor";
import { persistOutcome } from "../persistence/persistence-manager";

/**
 * Generate a unique outcome ID
 */
function generateOutcomeId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `outcome_${timestamp}_${random}`;
}

/**
 * Build a CallOutcome from a completed conversation
 */
export function buildCallOutcomeFromConversation(
  conversation: CapturedElevenLabsConversation,
  workerBriefId: string | null = null
): CallOutcome {
  // Detect outcome using rules
  const detection = detectOutcome(conversation);

  // Build outcome object
  const outcome: CallOutcome = {
    outcomeId: generateOutcomeId(),
    conversationId: conversation.conversationId,
    workerBriefId: workerBriefId,
    status: conversation.status,
    outcome: detection.outcome,
    confidence: detection.confidence,
    summary: conversation.summary || "No summary provided",
    extractedData: conversation.extractedData,
    recommendedAction: detection.recommendedAction,
    callDuration: conversation.callDuration,
    transcriptLength: conversation.transcript.length,
    createdAt: new Date().toISOString(),
  };

  return outcome;
}

/**
 * Process and store a CallOutcome
 */
export async function processAndStoreOutcome(
  conversation: CapturedElevenLabsConversation,
  workerBriefId: string | null = null
): Promise<CallOutcome> {
  console.log("[outcome-processor] 🔵 Building CallOutcome from conversation", {
    conversationId: conversation.conversationId,
    workerBriefId,
  });

  // Build outcome
  const outcome = buildCallOutcomeFromConversation(conversation, workerBriefId);

  console.log("[outcome-processor] 🟢 CallOutcome built", {
    conversationId: conversation.conversationId,
    outcome: outcome.outcome,
    confidence: outcome.confidence,
  });

  // Store in memory
  console.log("[outcome-processor] 🔵 Storing outcome in memory");
  outcomeStore.saveOutcome(outcome);
  console.log("[outcome-processor] 🟢 Outcome stored in memory");

  // Persist outcome to Supabase (wait for completion)
  console.log("[outcome-processor] 🔵 Persisting outcome to Supabase");
  await persistOutcome(outcome);
  console.log("[outcome-processor] 🟢 Outcome persisted to Supabase");

  // Convert to memory event and persist
  console.log("[outcome-processor] 🔵 Creating and persisting memory event");
  await processCallOutcomeToMemoryEvent(outcome);
  console.log("[outcome-processor] 🟢 Memory event persisted");

  console.log("[outcome-processor] 🟢 Complete outcome processing pipeline finished", {
    conversationId: conversation.conversationId,
    outcome: outcome.outcome,
  });

  return outcome;
}

/**
 * Get outcome for a conversation
 */
export function getOutcomeByConversationId(conversationId: string): CallOutcome | null {
  return outcomeStore.getOutcomeByConversationId(conversationId);
}

/**
 * Get all outcomes
 */
export function getAllOutcomes(): CallOutcome[] {
  return outcomeStore.getAllOutcomes();
}

/**
 * Get outcomes by worker brief
 */
export function getOutcomesByWorkerBrief(workerBriefId: string): CallOutcome[] {
  return outcomeStore.getOutcomesByWorkerBrief(workerBriefId);
}

/**
 * Get outcome statistics
 */
export function getOutcomeStats() {
  const allOutcomes = outcomeStore.getAllOutcomes();
  const counts = outcomeStore.getOutcomeCounts();

  // Calculate average confidence by outcome type
  const confidenceByOutcome: Record<string, number[]> = {};
  for (const outcome of allOutcomes) {
    if (!confidenceByOutcome[outcome.outcome]) {
      confidenceByOutcome[outcome.outcome] = [];
    }
    confidenceByOutcome[outcome.outcome].push(outcome.confidence);
  }

  const avgConfidence: Record<string, number> = {};
  for (const [outcomeType, confidences] of Object.entries(confidenceByOutcome)) {
    avgConfidence[outcomeType] = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  // Calculate recommended actions
  const recommendedActionCounts: Record<string, number> = {};
  for (const outcome of allOutcomes) {
    recommendedActionCounts[outcome.recommendedAction] =
      (recommendedActionCounts[outcome.recommendedAction] ?? 0) + 1;
  }

  return {
    totalOutcomes: allOutcomes.length,
    outcomeDistribution: counts,
    averageConfidence: allOutcomes.length > 0
      ? allOutcomes.reduce((sum, o) => sum + o.confidence, 0) / allOutcomes.length
      : 0,
    confidenceByOutcome: avgConfidence,
    recommendedActions: recommendedActionCounts,
  };
}

/**
 * Clear all outcomes (for testing)
 */
export function clearAllOutcomes(): void {
  outcomeStore.clear();
  if (process.env.NODE_ENV === "development") {
    console.log("[outcome-processor] Cleared all outcomes");
  }
}
