// Workflow Brain types — deterministic state derivation from business context
// No AI, no LLM, pure business logic

export type WorkflowStage =
  | "ONBOARDING"
  | "MISSION_DEFINITION"
  | "ICP_DEFINITION"
  | "LEAD_GENERATION"
  | "LEAD_REVIEW"
  | "CALL_PREPARATION"
  | "WORKFORCE_ASSIGNMENT"
  | "OUTREACH_EXECUTION"
  | "RESULT_REVIEW"
  | "OPTIMIZATION";

export interface BusinessState {
  // Core workflow positioning
  currentStage: WorkflowStage;
  readinessScore: number; // 0-100, deterministic from inputs
  confidence: number; // 0-100, reflects completeness of understanding

  // What's blocking progress
  blockingReason: string | null; // Primary blocker (null if no blocker)
  isBlocked: boolean;

  // What should happen next
  currentPriority: string; // Most important task right now
  nextAction: string; // Immediate next step
  recommendedConversationObjective: string; // What to discuss with founder

  // What's missing
  missingInformation: string[]; // Machine-readable list of gaps

  // Metadata
  stageHasData: boolean; // Does current stage have any data?
  dataCompleteness: Record<string, number>; // Per-component readiness (0-100)
}
