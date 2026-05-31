// Zeya Workflow Brain v1
// Deterministic business state derivation from context
// Single source of truth for workflow progression

import type { BusinessState, WorkflowStage } from "./types";
import type { LeadSummary } from "@/lib/leads/types";
import type { CallResult, LearningEvent } from "@/types/zeya/learning";
import type { CallerBrief } from "@/lib/mission/caller-brief";
import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";

export interface BusinessStateInput {
  // Profile & identity
  businessName?: string | null;
  businessProfile?: Record<string, unknown> | null;

  // Mission (from business_profile.current_mission_detail)
  missionDetail?: MissionDetail | null;

  // ICP & positioning (from business_profile)
  targetCustomers?: string | null;
  offer?: string | null;
  painPoints?: string | null;

  // Leads & prospects
  leadSummary?: LeadSummary | null;

  // Sales motion
  callerBrief?: CallerBrief | null;

  // Workforce
  assignedAgentName?: string | null;

  // Call history — always array, never null
  callResults?: CallResult[];

  // Learning events — always array, never null
  learningEvents?: LearningEvent[];
}

// ─── Stage Derivation ───────────────────────────────────────────────────────

function deriveWorkflowStage(input: BusinessStateInput): WorkflowStage {
  // Sequential gate logic — first true condition wins

  // Gate 1: Business fundamentals
  if (!input.businessName?.trim()) {
    return "ONBOARDING";
  }

  // Gate 2: Mission defined
  if (!input.missionDetail) {
    return "MISSION_DEFINITION";
  }

  // Gate 3: ICP/positioning defined
  if (!input.targetCustomers?.trim() || !input.offer?.trim()) {
    return "ICP_DEFINITION";
  }

  // Gate 4: Leads uploaded
  const leadCount = input.leadSummary?.total ?? 0;
  if (leadCount === 0) {
    return "LEAD_GENERATION";
  }

  // Gate 5: Leads selected
  const selectedLeadCount = input.leadSummary?.selected ?? 0;
  if (selectedLeadCount === 0) {
    return "LEAD_REVIEW";
  }

  // Gate 6: Caller brief prepared
  if (!input.callerBrief) {
    return "CALL_PREPARATION";
  }

  // Gate 7: Agent assigned
  if (!input.assignedAgentName) {
    return "WORKFORCE_ASSIGNMENT";
  }

  // Gate 8: Calls in progress or completed
  const callCount = input.callResults?.length ?? 0; // Safe: callResults is always array
  if (callCount === 0) {
    return "OUTREACH_EXECUTION";
  }

  // Gate 9: Results to review OR we have learning events (optimization)
  const learningCount = input.learningEvents?.length ?? 0;
  if (learningCount > 0) {
    return "OPTIMIZATION";
  }

  return "RESULT_REVIEW";
}

// ─── Readiness Scoring ──────────────────────────────────────────────────────

function deriveReadinessScore(input: BusinessStateInput): number {
  let score = 0;

  // Business fundamentals
  if (input.businessName?.trim()) score += 10;
  if (input.businessProfile) score += 5;

  // Mission definition
  if (input.missionDetail) score += 15;

  // ICP & positioning
  if (input.targetCustomers?.trim()) score += 10;
  if (input.offer?.trim()) score += 10;
  if (input.painPoints?.trim()) score += 5;

  // Leads & prospects
  const leadCount = input.leadSummary?.total ?? 0;
  if (leadCount >= 5) score += 10;
  else if (leadCount > 0) score += 5;

  // Lead selection
  const selectedLeadCount = input.leadSummary?.selected ?? 0;
  if (selectedLeadCount >= 3) score += 8;
  else if (selectedLeadCount > 0) score += 4;

  // Sales motion
  if (input.callerBrief) score += 10;

  // Workforce
  if (input.assignedAgentName) score += 8;

  // Execution
  const callCount = input.callResults?.length ?? 0;
  if (callCount >= 3) score += 12;
  else if (callCount > 0) score += 6;

  // Learning
  const learningCount = input.learningEvents?.length ?? 0;
  if (learningCount >= 3) score += 7;
  else if (learningCount > 0) score += 3;

  return Math.min(100, score);
}

// ─── Blocking & Priority Derivation ─────────────────────────────────────────

function deriveBlockingReason(stage: WorkflowStage, input: BusinessStateInput): string | null {
  const blockers: Record<WorkflowStage, () => string | null> = {
    ONBOARDING: () => "Business profile not yet started",
    MISSION_DEFINITION: () => "No mission defined for this business",
    ICP_DEFINITION: () => "Target customer profile and/or offer not defined",
    LEAD_GENERATION: () => "No leads or prospects uploaded",
    LEAD_REVIEW: () => `${input.leadSummary?.total ?? 0} leads available but none selected yet`,
    CALL_PREPARATION: () => "Leads selected but caller brief not prepared",
    WORKFORCE_ASSIGNMENT: () => "Caller brief ready but no agent assigned",
    OUTREACH_EXECUTION: () => null,
    RESULT_REVIEW: () => null,
    OPTIMIZATION: () => null,
  };

  return blockers[stage]?.() ?? null;
}

function derivePriority(stage: WorkflowStage): string {
  const priorities: Record<WorkflowStage, string> = {
    ONBOARDING: "Start business profile",
    MISSION_DEFINITION: "Define sales mission",
    ICP_DEFINITION: "Define ideal customer profile and core offer",
    LEAD_GENERATION: "Upload and organize leads",
    LEAD_REVIEW: "Review and select best prospects",
    CALL_PREPARATION: "Prepare caller brief with talking points",
    WORKFORCE_ASSIGNMENT: "Assign caller to the mission",
    OUTREACH_EXECUTION: "Execute outreach to leads",
    RESULT_REVIEW: "Review call results and outcomes",
    OPTIMIZATION: "Extract and apply learnings",
  };

  return priorities[stage] ?? "Continue workflow";
}

function deriveNextAction(stage: WorkflowStage): string {
  const actions: Record<WorkflowStage, string> = {
    ONBOARDING: "Answer onboarding questions about your business",
    MISSION_DEFINITION: "Define your first sales mission",
    ICP_DEFINITION: "Describe your ideal customer and core offer",
    LEAD_GENERATION: "Upload leads (CSV, paste, or manual)",
    LEAD_REVIEW: "Mark 3–5 strongest prospects as selected",
    CALL_PREPARATION: "Generate caller brief for this mission",
    WORKFORCE_ASSIGNMENT: "Assign an agent to handle outreach",
    OUTREACH_EXECUTION: "Monitor ongoing outreach and calls",
    RESULT_REVIEW: "Review call outcomes and feedback",
    OPTIMIZATION: "Apply learnings to next mission iteration",
  };

  return actions[stage] ?? "Next step not determined";
}

function deriveConversationObjective(stage: WorkflowStage): string {
  const objectives: Record<WorkflowStage, string> = {
    ONBOARDING: "Gather foundational business information",
    MISSION_DEFINITION: "Understand sales goals and mission focus",
    ICP_DEFINITION: "Refine target customer and positioning",
    LEAD_GENERATION: "Organize and prepare lead list",
    LEAD_REVIEW: "Evaluate prospects and select best fits",
    CALL_PREPARATION: "Prepare sales motion and talking points",
    WORKFORCE_ASSIGNMENT: "Brief agent on mission and expectations",
    OUTREACH_EXECUTION: "Monitor execution and gather feedback",
    RESULT_REVIEW: "Debrief on call results and outcomes",
    OPTIMIZATION: "Consolidate learnings and plan iteration",
  };

  return objectives[stage] ?? "Advance workflow";
}

// ─── Missing Information Derivation ─────────────────────────────────────────

function deriveMissingInformation(input: BusinessStateInput, stage: WorkflowStage): string[] {
  const missing: string[] = [];

  // Core business
  if (!input.businessName?.trim()) missing.push("business_name");
  if (!input.missionDetail) missing.push("mission");

  // ICP & offer
  if (!input.targetCustomers?.trim()) missing.push("target_customers");
  if (!input.offer?.trim()) missing.push("offer");
  if (!input.painPoints?.trim()) missing.push("pain_points");

  // Leads
  const leadCount = input.leadSummary?.total ?? 0;
  if (leadCount === 0) missing.push("leads");
  else if (leadCount < 5) missing.push("leads (insufficient_count)");

  const selectedCount = input.leadSummary?.selected ?? 0;
  if (selectedCount === 0 && leadCount > 0) missing.push("selected_leads");

  // Sales motion
  if (!input.callerBrief) missing.push("caller_brief");

  // Workforce
  if (!input.assignedAgentName) missing.push("assigned_agent");

  // Learning
  if ((input.callResults?.length ?? 0) === 0 && stage !== "ONBOARDING") {
    missing.push("call_results");
  }

  return missing;
}

// ─── Data Completeness by Component ─────────────────────────────────────────

function deriveDataCompleteness(input: BusinessStateInput): Record<string, number> {
  const completeness: Record<string, number> = {};

  // Business profile (0-100)
  let profileScore = 0;
  if (input.businessName?.trim()) profileScore += 50;
  if (input.businessProfile) profileScore += 25;
  if (input.missionDetail) profileScore += 25;
  completeness.business = Math.min(100, profileScore);

  // ICP definition (0-100)
  let icpScore = 0;
  if (input.targetCustomers?.trim()) icpScore += 40;
  if (input.offer?.trim()) icpScore += 40;
  if (input.painPoints?.trim()) icpScore += 20;
  completeness.icp = Math.min(100, icpScore);

  // Leads management (0-100)
  let leadsScore = 0;
  const leadCount = input.leadSummary?.total ?? 0;
  const selectedCount = input.leadSummary?.selected ?? 0;
  if (leadCount >= 5) leadsScore += 50;
  else if (leadCount > 0) leadsScore += 25;
  if (selectedCount >= 3) leadsScore += 50;
  else if (selectedCount > 0) leadsScore += 25;
  completeness.leads = Math.min(100, leadsScore);

  // Sales motion (0-100)
  completeness.sales_motion = input.callerBrief ? 100 : 0;

  // Workforce (0-100)
  completeness.workforce = input.assignedAgentName ? 100 : 0;

  // Execution (0-100)
  let executionScore = 0;
  const callCount = input.callResults?.length ?? 0;
  if (callCount >= 5) executionScore += 100;
  else if (callCount >= 3) executionScore += 75;
  else if (callCount > 0) executionScore += 50;
  completeness.execution = executionScore;

  // Learning (0-100)
  let learningScore = 0;
  const learningCount = input.learningEvents?.length ?? 0;
  if (learningCount >= 3) learningScore += 100;
  else if (learningCount > 0) learningScore += 50;
  completeness.learning = learningScore;

  return completeness;
}

// ─── Confidence Scoring ──────────────────────────────────────────────────────

function deriveConfidence(input: BusinessStateInput, stage: WorkflowStage): number {
  // Confidence reflects how complete Zeya's understanding is
  // High when: lots of data, multiple sources, consistent signals
  // Low when: minimal data, gaps, many assumptions

  let confidence = 50; // baseline

  // Bonus for multiple data sources
  const dataPoints = [
    input.businessName,
    input.missionDetail,
    input.targetCustomers,
    input.offer,
    input.leadSummary,
    input.callerBrief,
    input.assignedAgentName,
  ].filter(Boolean).length;

  confidence += (dataPoints / 7) * 20; // +0-20 for data breadth

  // Bonus for depth at current stage
  if (stage === "RESULT_REVIEW" || stage === "OPTIMIZATION") {
    const callCount = input.callResults?.length ?? 0;
    confidence += Math.min(20, callCount * 2); // More calls = more confidence
  } else if (stage === "CALL_PREPARATION" || stage === "WORKFORCE_ASSIGNMENT") {
    if (input.leadSummary?.selected ?? 0 >= 3) confidence += 15;
  } else if (stage === "LEAD_REVIEW") {
    if ((input.leadSummary?.total ?? 0) >= 5) confidence += 15;
  }

  // Penalty for major gaps
  const missing = deriveMissingInformation(input, stage);
  if (missing.length > 3) confidence -= 10;

  return Math.max(0, Math.min(100, confidence));
}

// ─── Main Export ────────────────────────────────────────────────────────────

export function deriveBusinessState(input: BusinessStateInput): BusinessState {
  const stage = deriveWorkflowStage(input);
  const readinessScore = deriveReadinessScore(input);
  const blockingReason = deriveBlockingReason(stage, input);
  const missingInformation = deriveMissingInformation(input, stage);
  const dataCompleteness = deriveDataCompleteness(input);

  return {
    currentStage: stage,
    readinessScore,
    confidence: deriveConfidence(input, stage),
    blockingReason,
    isBlocked: blockingReason !== null,
    currentPriority: derivePriority(stage),
    nextAction: deriveNextAction(stage),
    recommendedConversationObjective: deriveConversationObjective(stage),
    missingInformation,
    stageHasData: Object.values(dataCompleteness).some((score) => score > 0),
    dataCompleteness,
  };
}
