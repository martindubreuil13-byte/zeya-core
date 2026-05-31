// Conversation → Memory → Workflow Loop Integration
// Orchestrates the complete flow: response → extract → remember → refresh workflow

import type { BusinessState } from "./types";
import type { ExecutiveGuidance } from "./derive-executive-guidance";
import type { ConversationObjective } from "./conversation-objective-types";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";
import {
  processConversationResponse,
  type ConversationResponseInput,
  type ExtractionResult,
} from "./conversation-state-engine";
import {
  saveMemoryEvents,
  getMemoryContextForWorkflow,
  type MemoryEvent as PersistentMemoryEvent,
} from "@/lib/memory/memory-persistence";
import { deriveBusinessState } from "./derive-business-state";
import { buildBusinessStateInput, getFullBusinessContext } from "./build-business-state-from-db";
import { deriveExecutiveGuidance } from "./derive-executive-guidance";
import { determineNextConversationObjective } from "./determine-next-conversation-objective";

export interface ConversationLoopInput {
  supabase: any; // Supabase client
  businessId: string;
  businessState: BusinessState;
  executiveGuidance: ExecutiveGuidance;
  conversationObjective: ConversationObjective;
  founderResponse: string;
  previousProfile: Partial<BusinessMemory>;
}

export interface ConversationLoopResult {
  extractionResult: ExtractionResult;
  memoryPersisted: boolean;
  newBusinessState: BusinessState | null;
  newExecutiveGuidance: ExecutiveGuidance | null;
  newConversationObjective: ConversationObjective | null;
  errors: string[];
}

// ─── Main Orchestration Function ────────────────────────────────────────────

export async function processConversationLoop(
  input: ConversationLoopInput
): Promise<ConversationLoopResult> {
  const {
    supabase,
    businessId,
    businessState,
    executiveGuidance,
    conversationObjective,
    founderResponse,
    previousProfile,
  } = input;

  const errors: string[] = [];

  // ───────────────────────────────────────────────────────────────────────
  // PHASE 5: Extract facts from founder response
  // ───────────────────────────────────────────────────────────────────────

  const extractionResult = processConversationResponse(
    {
      businessState,
      executiveGuidance,
      conversationObjective,
      founderResponse,
    },
    previousProfile
  );

  // ───────────────────────────────────────────────────────────────────────
  // PHASE 6: Persist memory events and derive learnings
  // ───────────────────────────────────────────────────────────────────────

  let memoryPersisted = false;

  if (extractionResult.workflowNeedsRefresh) {
    try {
      // Convert extracted memory events to persistent memory events
      const memoryEventsToSave: Omit<PersistentMemoryEvent, "id" | "createdAt" | "updatedAt">[] =
        extractionResult.memoryEvents.map((event) => ({
          businessId,
          type: event.type,
          category: conversationObjective.objectiveType as any, // Map objective to category
          source: "CONVERSATION" as const,
          field: event.field,
          previousValue: event.previousValue,
          newValue: event.newValue,
          confidence: extractionResult.confidence,
          strength: extractionResult.confidence > 80 ? "strong" : "moderate",
        }));

      // Save memory events and derive learnings
      const persistenceResult = await saveMemoryEvents(supabase, memoryEventsToSave);

      if (persistenceResult.success) {
        memoryPersisted = true;
      } else {
        errors.push(`Memory persistence failed: ${persistenceResult.errors.join(", ")}`);
      }
    } catch (err) {
      errors.push(`Memory save error: ${String(err)}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Workflow Refresh: Recalculate state, guidance, and next question
  // ───────────────────────────────────────────────────────────────────────

  let newBusinessState: BusinessState | null = null;
  let newExecutiveGuidance: ExecutiveGuidance | null = null;
  let newConversationObjective: ConversationObjective | null = null;

  if (extractionResult.workflowNeedsRefresh) {
    try {
      // Fetch updated business context from database
      const dbContext = await getFullBusinessContext(supabase, businessId);

      if (dbContext) {
        // Rebuild business state input
        const stateInput = buildBusinessStateInput(dbContext);

        // Re-derive workflow components
        newBusinessState = deriveBusinessState(stateInput);

        if (newBusinessState) {
          newExecutiveGuidance = deriveExecutiveGuidance(newBusinessState);

          if (newExecutiveGuidance) {
            newConversationObjective = determineNextConversationObjective({
              businessState: newBusinessState,
              executiveGuidance: newExecutiveGuidance,
            });
          }
        }
      }
    } catch (err) {
      errors.push(`Workflow refresh error: ${String(err)}`);
    }
  }

  return {
    extractionResult,
    memoryPersisted,
    newBusinessState,
    newExecutiveGuidance,
    newConversationObjective,
    errors,
  };
}

// ─── Summary for Display ────────────────────────────────────────────────────

export function buildConversationLoopSummary(result: ConversationLoopResult): {
  factsExtracted: number;
  profileFieldsUpdated: number;
  memoryEventsSaved: boolean;
  workflowProgressed: boolean;
  confidence: number;
  nextObjectiveChanged: boolean;
} {
  return {
    factsExtracted: Object.keys(result.extractionResult.extractedFacts).length,
    profileFieldsUpdated: Object.keys(result.extractionResult.profileUpdates).length,
    memoryEventsSaved: result.memoryPersisted,
    workflowProgressed: result.newBusinessState !== null,
    confidence: result.extractionResult.confidence,
    nextObjectiveChanged:
      result.newConversationObjective !== null &&
      result.newConversationObjective.objectiveType !==
        // Note: can't access previous objective here, but result shows if new objective exists
        undefined,
  };
}
