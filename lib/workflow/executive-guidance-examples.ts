// Executive Guidance examples — complete outputs for each workflow stage
// Shows how BusinessState transforms into executive-level direction

import { deriveExecutiveGuidance } from "./derive-executive-guidance";
import type { BusinessState } from "./types";

// ─── Example 1: ONBOARDING Stage ────────────────────────────────────────────

export const stateOnboarding: BusinessState = {
  currentStage: "ONBOARDING",
  readinessScore: 0,
  confidence: 50,
  blockingReason: "Business profile not yet started",
  isBlocked: true,
  currentPriority: "Start business profile",
  nextAction: "Answer onboarding questions about your business",
  recommendedConversationObjective: "Gather foundational business information",
  missingInformation: [
    "business_name",
    "mission",
    "target_customers",
    "offer",
    "pain_points",
    "leads",
  ],
  stageHasData: false,
  dataCompleteness: {
    business: 0,
    icp: 0,
    leads: 0,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceOnboarding = deriveExecutiveGuidance(stateOnboarding);
// Expected output:
// {
//   summary: "No business profile exists. Starting from zero.",
//   objective: "Establish business context and foundation.",
//   rationale: "All downstream workflow depends on basic business understanding...",
//   founderRequest: "Provide basic business information.",
//   founderQuestion: "What does your business do, and who do you help?",
//   workforceDirection: null,
//   urgency: "HIGH",
//   successDefinition: "Business profile completed with name, offer, and target customer.",
//   nextMilestone: "Mission definition",
// }

// ─── Example 2: MISSION_DEFINITION Stage ───────────────────────────────────

export const stateMissionDefinition: BusinessState = {
  currentStage: "MISSION_DEFINITION",
  readinessScore: 15,
  confidence: 55,
  blockingReason: "No mission defined for this business",
  isBlocked: true,
  currentPriority: "Define sales mission",
  nextAction: "Define your first sales mission",
  recommendedConversationObjective: "Understand sales goals and mission focus",
  missingInformation: [
    "mission",
    "target_customers",
    "offer",
    "pain_points",
    "leads",
  ],
  stageHasData: true,
  dataCompleteness: {
    business: 50,
    icp: 0,
    leads: 0,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceMissionDefinition = deriveExecutiveGuidance(
  stateMissionDefinition,
);
// Expected output:
// {
//   summary: "Business profile exists but mission clarity is missing.",
//   objective: "Define the business sales mission.",
//   rationale: "Mission provides direction for all execution...",
//   founderRequest: "Define your first sales mission.",
//   founderQuestion: "What specific sales outcome are you trying to achieve first?",
//   workforceDirection: null,
//   urgency: "HIGH",
//   successDefinition: "Mission approved with clear objective, target segment, and success metric.",
//   nextMilestone: "ICP definition",
// }

// ─── Example 3: ICP_DEFINITION Stage ───────────────────────────────────────

export const stateICPDefinition: BusinessState = {
  currentStage: "ICP_DEFINITION",
  readinessScore: 30,
  confidence: 60,
  blockingReason: "Target customer profile and/or offer not defined",
  isBlocked: true,
  currentPriority: "Define ideal customer profile and core offer",
  nextAction: "Describe your ideal customer and core offer",
  recommendedConversationObjective: "Refine target customer and positioning",
  missingInformation: [
    "target_customers",
    "offer",
    "pain_points",
    "leads",
  ],
  stageHasData: true,
  dataCompleteness: {
    business: 80,
    icp: 20,
    leads: 0,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceICPDefinition = deriveExecutiveGuidance(stateICPDefinition);
// Expected output:
// {
//   summary: "Mission exists but ideal customer profile is incomplete.",
//   objective: "Define target customer profile.",
//   rationale: "ICP focuses lead generation and improves prospect quality...",
//   founderRequest: "Describe your ideal customer.",
//   founderQuestion: "Who benefits most from your offer, and what characteristics define them?",
//   workforceDirection: null,
//   urgency: "HIGH",
//   successDefinition: "ICP completed with target segment, pain points, and buying behaviors.",
//   nextMilestone: "Lead generation",
// }

// ─── Example 4: LEAD_GENERATION Stage ──────────────────────────────────────

export const stateLeadGeneration: BusinessState = {
  currentStage: "LEAD_GENERATION",
  readinessScore: 45,
  confidence: 65,
  blockingReason: "No leads or prospects uploaded",
  isBlocked: true,
  currentPriority: "Upload and organize leads",
  nextAction: "Upload leads (CSV, paste, or manual)",
  recommendedConversationObjective: "Organize and prepare lead list",
  missingInformation: ["leads", "selected_leads", "caller_brief", "assigned_agent"],
  stageHasData: true,
  dataCompleteness: {
    business: 90,
    icp: 100,
    leads: 0,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceLeadGeneration = deriveExecutiveGuidance(stateLeadGeneration);
// Expected output:
// {
//   summary: "No leads uploaded yet. ICP defined. Ready to source prospects.",
//   objective: "Generate and upload prospect list.",
//   rationale: "Leads are the fuel for outreach. Quality source and quantity matter equally...",
//   founderRequest: "Upload or paste a list of prospects.",
//   founderQuestion: "Where will you source your first list of prospects?",
//   workforceDirection: null,
//   urgency: "MEDIUM",
//   successDefinition: "At least 10 prospects uploaded and imported.",
//   nextMilestone: "Lead review and selection",
// }

// ─── Example 5: LEAD_REVIEW Stage ─────────────────────────────────────────

export const stateLeadReview: BusinessState = {
  currentStage: "LEAD_REVIEW",
  readinessScore: 50,
  confidence: 72,
  blockingReason: "12 leads available but none selected yet",
  isBlocked: true,
  currentPriority: "Review and select best prospects",
  nextAction: "Mark 3–5 strongest prospects as selected",
  recommendedConversationObjective: "Evaluate prospects and select best fits",
  missingInformation: [
    "selected_leads",
    "caller_brief",
    "assigned_agent",
  ],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 50,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceLeadReview = deriveExecutiveGuidance(stateLeadReview);
// Expected output:
// {
//   summary: "Multiple prospects uploaded but not yet reviewed. Selection pending.",
//   objective: "Select priority prospects for outreach.",
//   rationale: "Not all leads are equal. Selecting the best fit improves conversion...",
//   founderRequest: "Review and select priority prospects.",
//   founderQuestion: "Which prospects are your strongest matches for this mission?",
//   workforceDirection: null,
//   urgency: "MEDIUM",
//   successDefinition: "At least 3-5 prospects marked as selected and ready for outreach.",
//   nextMilestone: "Caller brief preparation",
// }

// ─── Example 6: CALL_PREPARATION Stage ────────────────────────────────────

export const stateCallPreparation: BusinessState = {
  currentStage: "CALL_PREPARATION",
  readinessScore: 63,
  confidence: 78,
  blockingReason: "Leads selected but caller brief not prepared",
  isBlocked: true,
  currentPriority: "Prepare caller brief with talking points",
  nextAction: "Generate caller brief for this mission",
  recommendedConversationObjective: "Prepare sales motion and talking points",
  missingInformation: ["caller_brief", "assigned_agent"],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 100,
    sales_motion: 0,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceCallPreparation = deriveExecutiveGuidance(
  stateCallPreparation,
);
// Expected output:
// {
//   summary: "Priority prospects selected. Outreach strategy needed.",
//   objective: "Prepare caller brief with talking points.",
//   rationale: "The brief is the execution playbook. It aligns the workforce...",
//   founderRequest: "Review and approve the caller brief.",
//   founderQuestion: "Are the opening message and objection responses aligned with your positioning?",
//   workforceDirection: "Prepare outreach materials and messaging guidelines based on brief.",
//   urgency: "MEDIUM",
//   successDefinition: "Caller brief completed with opening message, objection responses...",
//   nextMilestone: "Workforce assignment",
// }

// ─── Example 7: WORKFORCE_ASSIGNMENT Stage ────────────────────────────────

export const stateWorkforceAssignment: BusinessState = {
  currentStage: "WORKFORCE_ASSIGNMENT",
  readinessScore: 73,
  confidence: 82,
  blockingReason: "Caller brief ready but no agent assigned",
  isBlocked: true,
  currentPriority: "Assign caller to the mission",
  nextAction: "Assign an agent to handle outreach",
  recommendedConversationObjective: "Brief agent on mission and expectations",
  missingInformation: ["assigned_agent"],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 100,
    sales_motion: 100,
    workforce: 0,
    execution: 0,
    learning: 0,
  },
};

export const guidanceWorkforceAssignment = deriveExecutiveGuidance(
  stateWorkforceAssignment,
);
// Expected output:
// {
//   summary: "Brief prepared. Ready to assign workforce to the mission.",
//   objective: "Assign caller to execute the mission.",
//   rationale: "Assignment activates execution. Without it, prepared work cannot begin...",
//   founderRequest: "Select and assign a caller to this mission.",
//   founderQuestion: "Which agent should execute this mission?",
//   workforceDirection: "Stand by for assignment and mission briefing.",
//   urgency: "MEDIUM",
//   successDefinition: "Agent assigned with brief snapshot and lead count confirmed.",
//   nextMilestone: "Outreach execution",
// }

// ─── Example 8: OUTREACH_EXECUTION Stage ──────────────────────────────────

export const stateOutreachExecution: BusinessState = {
  currentStage: "OUTREACH_EXECUTION",
  readinessScore: 81,
  confidence: 85,
  blockingReason: null,
  isBlocked: false,
  currentPriority: "Execute outreach to leads",
  nextAction: "Monitor ongoing outreach and calls",
  recommendedConversationObjective: "Monitor execution and gather feedback",
  missingInformation: ["call_results"],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 100,
    sales_motion: 100,
    workforce: 100,
    execution: 0,
    learning: 0,
  },
};

export const guidanceOutreachExecution = deriveExecutiveGuidance(
  stateOutreachExecution,
);
// Expected output:
// {
//   summary: "Assigned. Outreach is in progress.",
//   objective: "Execute outreach to prospects. Gather call outcomes.",
//   rationale: "Execution is where theory meets reality. Outcomes provide feedback...",
//   founderRequest: "Monitor progress and provide course corrections as needed.",
//   founderQuestion: "What are you hearing from prospects? Any patterns emerging?",
//   workforceDirection: "Execute approved outreach sequence. Log outcomes for each call.",
//   urgency: "MEDIUM",
//   successDefinition: "At least 3-5 calls completed with outcomes logged...",
//   nextMilestone: "Result review and learning extraction",
// }

// ─── Example 9: RESULT_REVIEW Stage ───────────────────────────────────────

export const stateResultReview: BusinessState = {
  currentStage: "RESULT_REVIEW",
  readinessScore: 87,
  confidence: 88,
  blockingReason: null,
  isBlocked: false,
  currentPriority: "Review call results and outcomes",
  nextAction: "Review call outcomes and feedback",
  recommendedConversationObjective: "Debrief on call results and outcomes",
  missingInformation: [],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 100,
    sales_motion: 100,
    workforce: 100,
    execution: 75,
    learning: 0,
  },
};

export const guidanceResultReview = deriveExecutiveGuidance(stateResultReview);
// Expected output:
// {
//   summary: "Calls completed (75% of target). Results ready for analysis.",
//   objective: "Review call outcomes and extract learnings.",
//   rationale: "Results reveal what works. Without analysis, you repeat mistakes...",
//   founderRequest: "Review the call outcomes and share observations about what resonated.",
//   founderQuestion: "What surprised you? What pattern did you notice in the responses?",
//   workforceDirection: "Prepare summary of call outcomes and common themes.",
//   urgency: "MEDIUM",
//   successDefinition: "Call outcomes reviewed. Common objections, interest levels identified.",
//   nextMilestone: "Optimization and iteration planning",
// }

// ─── Example 10: OPTIMIZATION Stage ───────────────────────────────────────

export const stateOptimization: BusinessState = {
  currentStage: "OPTIMIZATION",
  readinessScore: 90,
  confidence: 92,
  blockingReason: null,
  isBlocked: false,
  currentPriority: "Extract and apply learnings",
  nextAction: "Apply learnings to next mission iteration",
  recommendedConversationObjective: "Consolidate learnings and plan iteration",
  missingInformation: [],
  stageHasData: true,
  dataCompleteness: {
    business: 100,
    icp: 100,
    leads: 100,
    sales_motion: 100,
    workforce: 100,
    execution: 100,
    learning: 100,
  },
};

export const guidanceOptimization = deriveExecutiveGuidance(stateOptimization);
// Expected output:
// {
//   summary: "Learning events captured. Insights ready for iteration.",
//   objective: "Extract learnings and plan next mission iteration.",
//   rationale: "Learnings are the most valuable output. They improve messaging...",
//   founderRequest: "Consolidate learnings and decide on next mission focus area.",
//   founderQuestion: "Based on what you learned, what would you do differently in the next round?",
//   workforceDirection: "Document and archive all learnings from this mission.",
//   urgency: "LOW",
//   successDefinition: "Learning events consolidated. Next mission direction decided.",
//   nextMilestone: "Next mission definition or existing mission refinement",
// }
