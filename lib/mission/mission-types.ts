// Mission Types — Outcome-aware mission tracking
// Missions represent hypotheses to validate, not just workflow stages

// ─── Mission Status ──────────────────────────────────────────────────────────

export type MissionStatus =
  | "NOT_STARTED"    // Mission defined but no activity
  | "ACTIVE"         // Started but insufficient evidence
  | "VALIDATING"     // Evidence accumulating
  | "CONFIRMED"      // Hypothesis supported
  | "FAILED"         // Hypothesis disproven
  | "PAUSED";        // Intentionally paused

// ─── Mission Definition ──────────────────────────────────────────────────────

export interface Mission {
  id: string;
  businessId: string;

  // Core definition
  title: string;
  hypothesis: string; // What we're trying to prove/validate
  description?: string;

  // Status and progress
  status: MissionStatus;
  progress: number; // 0-100: how far along
  confidence: number; // 0-100: how certain we are
  evidenceCount: number; // Number of evidence points collected

  // Success definition
  successCriteria: string[]; // What would make this mission successful
  targetOutcome: string; // What we want to achieve
  blockingAssumptions: string[]; // What assumptions must hold

  // Findings and questions
  findings: string[]; // What we've learned so far
  openQuestions: string[]; // What we still need to know
  risks: string[]; // Potential blockers or concerns

  // Timeline
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  targetCompletionDate?: string; // When we want this done
  completedAt?: string; // When it finished

  // Metadata
  priority: "low" | "medium" | "high";
  tags?: string[]; // e.g., ["pricing", "market-fit", "channel"]
}

// ─── Evidence ───────────────────────────────────────────────────────────────

export interface Evidence {
  id: string;
  missionId: string;
  type: EvidenceType;
  source: EvidenceSource;
  statement: string; // What the evidence shows
  strength: "weak" | "moderate" | "strong"; // How well-supported
  frequency: number; // How many times observed (for patterns)
  recordedAt: string; // ISO timestamp
  relatedEventIds: string[]; // Links to memory events, call results, etc.
}

export type EvidenceType =
  | "OBJECTION" // Customer mentioned concern
  | "SUCCESS" // Customer showed positive signal
  | "PATTERN" // Observed in multiple conversations
  | "METRIC" // Quantitative result
  | "FEEDBACK" // Direct founder input
  | "LEARNING" // System-derived insight
  | "TEST_RESULT" // Outcome of deliberate test
  | "MARKET_SIGNAL"; // External market data

export type EvidenceSource =
  | "CALL_RESULT"
  | "CONVERSATION"
  | "MEMORY_EVENT"
  | "LEARNING_EVENT"
  | "FOUNDER_INPUT"
  | "SYSTEM_INFERENCE";

// ─── Mission Evaluation ──────────────────────────────────────────────────────

export interface MissionEvaluation {
  missionId: string;
  status: MissionStatus;
  progress: number;
  confidence: number;
  evidenceCount: number;
  evidenceBreakdown: {
    supporting: number;
    contradicting: number;
    neutral: number;
  };
  findings: string[];
  openQuestions: string[];
  risks: string[];
  nextBestAction: string;
  recommendedPriority: "low" | "medium" | "high";
  statusReason: string; // Why it has this status
}

// ─── Mission Progress ────────────────────────────────────────────────────────

export interface MissionProgress {
  progress: number; // 0-100
  progressStage: ProgressStage;
  evidenceCount: number;
  evidenceRequired: number; // How much needed for next stage
  confidence: number; // 0-100
  confidenceFactors: {
    evidenceQuantity: number; // 0-100
    evidenceQuality: number; // 0-100
    evidenceDiversity: number; // 0-100
    consistency: number; // 0-100
  };
}

export type ProgressStage =
  | "NO_DATA"
  | "INITIAL_EVIDENCE"
  | "ACCUMULATING"
  | "SUBSTANTIAL"
  | "COMPREHENSIVE";

// ─── Mission Finding ────────────────────────────────────────────────────────

export interface MissionFinding {
  id: string;
  statement: string; // What we found
  confidence: number; // 0-100
  evidencePoints: number; // How many evidence items support this
  relatedMissions: string[]; // Other missions affected by this finding
}

// ─── Mission Outcome ────────────────────────────────────────────────────────

export interface MissionOutcome {
  missionId: string;
  final: boolean; // Is this the final outcome?
  status: MissionStatus;
  findings: MissionFinding[];
  conclusion: string; // Executive summary
  implicationsForBusiness: string[]; // How this changes our approach
  relatedMissions: string[]; // Other missions affected
  completedAt: string; // ISO timestamp
}

// ─── Mission Query ───────────────────────────────────────────────────────────

export interface MissionQuery {
  businessId: string;
  status?: MissionStatus;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  since?: string; // ISO timestamp
}

export interface MissionQueryResult {
  missions: Mission[];
  total: number;
  activeCount: number;
  successCount: number;
  failureCount: number;
}
