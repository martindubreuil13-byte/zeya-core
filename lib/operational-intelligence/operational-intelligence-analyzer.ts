// Operational Intelligence Analyzer — Generate mission-specific guidance

import type {
  OperationalIntelligenceAnalysis,
  OperationalAnalysisIntent,
  OperationalAnalysisConfidence,
} from "./operational-intelligence-types";

function generateId(): string {
  return `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export interface AnalyzerInput {
  missionId: string;
  executionRequestId?: string;
  companyContext: string;
  missionContext: string;
  targetContext?: string;
  desiredOutcome: string;
  knownMemory?: string[]; // Previous context about the target
  intent?: OperationalAnalysisIntent; // Can override inference
}

function inferIntent(missionContext: string, targetContext?: string): {
  intent: OperationalAnalysisIntent;
  confidence: OperationalAnalysisConfidence;
} {
  const fullContext = `${missionContext} ${targetContext || ""}`.toLowerCase();

  // Deterministic intent inference rules
  if (
    fullContext.includes("free trial") ||
    fullContext.includes("downloaded") ||
    fullContext.includes("not upgraded") ||
    fullContext.includes("follow up")
  ) {
    return { intent: "SALES_FOLLOW_UP", confidence: "HIGH" };
  }

  if (
    fullContext.includes("inactive") ||
    fullContext.includes("past customer") ||
    fullContext.includes("reactivate") ||
    fullContext.includes("reconnect")
  ) {
    return { intent: "REACTIVATION", confidence: "HIGH" };
  }

  if (fullContext.includes("qualify") || fullContext.includes("qualification")) {
    return { intent: "QUALIFICATION", confidence: "HIGH" };
  }

  if (
    fullContext.includes("book") ||
    fullContext.includes("schedule") ||
    fullContext.includes("appointment")
  ) {
    return { intent: "BOOKING", confidence: "HIGH" };
  }

  if (
    fullContext.includes("research") ||
    fullContext.includes("gather information") ||
    fullContext.includes("survey")
  ) {
    return { intent: "RESEARCH", confidence: "HIGH" };
  }

  if (fullContext.includes("customer success") || fullContext.includes("onboarding")) {
    return { intent: "CUSTOMER_SUCCESS", confidence: "HIGH" };
  }

  return { intent: "GENERAL", confidence: "MEDIUM" };
}

function generateGuidanceForSalesFollowUp(
  targetContext?: string
): Pick<
  OperationalIntelligenceAnalysis,
  | "keyQuestions"
  | "objectionGuidance"
  | "escalationRules"
  | "keyTalkingPoints"
  | "inferredPainPoints"
> {
  return {
    keyTalkingPoints: [
      "Value delivered by the product (leads, time savings, etc.)",
      "Specific benefits for their business model",
      "Success stories or use cases similar to theirs",
      "Limited time offer or next steps in the journey",
    ],
    keyQuestions: [
      "Did you get a chance to review and use what you downloaded/tried?",
      "Were the leads or results relevant to your business?",
      "Did you find any leads or opportunities that worked out?",
      "What's your current process for finding new clients or leads?",
      "What would need to be different for you to move forward?",
      "If I could show you results from similar businesses, would that be helpful?",
    ],
    objectionGuidance: [
      "Not enough time: 'I understand you're busy. The good news is this is designed to save time. Would it help if I showed you specific results in 5 minutes?'",
      "Unsure about quality: 'That's a fair concern. Let's talk about which types of leads would be most valuable to you, and I can show you if we deliver on that.'",
      "Price/budget: 'I get that budget is tight. Many started small and scaled up once they saw results. Would it make sense to test on a limited basis first?'",
      "Already has a solution: 'What are you currently using? I'd love to understand what's working and what's not, because we might fill some gaps.'",
      "Needs to test more: 'Fair point. What would a successful test look like to you? How many leads would you need to see?'",
      "No need right now: 'Understood. When is the right time? I'd like to circle back when you're actively looking to scale.'",
    ],
    escalationRules: [
      "If they express strong buying interest or ask about pricing/details → escalate to sales team immediately",
      "If they request a demo or trial → offer immediate scheduling with demo specialist",
      "If they mention team-wide usage or company-wide implications → escalate to account manager",
      "If they ask to speak with founder, CEO, or leadership → note for escalation",
      "If they mention large budget or enterprise needs → flag as high-value opportunity",
    ],
    inferredPainPoints: [
      "Not finding enough qualified leads or prospects",
      "Lead generation taking too much time or money",
      "Difficulty scaling their client acquisition",
      "Uncertain about ROI of tools they've tried",
      "No clear system for lead qualification",
      "Overwhelmed by too many low-quality leads",
    ],
  };
}

function generateGuidanceForReactivation(): Pick<
  OperationalIntelligenceAnalysis,
  | "keyQuestions"
  | "objectionGuidance"
  | "escalationRules"
  | "keyTalkingPoints"
  | "inferredPainPoints"
> {
  return {
    keyTalkingPoints: [
      "Updates since they last used the product",
      "New features or improvements",
      "Success stories from similar customers",
      "Special reactivation offers or incentives",
      "Ease of getting started again",
    ],
    keyQuestions: [
      "How long has it been since you used our service?",
      "What was the main reason you paused or stopped using it?",
      "Has anything changed in your business or needs since then?",
      "Are you still facing the same challenges you had before?",
      "Would it help to know what's new since you last used us?",
    ],
    objectionGuidance: [
      "Found another solution: 'What are they doing well? We've improved a lot since you last tried us. Would it be worth a 15-minute comparison?'",
      "Too expensive: 'We've restructured pricing. Let me show you the updated options.'",
      "Not enough time: 'I understand. What if I could catch you up in 10 minutes and show you the main improvements?'",
      "No longer relevant: 'I'm curious — has your business model changed? Our product might be even better for where you are now.'",
    ],
    escalationRules: [
      "If they express interest in reactivating → immediate handoff to account manager",
      "If they mention pricing concerns but interest → escalate to sales for special reactivation offer",
      "If they want to try again → fast-track them to onboarding team",
    ],
    inferredPainPoints: [
      "Tried a solution but it didn't work out",
      "Budget constraints at the time",
      "Not enough immediate results",
      "Complexity of implementation or use",
      "Found a different solution they prefer",
    ],
  };
}

function generateGuidanceForQualification(): Pick<
  OperationalIntelligenceAnalysis,
  | "keyQuestions"
  | "objectionGuidance"
  | "escalationRules"
  | "keyTalkingPoints"
  | "inferredPainPoints"
> {
  return {
    keyTalkingPoints: [
      "Product fit for their specific use case",
      "Key capabilities that match their needs",
      "Typical implementation timeline",
      "ROI or success metrics",
    ],
    keyQuestions: [
      "Can you walk me through your current process for [relevant area]?",
      "What's your biggest challenge in this area right now?",
      "How many people on your team deal with this?",
      "What would an ideal solution look like for you?",
      "What's your timeline for making a decision?",
      "Who else should be involved in this decision?",
    ],
    objectionGuidance: [
      "Not interested: 'I hear you. Just curious — if you were to solve [pain point], what would be most important?'",
      "Need to think about it: 'Totally fair. What questions would help you make a decision?'",
      "Wrong person/department: 'Who would be the best person to talk to about this? I'd like to loop them in.'",
    ],
    escalationRules: [
      "If they express strong fit and interest → immediately escalate to sales",
      "If they want to schedule a discovery call → hand to sales team",
      "If they ask detailed feature questions → escalate to product specialist",
    ],
    inferredPainPoints: [
      "Uncertainty about product fit",
      "Multiple stakeholders with different opinions",
      "Concerns about implementation effort",
      "Budget allocation questions",
    ],
  };
}

function generateGuidanceForBooking(): Pick<
  OperationalIntelligenceAnalysis,
  | "keyQuestions"
  | "objectionGuidance"
  | "escalationRules"
  | "keyTalkingPoints"
  | "inferredPainPoints"
> {
  return {
    keyTalkingPoints: [
      "Specific value of the scheduled interaction",
      "Who will be on the call and their expertise",
      "What will be covered",
      "Expected outcome or next steps",
      "Preparation steps they should take",
    ],
    keyQuestions: [
      "Would this week or next week work better for you?",
      "What time of day works best?",
      "How much time should we block off?",
      "Who else should be on the call?",
      "What would be most helpful to cover during the call?",
    ],
    objectionGuidance: [
      "Too busy: 'I get it. How about we pick a specific time when things calm down? Even 20 minutes?'",
      "Not sure what we'd discuss: 'Here's what we'd cover... Would that be valuable?'",
      "Need to check calendar: 'Sure! I can send you a calendar link and you can pick what works.'",
    ],
    escalationRules: [
      "If they book → immediate confirmation and prep for the scheduled expert",
      "If they hesitate → escalate to closing specialist",
      "If they want to schedule multiple calls → escalate to customer success",
    ],
    inferredPainPoints: [
      "Uncertainty about time commitment",
      "Not sure if it's worth attending",
      "Scheduling logistics",
    ],
  };
}

export function analyzeOperationalMission(input: AnalyzerInput): OperationalIntelligenceAnalysis {
  const now = new Date().toISOString();

  // Infer or use provided intent
  const { intent, confidence } =
    input.intent && input.intent !== "GENERAL"
      ? { intent: input.intent, confidence: "HIGH" as const }
      : inferIntent(input.missionContext, input.targetContext);

  // Generate guidance based on intent
  let guidance;
  let tone = "Professional, consultative";

  if (intent === "SALES_FOLLOW_UP") {
    guidance = generateGuidanceForSalesFollowUp(input.targetContext);
    tone = "Friendly, curious, solution-oriented";
  } else if (intent === "REACTIVATION") {
    guidance = generateGuidanceForReactivation();
    tone = "Warm, understanding, forward-looking";
  } else if (intent === "QUALIFICATION") {
    guidance = generateGuidanceForQualification();
    tone = "Professional, discovery-focused";
  } else if (intent === "BOOKING") {
    guidance = generateGuidanceForBooking();
    tone = "Efficient, helpful, action-oriented";
  } else {
    guidance = {
      keyTalkingPoints: ["Value proposition"],
      keyQuestions: [
        "What is your current situation?",
        "What are your main challenges?",
        "What would success look like?",
      ],
      objectionGuidance: ["Listen actively and ask clarifying questions"],
      escalationRules: ["Escalate if high-level stakeholder requests"],
      inferredPainPoints: ["Unknown pain points"],
    };
  }

  const analysis: OperationalIntelligenceAnalysis = {
    id: generateId(),
    missionId: input.missionId,
    executionRequestId: input.executionRequestId,
    intent,
    confidence,
    companyContext: input.companyContext,
    missionContext: input.missionContext,
    targetContext: input.targetContext,
    inferredTrigger: extractTrigger(input.missionContext, input.targetContext),
    ...guidance,
    recommendedTone: tone,
    recommendedWorkerType: "CALLER",
    assumptions: [
      "Target has capacity to take a call",
      "The inferred pain point is relevant to this target",
      "Target would benefit from the conversation",
    ],
    risks: [
      "Target may not remember downloading/trying the product",
      "Decision makers may not be available",
      "Call may be interrupted by urgent business",
    ],
    successCriteria: input.desiredOutcome,
    createdAt: now,
    updatedAt: now,
  };

  return analysis;
}

function extractTrigger(missionContext: string, targetContext?: string): string | undefined {
  const fullContext = `${missionContext} ${targetContext || ""}`.toLowerCase();

  if (fullContext.includes("free trial")) return "Free trial signup";
  if (fullContext.includes("downloaded")) return "Lead download";
  if (fullContext.includes("not upgraded")) return "Not converted to paid";
  if (fullContext.includes("inactive")) return "User inactivity";
  if (fullContext.includes("past customer")) return "Lapsed customer";

  return undefined;
}
