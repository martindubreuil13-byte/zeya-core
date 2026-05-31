// Example business states for testing and documentation
// Shows what deriveBusinessState outputs for various workflow stages

import { deriveBusinessState } from "./derive-business-state";
import type { BusinessStateInput } from "./derive-business-state";

// ─── Example 1: Fresh Onboarding (No Data) ──────────────────────────────────

export const exampleOnboarding: BusinessStateInput = {
  businessName: undefined,
  missionDetail: undefined,
  targetCustomers: undefined,
  offer: undefined,
  leadSummary: undefined,
};

export const exampleOnboardingState = deriveBusinessState(exampleOnboarding);
// Expected output:
// {
//   currentStage: "ONBOARDING",
//   readinessScore: 0,
//   confidence: 50,
//   blockingReason: "Business profile not yet started",
//   isBlocked: true,
//   currentPriority: "Start business profile",
//   nextAction: "Answer onboarding questions about your business",
//   recommendedConversationObjective: "Gather foundational business information",
//   missingInformation: ["business_name", "mission", "target_customers", "offer", "pain_points", "leads", ...],
//   stageHasData: false,
// }

// ─── Example 2: Mission Definition Stage ────────────────────────────────────

export const exampleMissionDefinition: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: undefined,
  targetCustomers: "B2B SaaS companies",
  offer: "Improve customer acquisition efficiency",
};

export const exampleMissionDefinitionState = deriveBusinessState(exampleMissionDefinition);
// Expected output:
// {
//   currentStage: "MISSION_DEFINITION",
//   readinessScore: 25,
//   blockingReason: "No mission defined for this business",
//   isBlocked: true,
//   currentPriority: "Define sales mission",
//   nextAction: "Define your first sales mission",
//   ...
// }

// ─── Example 3: ICP Definition Stage ────────────────────────────────────────

export const exampleICPDefinition: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "preparing",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: ["opening_message", "objection_handling"],
    next_action: "Upload prospects",
  },
  targetCustomers: undefined, // Missing ICP
  offer: "Reduce customer acquisition costs by 40%",
};

export const exampleICPDefinitionState = deriveBusinessState(exampleICPDefinition);
// Expected output:
// {
//   currentStage: "ICP_DEFINITION",
//   readinessScore: 30,
//   blockingReason: "Target customer profile and/or offer not defined",
//   isBlocked: true,
//   currentPriority: "Define ideal customer profile and core offer",
//   ...
// }

// ─── Example 4: Lead Generation Stage ───────────────────────────────────────

export const exampleLeadGeneration: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "preparing",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Upload prospects",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  leadSummary: undefined, // No leads uploaded
};

export const exampleLeadGenerationState = deriveBusinessState(exampleLeadGeneration);
// Expected output:
// {
//   currentStage: "LEAD_GENERATION",
//   readinessScore: 40,
//   blockingReason: "No leads or prospects uploaded",
//   isBlocked: true,
//   currentPriority: "Upload and organize leads",
//   ...
// }

// ─── Example 5: Lead Review Stage ──────────────────────────────────────────

export const exampleLeadReview: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "preparing",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Select best prospects",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 0, // No leads selected yet
  },
};

export const exampleLeadReviewState = deriveBusinessState(exampleLeadReview);
// Expected output:
// {
//   currentStage: "LEAD_REVIEW",
//   readinessScore: 45,
//   blockingReason: "12 leads available but none selected yet",
//   isBlocked: true,
//   currentPriority: "Review and select best prospects",
//   ...
// }

// ─── Example 6: Call Preparation Stage ─────────────────────────────────────

export const exampleCallPreparation: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "active",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Generate caller brief",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 5, // 5 leads selected
  },
  callerBrief: undefined, // Brief not yet prepared
};

export const exampleCallPreparationState = deriveBusinessState(exampleCallPreparation);
// Expected output:
// {
//   currentStage: "CALL_PREPARATION",
//   readinessScore: 63,
//   blockingReason: "Leads selected but caller brief not prepared",
//   isBlocked: true,
//   currentPriority: "Prepare caller brief with talking points",
//   ...
// }

// ─── Example 7: Workforce Assignment Stage ─────────────────────────────────

export const exampleWorkforceAssignment: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "active",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Assign agent",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 5,
  },
  callerBrief: {
    mission: "Enterprise Outreach Q2",
    targetSegment: "Enterprise SaaS",
    openingAngle: "Cost reduction",
    openingMessage: "I help SaaS companies reduce customer acquisition costs by 40%.",
    likelyObjections: ["We already have a process", "Not the right time"],
    recommendedResponses: {
      "We already have a process": "That's fair. Most teams see ROI within 60 days.",
    },
    successMetric: "Book 3+ discovery calls",
    generatedAt: new Date().toISOString(),
  },
  assignedAgentName: undefined, // Not yet assigned
};

export const exampleWorkforceAssignmentState = deriveBusinessState(exampleWorkforceAssignment);
// Expected output:
// {
//   currentStage: "WORKFORCE_ASSIGNMENT",
//   readinessScore: 73,
//   blockingReason: "Caller brief ready but no agent assigned",
//   isBlocked: true,
//   currentPriority: "Assign caller to the mission",
//   ...
// }

// ─── Example 8: Outreach Execution Stage ───────────────────────────────────

export const exampleOutreachExecution: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "active",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Monitor execution",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 5,
  },
  callerBrief: {
    mission: "Enterprise Outreach Q2",
    targetSegment: "Enterprise SaaS",
    openingAngle: "Cost reduction",
    openingMessage: "I help SaaS companies reduce customer acquisition costs by 40%.",
    likelyObjections: [],
    recommendedResponses: {},
    successMetric: "Book 3+ discovery calls",
    generatedAt: new Date().toISOString(),
  },
  assignedAgentName: "Alice",
  callResults: undefined, // Execution in progress, no results yet
};

export const exampleOutreachExecutionState = deriveBusinessState(exampleOutreachExecution);
// Expected output:
// {
//   currentStage: "OUTREACH_EXECUTION",
//   readinessScore: 81,
//   blockingReason: null,
//   isBlocked: false,
//   currentPriority: "Execute outreach to leads",
//   ...
// }

// ─── Example 9: Result Review Stage ────────────────────────────────────────

export const exampleResultReview: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "active",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Review results",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 5,
  },
  callerBrief: {
    mission: "Enterprise Outreach Q2",
    targetSegment: "Enterprise SaaS",
    openingAngle: "Cost reduction",
    openingMessage: "I help SaaS companies reduce customer acquisition costs by 40%.",
    likelyObjections: [],
    recommendedResponses: {},
    successMetric: "Book 3+ discovery calls",
    generatedAt: new Date().toISOString(),
  },
  assignedAgentName: "Alice",
  callResults: [
    {
      id: "call-1",
      business_id: "biz-1",
      assignment_id: null,
      lead_id: null,
      outcome: "answered",
      interest_level: "medium",
      objection: null,
      follow_up_required: true,
      follow_up_date: null,
      summary: "Good conversation, interested in learning more",
      created_at: new Date().toISOString(),
    },
    {
      id: "call-2",
      business_id: "biz-1",
      assignment_id: null,
      lead_id: null,
      outcome: "voicemail",
      interest_level: null,
      objection: null,
      follow_up_required: false,
      follow_up_date: null,
      summary: "Left voicemail",
      created_at: new Date().toISOString(),
    },
    {
      id: "call-3",
      business_id: "biz-1",
      assignment_id: null,
      lead_id: null,
      outcome: "qualified",
      interest_level: "high",
      objection: null,
      follow_up_required: true,
      follow_up_date: null,
      summary: "Strong fit, ready to move forward",
      created_at: new Date().toISOString(),
    },
  ],
  learningEvents: undefined,
};

export const exampleResultReviewState = deriveBusinessState(exampleResultReview);
// Expected output:
// {
//   currentStage: "RESULT_REVIEW",
//   readinessScore: 87,
//   confidence: high,
//   blockingReason: null,
//   isBlocked: false,
//   currentPriority: "Review call results and outcomes",
//   ...
// }

// ─── Example 10: Optimization Stage (with Learning) ────────────────────────

export const exampleOptimization: BusinessStateInput = {
  businessName: "TechFlow AI",
  missionDetail: {
    name: "Enterprise Outreach Q2",
    status: "active",
    objective: "Test messaging with 10 companies",
    target_segment: "Enterprise SaaS",
    hypothesis: "Will see 30% response rate with new positioning",
    sales_angle: "Cost reduction",
    success_metric: "Book 3+ discovery calls",
    required_inputs: [],
    next_action: "Apply learnings",
  },
  targetCustomers: "Enterprise SaaS companies with 100+ employees",
  offer: "Reduce customer acquisition costs by 40%",
  painPoints: "High CAC, Poor conversion rates",
  leadSummary: {
    total: 12,
    likelyMatch: 5,
    possibleMatch: 4,
    weakMatch: 3,
    selected: 5,
  },
  callerBrief: {
    mission: "Enterprise Outreach Q2",
    targetSegment: "Enterprise SaaS",
    openingAngle: "Cost reduction",
    openingMessage: "I help SaaS companies reduce customer acquisition costs by 40%.",
    likelyObjections: [],
    recommendedResponses: {},
    successMetric: "Book 3+ discovery calls",
    generatedAt: new Date().toISOString(),
  },
  assignedAgentName: "Alice",
  callResults: [
    {
      id: "call-1",
      business_id: "biz-1",
      assignment_id: null,
      lead_id: null,
      outcome: "answered",
      interest_level: "medium",
      objection: null,
      follow_up_required: true,
      follow_up_date: null,
      summary: null,
      created_at: new Date().toISOString(),
    },
  ],
  learningEvents: [
    {
      id: "learn-1",
      business_id: "biz-1",
      mission_key: "Enterprise Outreach Q2",
      learning_type: "message_resonance",
      title: "Cost reduction messaging resonates",
      description: "Opening with cost savings gets 3x engagement",
      confidence: 0.8,
      source_count: 3,
      created_at: new Date().toISOString(),
    },
    {
      id: "learn-2",
      business_id: "biz-1",
      mission_key: "Enterprise Outreach Q2",
      learning_type: "objection_pattern",
      title: "Budget cycle objection common",
      description: "5 of 10 mentions budget planning timing",
      confidence: 0.75,
      source_count: 5,
      created_at: new Date().toISOString(),
    },
    {
      id: "learn-3",
      business_id: "biz-1",
      mission_key: "Enterprise Outreach Q2",
      learning_type: "outcome_pattern",
      title: "Enterprise accounts prefer discovery calls",
      description: "60% of engaged prospects request calls",
      confidence: 0.85,
      source_count: 6,
      created_at: new Date().toISOString(),
    },
  ],
};

export const exampleOptimizationState = deriveBusinessState(exampleOptimization);
// Expected output:
// {
//   currentStage: "OPTIMIZATION",
//   readinessScore: 90,
//   confidence: 85+,
//   blockingReason: null,
//   isBlocked: false,
//   currentPriority: "Extract and apply learnings",
//   recommendedConversationObjective: "Consolidate learnings and plan iteration",
//   ...
// }
