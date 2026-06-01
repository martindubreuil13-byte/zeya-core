// Orchestration Types — Work sequencing and assignment planning
// Deterministic coordination without execution

// ─── Execution Plan ─────────────────────────────────────────────────────────

export type ExecutionPlanStatus = "DRAFT" | "READY" | "BLOCKED" | "IN_PROGRESS" | "COMPLETED";

export interface ExecutionPlan {
  id: string;
  missionId: string;
  businessId: string;

  // Status
  status: ExecutionPlanStatus;
  objective: string; // What we're trying to achieve

  // Work and assignments
  workItems: OrchestratedWorkItem[];
  assignments: PlannedAssignment[];
  blockers: OrchestrationBlocker[];

  // Decision logic
  nextAction: string; // Executive-facing next step
  readiness: number; // 0-100 execution readiness score
  blockerCount: number; // Number of active blockers

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  appliedAt?: string; // When this plan was put into action
}

// ─── Orchestrated Work Item ─────────────────────────────────────────────────

export type WorkItemCategory =
  | "RESEARCH"
  | "OUTREACH"
  | "CALLING"
  | "FOLLOW_UP"
  | "ANALYSIS"
  | "FOUNDER_REVIEW"
  | "ADMIN";

export type WorkItemReadiness = "WAITING" | "READY" | "ASSIGNED" | "BLOCKED" | "DONE";

export interface OrchestratedWorkItem {
  id: string;
  missionId: string;

  // Definition
  title: string;
  description: string;
  category: WorkItemCategory;

  // Priority and status
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: WorkItemReadiness;

  // Requirements and capabilities
  requiredCapabilities: string[]; // e.g., ["calling", "research"]
  estimatedHours?: number;

  // Dependencies
  dependsOn: string[]; // IDs of work items that must complete first
  dependencyMet: boolean; // Are all dependencies satisfied?

  // Assignment
  suggestedAssigneeId?: string;
  blockerIfUnassigned?: string; // Reason why unassigned blocks work

  // Blocking
  blocker?: string; // If status is BLOCKED, why
  blockingAssumption?: string; // What must be true for this to proceed
}

// ─── Planned Assignment ─────────────────────────────────────────────────────

export type AssignmentStatus = "SUGGESTED" | "READY" | "BLOCKED" | "CONFIRMED";

export interface PlannedAssignment {
  id: string;
  workItemId: string;
  assigneeId: string;
  assigneeName: string;
  role: string; // e.g., "CALLER", "RESEARCHER"

  // Planning
  reason: string; // Why this person was suggested
  alternativeAssignees?: string[]; // Other options if primary unavailable
  status: AssignmentStatus;

  // Impact
  assigneeAvailability: number; // 0-100
  assigneeCapacity: number; // 0-100 after this assignment
  capabilityMatch: number; // 0-100 how well skills match
}

// ─── Orchestration Blocker ──────────────────────────────────────────────────

export type BlockerType =
  | "MISSING_DATA"
  | "NO_CAPABILITY"
  | "NO_CAPACITY"
  | "DEPENDENCY_BLOCKED"
  | "MISSION_UNCLEAR"
  | "FOUNDER_DECISION_REQUIRED";

export type BlockerSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface OrchestrationBlocker {
  id: string;
  type: BlockerType;
  message: string; // Human-readable blocker description
  severity: BlockerSeverity;

  // Context
  relatedWorkItemId?: string; // Which work item is blocked
  relatedMissionId?: string;

  // Resolution
  suggestedResolution: string; // What would unblock this
  isResolvable: boolean; // Can be fixed or waiting on external input
}

// ─── Orchestration Input ────────────────────────────────────────────────────

export interface OrchestrationInput {
  missionEvaluation: {
    status: string;
    progress: number;
    confidence: number;
    nextBestAction: string;
  };

  workforceEvaluation: {
    availableMembers: Array<{ id: string; name: string; role: string; capabilities: string[]; currentWorkload: number; status?: string }>;
    assignedMembers: Array<{ id: string; name: string; role?: string; capabilities?: string[]; currentWorkload?: number; status?: string }>;
    readinessScore: number;
    executionBlocked: boolean;
  };

  businessState: {
    currentStage: string;
    blockingReason: string | null;
    isBlocked: boolean;
    dataCompleteness: Record<string, number>;
  };

  executiveGuidance: {
    immediateAction: string;
    blockedUntil?: string;
  };

  conversationObjective?: {
    objectiveType: string;
    completionCriteria: string;
  };

  memoryContext?: {
    selectedLeads?: any[];
    callerBrief?: any;
    callResults?: any[];
  };
}

// ─── Orchestration Summary ──────────────────────────────────────────────────

export interface OrchestrationSummary {
  status: ExecutionPlanStatus;
  readiness: number; // 0-100
  summary: string; // Executive summary
  nextAction: string; // What should happen now
  blockers: Array<{
    message: string;
    severity: BlockerSeverity;
    resolution: string;
  }>;
  suggestedAssignments: Array<{
    workItemTitle: string;
    assigneeName: string;
    reason: string;
  }>;
  readyWork: Array<{
    title: string;
    priority: string;
  }>;
  waitingWork: Array<{
    title: string;
    waitingFor: string;
  }>;
  metadata: {
    workItemCount: number;
    assignedCount: number;
    blockedCount: number;
    readyCount: number;
  };
}
