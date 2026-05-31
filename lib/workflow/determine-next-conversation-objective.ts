// Zeya Conversation Objective Engine v1
// Determines what Zeya should talk about next
// Phase 3: "What should Zeya talk about?"

import type { BusinessState } from "./types";
import type { ExecutiveGuidance } from "./derive-executive-guidance";
import type { ConversationObjective, ConversationObjectiveType } from "./conversation-objective-types";

export interface ConversationObjectiveInput {
  businessState: BusinessState;
  executiveGuidance: ExecutiveGuidance;
}

// ─── Stage-Specific Conversation Objectives ────────────────────────────────

function deriveOnboardingObjective(input: ConversationObjectiveInput): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "COLLECT_BUSINESS_CONTEXT",
    title: "Establish business foundation",
    openingLine:
      "I need to understand the business before I can coordinate sales work. Let me gather some basics.",
    primaryQuestion: "What does the business do, and who does it serve?",
    tone: "SUPPORTIVE",
    informationNeeded: ["business_name", "business_description", "target_audience"],
    expectedFounderResponse:
      "The founder provides basic business information: name, what they do, and who they serve.",
    completionCriteria: "Business profile exists with name, offer, and target customer.",
    followUpAction: "Move to mission definition.",
    urgency: guidance.urgency,
  };
}

function deriveMissionDefinitionObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "DEFINE_MISSION",
    title: "Define sales mission",
    openingLine: "I understand the business basics. Now I need the sales mission.",
    primaryQuestion: "What outcome should this sales mission create?",
    tone: "EXECUTIVE",
    informationNeeded: ["mission", "mission_objective", "success_metric"],
    expectedFounderResponse:
      "The founder describes the sales mission: what they want to achieve, who they want to reach, and success metrics.",
    completionCriteria: "Mission is defined and approved.",
    followUpAction: "Define ideal customer profile.",
    urgency: guidance.urgency,
  };
}

function deriveICPDefinitionObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "DEFINE_ICP",
    title: "Define target customer profile",
    openingLine:
      "I need a clear target customer before we start looking for leads. Let me understand the ideal fit.",
    primaryQuestion: "Who is the best-fit customer for this mission?",
    tone: "DIRECT",
    informationNeeded: ["target_customer_profile", "pain_points", "buying_signals"],
    expectedFounderResponse:
      "The founder describes the ideal customer: who they are, what problems they face, and how to identify them.",
    completionCriteria: "Target customer profile and core offer are defined.",
    followUpAction: "Generate or upload prospect list.",
    urgency: guidance.urgency,
  };
}

function deriveLeadGenerationObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "REQUEST_LEADS",
    title: "Source prospect list",
    openingLine: "We know who to target. Now we need prospects to work with.",
    primaryQuestion: "Where will you source your first list of prospects?",
    tone: "EXECUTIVE",
    informationNeeded: ["prospect_list", "lead_source"],
    expectedFounderResponse:
      "The founder either uploads a prospect list, provides a source list, or requests lead generation.",
    completionCriteria: "At least 10 prospects are imported into the system.",
    followUpAction: "Review and select leads.",
    urgency: guidance.urgency,
  };
}

function deriveLeadReviewObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance, businessState } = input;

  const leadCount = businessState.dataCompleteness.leads ?? 0;
  const leadContext =
    leadCount > 50 ? "many prospects" : leadCount > 20 ? "multiple prospects" : "prospects";

  return {
    objectiveType: "REVIEW_LEADS",
    title: "Select priority prospects",
    openingLine: `We have ${leadContext} ready, but outreach should not start until the best prospects are selected.`,
    primaryQuestion: "Which prospects should we prioritize first?",
    tone: "DIRECT",
    informationNeeded: ["selected_leads", "lead_priority"],
    expectedFounderResponse:
      "The founder reviews prospects and selects 3-5 of the strongest matches for the target profile.",
    completionCriteria: "At least 3 selected leads are saved (or all available if fewer than 3).",
    followUpAction: "Prepare caller brief.",
    urgency: guidance.urgency,
  };
}

function deriveCallPreparationObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "PREPARE_CALLER_BRIEF",
    title: "Prepare outreach brief",
    openingLine:
      "Before assigning the workforce, we need a clear brief so they know exactly what to say and do.",
    primaryQuestion: "What should the caller know about positioning and objection handling?",
    tone: "EXECUTIVE",
    informationNeeded: [
      "opening_message",
      "objection_responses",
      "success_metric",
      "call_approach",
    ],
    expectedFounderResponse:
      "The founder approves the opening message, likely objections, recommended responses, and success metrics.",
    completionCriteria: "Caller brief is generated and approved.",
    followUpAction: "Assign workforce to the mission.",
    urgency: guidance.urgency,
  };
}

function deriveWorkforceAssignmentObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "ASSIGN_WORKFORCE",
    title: "Assign caller to mission",
    openingLine: "The mission is prepared. Now we need to assign execution.",
    primaryQuestion: "Who should handle this outreach mission?",
    tone: "DIRECT",
    informationNeeded: ["agent_assignment", "caller_selection"],
    expectedFounderResponse:
      "The founder selects an available agent or confirms the default assignment.",
    completionCriteria: "Workforce assignment is confirmed.",
    followUpAction: "Begin outreach execution.",
    urgency: guidance.urgency,
  };
}

function deriveOutreachExecutionObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "REQUEST_CALL_RESULTS",
    title: "Monitor execution and gather results",
    openingLine:
      "Outreach is now active. I need to track results so I can learn and adapt.",
    primaryQuestion: "What happened during the outreach calls?",
    tone: "EXECUTIVE",
    informationNeeded: ["call_outcomes", "prospect_responses", "objections_encountered"],
    expectedFounderResponse:
      "The founder reports on call outcomes: who answered, what objections came up, interest levels, and follow-up needs.",
    completionCriteria: "At least 3-5 call results are recorded with outcomes and notes.",
    followUpAction: "Review results and extract learnings.",
    urgency: guidance.urgency,
  };
}

function deriveResultReviewObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "REVIEW_RESULTS",
    title: "Review call outcomes and identify patterns",
    openingLine: "We have outreach results. Now we need to review what happened.",
    primaryQuestion: "What pattern do you see in the responses? What surprised you?",
    tone: "EXECUTIVE",
    informationNeeded: ["result_analysis", "pattern_identification", "key_findings"],
    expectedFounderResponse:
      "The founder reviews results and identifies what worked, what didn't, and what surprised them.",
    completionCriteria: "Results are reviewed and key findings (patterns, objections, success indicators) are identified.",
    followUpAction: "Extract learnings for the next iteration.",
    urgency: guidance.urgency,
  };
}

function deriveOptimizationObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const { executiveGuidance: guidance } = input;

  return {
    objectiveType: "OPTIMIZE_WORKFLOW",
    title: "Plan next mission iteration",
    openingLine:
      "We have enough feedback to improve the next sales cycle. Let's consolidate what we learned.",
    primaryQuestion: "What should we change before the next outreach round?",
    tone: "EXECUTIVE",
    informationNeeded: [
      "optimization_decision",
      "message_refinement",
      "targeting_adjustment",
      "next_focus",
    ],
    expectedFounderResponse:
      "The founder describes what worked, what to change, and the focus for the next mission iteration.",
    completionCriteria:
      "Next improvement action is selected and documented (message change, targeting adjustment, or new mission).",
    followUpAction: "Execute next mission iteration or refine existing mission.",
    urgency: guidance.urgency,
  };
}

// ─── Stage Dispatch ─────────────────────────────────────────────────────────

function deriveObjectiveByStage(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const stageObjectives: Record<
    string,
    (input: ConversationObjectiveInput) => ConversationObjective
  > = {
    ONBOARDING: deriveOnboardingObjective,
    MISSION_DEFINITION: deriveMissionDefinitionObjective,
    ICP_DEFINITION: deriveICPDefinitionObjective,
    LEAD_GENERATION: deriveLeadGenerationObjective,
    LEAD_REVIEW: deriveLeadReviewObjective,
    CALL_PREPARATION: deriveCallPreparationObjective,
    WORKFORCE_ASSIGNMENT: deriveWorkforceAssignmentObjective,
    OUTREACH_EXECUTION: deriveOutreachExecutionObjective,
    RESULT_REVIEW: deriveResultReviewObjective,
    OPTIMIZATION: deriveOptimizationObjective,
  };

  const objectiveBuilder = stageObjectives[input.businessState.currentStage];
  return objectiveBuilder(input);
}

// ─── Tone Derivation ────────────────────────────────────────────────────────

function deriveTone(
  stage: string,
  urgency: "LOW" | "MEDIUM" | "HIGH",
): "DIRECT" | "SUPPORTIVE" | "EXECUTIVE" {
  // Early stages: supportive (starting fresh)
  if (stage === "ONBOARDING") {
    return "SUPPORTIVE";
  }

  // Blocked stages: direct (something is blocking)
  if (
    stage === "MISSION_DEFINITION" ||
    stage === "ICP_DEFINITION" ||
    stage === "LEAD_REVIEW" ||
    stage === "CALL_PREPARATION" ||
    stage === "WORKFORCE_ASSIGNMENT"
  ) {
    return "DIRECT";
  }

  // Execution and optimization: executive (professional, efficient)
  return "EXECUTIVE";
}

// ─── Main Export ────────────────────────────────────────────────────────────

export function determineNextConversationObjective(
  input: ConversationObjectiveInput,
): ConversationObjective {
  const objective = deriveObjectiveByStage(input);

  // Override tone with deterministic derivation
  return {
    ...objective,
    tone: deriveTone(input.businessState.currentStage, input.executiveGuidance.urgency),
  };
}
