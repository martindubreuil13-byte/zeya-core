// Zeya Executive Guidance Engine v1
// Interprets BusinessState into executive-level direction
// Phase 2: "What should we do about it?"

import type { BusinessState, WorkflowStage } from "./types";

// ─── Executive Guidance Type ─────────────────────────────────────────────────

export interface ExecutiveGuidance {
  // Context and interpretation
  summary: string; // Short explanation of current situation
  objective: string; // What Zeya is trying to accomplish right now
  rationale: string; // Why this matters

  // Requests
  founderRequest: string | null; // What Zeya needs from the founder
  founderQuestion: string | null; // Single most useful question to ask

  // Operations
  workforceDirection: string | null; // What workforce should be doing

  // Metrics
  urgency: "LOW" | "MEDIUM" | "HIGH"; // Based on blockers and progression
  successDefinition: string; // What must happen to complete this stage
  nextMilestone: string; // What comes after success
}

// ─── Stage-Specific Guidance ────────────────────────────────────────────────

function deriveOnboardingGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "No business profile exists. Starting from zero.",
    objective: "Establish business context and foundation.",
    rationale:
      "All downstream workflow depends on basic business understanding. Onboarding must complete before any strategic decisions.",
    founderRequest: "Provide basic business information.",
    founderQuestion: "What does your business do, and who do you help?",
    workforceDirection: null,
    urgency: "HIGH",
    successDefinition: "Business profile completed with name, offer, and target customer.",
    nextMilestone: "Mission definition",
  };
}

function deriveMissionDefinitionGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "Business profile exists but mission clarity is missing.",
    objective: "Define the business sales mission.",
    rationale:
      "Mission provides direction for all execution. Without it, lead generation and outreach lack purpose and focus.",
    founderRequest: "Define your first sales mission.",
    founderQuestion: "What specific sales outcome are you trying to achieve first?",
    workforceDirection: null,
    urgency: "HIGH",
    successDefinition: "Mission approved with clear objective, target segment, and success metric.",
    nextMilestone: "ICP definition",
  };
}

function deriveICPDefinitionGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "Mission exists but ideal customer profile is incomplete.",
    objective: "Define target customer profile.",
    rationale:
      "ICP focuses lead generation and improves prospect quality. Without it, you risk generating irrelevant leads.",
    founderRequest: "Describe your ideal customer.",
    founderQuestion:
      "Who benefits most from your offer, and what characteristics define them?",
    workforceDirection: null,
    urgency: "HIGH",
    successDefinition:
      "ICP completed with target segment, pain points, and buying behaviors.",
    nextMilestone: "Lead generation",
  };
}

function deriveLeadGenerationGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: `No leads uploaded yet. ICP defined. Ready to source prospects.`,
    objective: "Generate and upload prospect list.",
    rationale:
      "Leads are the fuel for outreach. Quality source and quantity matter equally. Without leads, nothing can execute.",
    founderRequest: "Upload or paste a list of prospects.",
    founderQuestion: "Where will you source your first list of prospects?",
    workforceDirection: null,
    urgency: "MEDIUM",
    successDefinition: "At least 10 prospects uploaded and imported.",
    nextMilestone: "Lead review and selection",
  };
}

function deriveLeadReviewGuidance(state: BusinessState): ExecutiveGuidance {
  const leadTotal = state.dataCompleteness.leads > 0 ? "Multiple" : "Some";
  return {
    summary: `${leadTotal} prospects uploaded but not yet reviewed. Selection pending.`,
    objective: "Select priority prospects for outreach.",
    rationale:
      "Not all leads are equal. Selecting the best fit improves conversion and accelerates momentum. Quality over quantity.",
    founderRequest: "Review and select priority prospects.",
    founderQuestion: "Which prospects are your strongest matches for this mission?",
    workforceDirection: null,
    urgency: "MEDIUM",
    successDefinition:
      "At least 3-5 prospects marked as selected and ready for outreach.",
    nextMilestone: "Caller brief preparation",
  };
}

function deriveCallPreparationGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "Priority prospects selected. Outreach strategy needed.",
    objective: "Prepare caller brief with talking points.",
    rationale:
      "The brief is the execution playbook. It aligns the workforce on messaging, objection handling, and success metrics. Without it, outreach is uncoordinated.",
    founderRequest: "Review and approve the caller brief.",
    founderQuestion: "Are the opening message and objection responses aligned with your positioning?",
    workforceDirection:
      "Prepare outreach materials and messaging guidelines based on brief.",
    urgency: "MEDIUM",
    successDefinition:
      "Caller brief completed with opening message, objection responses, and success metrics.",
    nextMilestone: "Workforce assignment",
  };
}

function deriveWorkforceAssignmentGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "Brief prepared. Ready to assign workforce to the mission.",
    objective: "Assign caller to execute the mission.",
    rationale:
      "Assignment activates execution. Without it, prepared work cannot begin. This is the bridge from planning to action.",
    founderRequest: "Select and assign a caller to this mission.",
    founderQuestion: "Which agent should execute this mission?",
    workforceDirection: "Stand by for assignment and mission briefing.",
    urgency: "MEDIUM",
    successDefinition: "Agent assigned with brief snapshot and lead count confirmed.",
    nextMilestone: "Outreach execution",
  };
}

function deriveOutreachExecutionGuidance(state: BusinessState): ExecutiveGuidance {
  return {
    summary: "Assigned. Outreach is in progress.",
    objective: "Execute outreach to prospects. Gather call outcomes.",
    rationale:
      "Execution is where theory meets reality. Outcomes provide feedback that informs learning and iteration.",
    founderRequest: "Monitor progress and provide course corrections as needed.",
    founderQuestion: "What are you hearing from prospects? Any patterns emerging?",
    workforceDirection: "Execute approved outreach sequence. Log outcomes for each call.",
    urgency: "MEDIUM",
    successDefinition:
      "At least 3-5 calls completed with outcomes logged (answered, voicemail, interested, etc.).",
    nextMilestone: "Result review and learning extraction",
  };
}

function deriveResultReviewGuidance(state: BusinessState): ExecutiveGuidance {
  const callCount = state.dataCompleteness.execution ?? 0;
  const callsCompleted = callCount > 0 ? `${Math.min(100, callCount)}% of target` : "some";
  return {
    summary: `Calls completed (${callsCompleted}). Results ready for analysis.`,
    objective: "Review call outcomes and extract learnings.",
    rationale:
      "Results reveal what works. Without analysis, you repeat mistakes. Learning compounds over iterations.",
    founderRequest:
      "Review the call outcomes and share observations about what resonated.",
    founderQuestion: "What surprised you? What pattern did you notice in the responses?",
    workforceDirection: "Prepare summary of call outcomes and common themes.",
    urgency: "MEDIUM",
    successDefinition:
      "Call outcomes reviewed. Common objections, interest levels, and patterns identified.",
    nextMilestone: "Optimization and iteration planning",
  };
}

function deriveOptimizationGuidance(state: BusinessState): ExecutiveGuidance {
  const learningCount = state.dataCompleteness.learning ?? 0;
  const hasLearnings = learningCount > 0;
  return {
    summary: `Learning events captured. ${hasLearnings ? "Insights ready for iteration." : "Enough data to begin pattern analysis."}`,
    objective: "Extract learnings and plan next mission iteration.",
    rationale:
      "Learnings are the most valuable output. They improve messaging, targeting, and outcomes. This is how you compound advantage.",
    founderRequest:
      "Consolidate learnings and decide on next mission focus area.",
    founderQuestion:
      "Based on what you learned, what would you do differently in the next round?",
    workforceDirection: "Document and archive all learnings from this mission.",
    urgency: "LOW",
    successDefinition:
      "Learning events consolidated. Next mission direction decided and documented.",
    nextMilestone: "Next mission definition or existing mission refinement",
  };
}

// ─── Stage Dispatch ─────────────────────────────────────────────────────────

function deriveGuidanceByStage(state: BusinessState): ExecutiveGuidance {
  const stageGuidance: Record<WorkflowStage, (s: BusinessState) => ExecutiveGuidance> =
    {
      ONBOARDING: deriveOnboardingGuidance,
      MISSION_DEFINITION: deriveMissionDefinitionGuidance,
      ICP_DEFINITION: deriveICPDefinitionGuidance,
      LEAD_GENERATION: deriveLeadGenerationGuidance,
      LEAD_REVIEW: deriveLeadReviewGuidance,
      CALL_PREPARATION: deriveCallPreparationGuidance,
      WORKFORCE_ASSIGNMENT: deriveWorkforceAssignmentGuidance,
      OUTREACH_EXECUTION: deriveOutreachExecutionGuidance,
      RESULT_REVIEW: deriveResultReviewGuidance,
      OPTIMIZATION: deriveOptimizationGuidance,
    };

  const guidanceBuilder = stageGuidance[state.currentStage];
  return guidanceBuilder(state);
}

// ─── Urgency Derivation ────────────────────────────────────────────────────

function deriveUrgency(state: BusinessState): "LOW" | "MEDIUM" | "HIGH" {
  // Early stages: high urgency (blocking all downstream work)
  if (
    state.currentStage === "ONBOARDING" ||
    state.currentStage === "MISSION_DEFINITION" ||
    state.currentStage === "ICP_DEFINITION"
  ) {
    return "HIGH";
  }

  // Middle stages: medium urgency (in-flight work)
  if (
    state.currentStage === "LEAD_GENERATION" ||
    state.currentStage === "LEAD_REVIEW" ||
    state.currentStage === "CALL_PREPARATION" ||
    state.currentStage === "WORKFORCE_ASSIGNMENT" ||
    state.currentStage === "OUTREACH_EXECUTION"
  ) {
    return "MEDIUM";
  }

  // Late stages: low urgency (analysis and optimization)
  return "LOW";
}

// ─── Main Export ────────────────────────────────────────────────────────────

export function deriveExecutiveGuidance(state: BusinessState): ExecutiveGuidance {
  const guidance = deriveGuidanceByStage(state);

  // Override urgency with deterministic derivation
  return {
    ...guidance,
    urgency: deriveUrgency(state),
  };
}
