// Conversation Objective Engine types
// Determines what Zeya should talk about next

export type ConversationObjectiveType =
  | "COLLECT_BUSINESS_CONTEXT"
  | "DEFINE_MISSION"
  | "DEFINE_ICP"
  | "REQUEST_LEADS"
  | "REVIEW_LEADS"
  | "PREPARE_CALLER_BRIEF"
  | "ASSIGN_WORKFORCE"
  | "REQUEST_CALL_RESULTS"
  | "REVIEW_RESULTS"
  | "OPTIMIZE_WORKFLOW";

export interface ConversationObjective {
  // Identification
  objectiveType: ConversationObjectiveType;
  title: string;

  // Dialogue
  openingLine: string; // How to start the conversation
  primaryQuestion: string | null; // One most important question
  tone: "DIRECT" | "SUPPORTIVE" | "EXECUTIVE";

  // Requirements
  informationNeeded: string[]; // Machine-readable list of what's needed
  expectedFounderResponse: string; // Plain English description of expected answer

  // Completion
  completionCriteria: string; // What must happen for objective to be complete
  followUpAction: string; // What happens after completion

  // Context
  urgency: "LOW" | "MEDIUM" | "HIGH"; // From ExecutiveGuidance or adjusted
}
