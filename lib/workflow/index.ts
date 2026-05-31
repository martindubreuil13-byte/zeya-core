// Zeya Workflow Brain v1 — public API

// Phase 1: Workflow Brain (Reality)
export { deriveBusinessState } from "./derive-business-state";
export type { BusinessStateInput } from "./derive-business-state";
export type { BusinessState, WorkflowStage } from "./types";

// Phase 2: Executive Guidance (Interpretation)
export { deriveExecutiveGuidance } from "./derive-executive-guidance";
export type { ExecutiveGuidance } from "./derive-executive-guidance";

// Phase 3: Conversation Objective (Dialogue Focus)
export { determineNextConversationObjective } from "./determine-next-conversation-objective";
export type { ConversationObjectiveInput } from "./determine-next-conversation-objective";
export type { ConversationObjective, ConversationObjectiveType } from "./conversation-objective-types";

// Phase 5: Conversation State Engine (Conversation → Memory → Workflow)
export { processConversationResponse } from "./conversation-state-engine";
export type { ConversationResponseInput, ExtractedFacts, MemoryEvent, ExtractionResult } from "./conversation-state-engine";

// Database integration
export { getFullBusinessContext, buildBusinessStateInput } from "./build-business-state-from-db";
export type { DatabaseContext } from "./build-business-state-from-db";

// Examples for testing and documentation
export * from "./examples";
export * from "./executive-guidance-examples";
export * from "./conversation-objective-examples";
