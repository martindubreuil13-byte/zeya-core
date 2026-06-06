// Operational Intelligence Types — Mission-specific guidance generation
// Converts context into execution-ready intelligence

export type OperationalAnalysisIntent =
  | "SALES_FOLLOW_UP"
  | "CUSTOMER_SUCCESS"
  | "RESEARCH"
  | "QUALIFICATION"
  | "BOOKING"
  | "REACTIVATION"
  | "GENERAL";

export type OperationalAnalysisConfidence = "LOW" | "MEDIUM" | "HIGH";

// Core operational intelligence analysis
export interface OperationalIntelligenceAnalysis {
  // Identification
  id: string;
  missionId: string;
  executionRequestId?: string;

  // Intent and confidence
  intent: OperationalAnalysisIntent;
  confidence: OperationalAnalysisConfidence;

  // Context summary
  companyContext: string; // Who is TechCorp/ALPA
  missionContext: string; // What is the mission
  targetContext?: string; // Who is the target

  // Inferred insights
  inferredBusinessModel?: string; // B2B SaaS, marketplace, etc.
  inferredAudience?: string; // Who we're talking to (agency owners, freelancers, etc.)
  inferredTrigger?: string; // What triggered this mission (free trial signup, inactive user, etc.)
  inferredPainPoints: string[]; // What problems the target likely has

  // Execution guidance
  keyTalkingPoints: string[]; // Main points to address
  keyQuestions: string[]; // Mission-specific questions to ask
  objectionGuidance: string[]; // How to handle common objections
  escalationRules: string[]; // When/how to escalate

  // Recommendations
  recommendedTone: string; // Personality/tone guidance
  recommendedWorkerType: "CALLER" | "RESEARCHER" | "OUTREACH" | "SCHEDULER" | "ANALYST";

  // Strategy
  assumptions: string[]; // What we're assuming about the target
  risks: string[]; // Known risks

  // Success definition
  successCriteria: string; // How to measure success

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// Analysis with derived context
export interface OperationalIntelligenceWithContext {
  analysis: OperationalIntelligenceAnalysis;
  targetCount?: number;
  executionMode?: "SINGLE" | "BATCH" | "SEQUENTIAL";
}
