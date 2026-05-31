// Conversation Objective examples — complete outputs for each workflow stage
// Shows what determined objective looks like at each stage

import { determineNextConversationObjective } from "./determine-next-conversation-objective";
import type { BusinessState } from "./types";
import type { ExecutiveGuidance } from "./derive-executive-guidance";
import {
  stateOnboarding,
  guidanceOnboarding,
  stateMissionDefinition,
  guidanceMissionDefinition,
  stateICPDefinition,
  guidanceICPDefinition,
  stateLeadGeneration,
  guidanceLeadGeneration,
  stateLeadReview,
  guidanceLeadReview,
  stateCallPreparation,
  guidanceCallPreparation,
  stateWorkforceAssignment,
  guidanceWorkforceAssignment,
  stateOutreachExecution,
  guidanceOutreachExecution,
  stateResultReview,
  guidanceResultReview,
  stateOptimization,
  guidanceOptimization,
} from "./executive-guidance-examples";

// ─── Example 1: ONBOARDING ──────────────────────────────────────────────────

export const objectiveOnboarding = determineNextConversationObjective({
  businessState: stateOnboarding,
  executiveGuidance: guidanceOnboarding,
});
// Expected output:
// {
//   objectiveType: "COLLECT_BUSINESS_CONTEXT",
//   title: "Establish business foundation",
//   openingLine: "I need to understand the business before I can coordinate sales work...",
//   primaryQuestion: "What does the business do, and who does it serve?",
//   tone: "SUPPORTIVE",
//   informationNeeded: ["business_name", "business_description", "target_audience"],
//   expectedFounderResponse: "The founder provides basic business information...",
//   completionCriteria: "Business profile exists with name, offer, and target customer.",
//   followUpAction: "Move to mission definition.",
//   urgency: "HIGH",
// }

// ─── Example 2: MISSION_DEFINITION ──────────────────────────────────────────

export const objectiveMissionDefinition = determineNextConversationObjective({
  businessState: stateMissionDefinition,
  executiveGuidance: guidanceMissionDefinition,
});
// Expected output:
// {
//   objectiveType: "DEFINE_MISSION",
//   title: "Define sales mission",
//   openingLine: "I understand the business basics. Now I need the sales mission.",
//   primaryQuestion: "What outcome should this sales mission create?",
//   tone: "DIRECT",
//   informationNeeded: ["mission", "mission_objective", "success_metric"],
//   expectedFounderResponse: "The founder describes the sales mission...",
//   completionCriteria: "Mission is defined and approved.",
//   followUpAction: "Define ideal customer profile.",
//   urgency: "HIGH",
// }

// ─── Example 3: ICP_DEFINITION ──────────────────────────────────────────────

export const objectiveICPDefinition = determineNextConversationObjective({
  businessState: stateICPDefinition,
  executiveGuidance: guidanceICPDefinition,
});
// Expected output:
// {
//   objectiveType: "DEFINE_ICP",
//   title: "Define target customer profile",
//   openingLine: "I need a clear target customer before we start looking for leads...",
//   primaryQuestion: "Who is the best-fit customer for this mission?",
//   tone: "DIRECT",
//   informationNeeded: ["target_customer_profile", "pain_points", "buying_signals"],
//   expectedFounderResponse: "The founder describes the ideal customer...",
//   completionCriteria: "Target customer profile and core offer are defined.",
//   followUpAction: "Generate or upload prospect list.",
//   urgency: "HIGH",
// }

// ─── Example 4: LEAD_GENERATION ─────────────────────────────────────────────

export const objectiveLeadGeneration = determineNextConversationObjective({
  businessState: stateLeadGeneration,
  executiveGuidance: guidanceLeadGeneration,
});
// Expected output:
// {
//   objectiveType: "REQUEST_LEADS",
//   title: "Source prospect list",
//   openingLine: "We know who to target. Now we need prospects to work with.",
//   primaryQuestion: "Where will you source your first list of prospects?",
//   tone: "EXECUTIVE",
//   informationNeeded: ["prospect_list", "lead_source"],
//   expectedFounderResponse: "The founder either uploads a list or provides a source...",
//   completionCriteria: "At least 10 prospects are imported into the system.",
//   followUpAction: "Review and select leads.",
//   urgency: "MEDIUM",
// }

// ─── Example 5: LEAD_REVIEW ─────────────────────────────────────────────────

export const objectiveLeadReview = determineNextConversationObjective({
  businessState: stateLeadReview,
  executiveGuidance: guidanceLeadReview,
});
// Expected output:
// {
//   objectiveType: "REVIEW_LEADS",
//   title: "Select priority prospects",
//   openingLine: "We have prospects ready, but outreach should not start until...",
//   primaryQuestion: "Which prospects should we prioritize first?",
//   tone: "DIRECT",
//   informationNeeded: ["selected_leads", "lead_priority"],
//   expectedFounderResponse: "The founder reviews and selects 3-5 strongest matches...",
//   completionCriteria: "At least 3 selected leads are saved...",
//   followUpAction: "Prepare caller brief.",
//   urgency: "MEDIUM",
// }

// ─── Example 6: CALL_PREPARATION ────────────────────────────────────────────

export const objectiveCallPreparation = determineNextConversationObjective({
  businessState: stateCallPreparation,
  executiveGuidance: guidanceCallPreparation,
});
// Expected output:
// {
//   objectiveType: "PREPARE_CALLER_BRIEF",
//   title: "Prepare outreach brief",
//   openingLine: "Before assigning the workforce, we need a clear brief...",
//   primaryQuestion: "What should the caller know about positioning and objection handling?",
//   tone: "DIRECT",
//   informationNeeded: [
//     "opening_message",
//     "objection_responses",
//     "success_metric",
//     "call_approach",
//   ],
//   expectedFounderResponse: "The founder approves the opening message and responses...",
//   completionCriteria: "Caller brief is generated and approved.",
//   followUpAction: "Assign workforce to the mission.",
//   urgency: "MEDIUM",
// }

// ─── Example 7: WORKFORCE_ASSIGNMENT ─────────────────────────────────────────

export const objectiveWorkforceAssignment = determineNextConversationObjective({
  businessState: stateWorkforceAssignment,
  executiveGuidance: guidanceWorkforceAssignment,
});
// Expected output:
// {
//   objectiveType: "ASSIGN_WORKFORCE",
//   title: "Assign caller to mission",
//   openingLine: "The mission is prepared. Now we need to assign execution.",
//   primaryQuestion: "Who should handle this outreach mission?",
//   tone: "DIRECT",
//   informationNeeded: ["agent_assignment", "caller_selection"],
//   expectedFounderResponse: "The founder selects an available agent...",
//   completionCriteria: "Workforce assignment is confirmed.",
//   followUpAction: "Begin outreach execution.",
//   urgency: "MEDIUM",
// }

// ─── Example 8: OUTREACH_EXECUTION ──────────────────────────────────────────

export const objectiveOutreachExecution = determineNextConversationObjective({
  businessState: stateOutreachExecution,
  executiveGuidance: guidanceOutreachExecution,
});
// Expected output:
// {
//   objectiveType: "REQUEST_CALL_RESULTS",
//   title: "Monitor execution and gather results",
//   openingLine: "Outreach is now active. I need to track results...",
//   primaryQuestion: "What happened during the outreach calls?",
//   tone: "EXECUTIVE",
//   informationNeeded: ["call_outcomes", "prospect_responses", "objections_encountered"],
//   expectedFounderResponse: "The founder reports on call outcomes...",
//   completionCriteria: "At least 3-5 call results are recorded...",
//   followUpAction: "Review results and extract learnings.",
//   urgency: "MEDIUM",
// }

// ─── Example 9: RESULT_REVIEW ───────────────────────────────────────────────

export const objectiveResultReview = determineNextConversationObjective({
  businessState: stateResultReview,
  executiveGuidance: guidanceResultReview,
});
// Expected output:
// {
//   objectiveType: "REVIEW_RESULTS",
//   title: "Review call outcomes and identify patterns",
//   openingLine: "We have outreach results. Now we need to review what happened.",
//   primaryQuestion: "What pattern do you see in the responses? What surprised you?",
//   tone: "EXECUTIVE",
//   informationNeeded: ["result_analysis", "pattern_identification", "key_findings"],
//   expectedFounderResponse: "The founder reviews results and identifies patterns...",
//   completionCriteria: "Results are reviewed and key findings are identified.",
//   followUpAction: "Extract learnings for the next iteration.",
//   urgency: "MEDIUM",
// }

// ─── Example 10: OPTIMIZATION ───────────────────────────────────────────────

export const objectiveOptimization = determineNextConversationObjective({
  businessState: stateOptimization,
  executiveGuidance: guidanceOptimization,
});
// Expected output:
// {
//   objectiveType: "OPTIMIZE_WORKFLOW",
//   title: "Plan next mission iteration",
//   openingLine: "We have enough feedback to improve the next sales cycle...",
//   primaryQuestion: "What should we change before the next outreach round?",
//   tone: "EXECUTIVE",
//   informationNeeded: [
//     "optimization_decision",
//     "message_refinement",
//     "targeting_adjustment",
//     "next_focus",
//   ],
//   expectedFounderResponse: "The founder describes what to change...",
//   completionCriteria: "Next improvement action is selected and documented...",
//   followUpAction: "Execute next mission iteration or refine existing mission.",
//   urgency: "LOW",
// }
