// ExecutionPlan Types — Operational planning between Mission and WorkerBrief
// ExecutionPlan: HOW Zeya intends to run the operation
// ExecutionPlanStep: Individual steps (one per target or generic)

// ─── Status ─────────────────────────────────────────────────────────────────

export type ExecutionPlanStatus =
  | "DRAFT"
  | "READY"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

// ─── Priority ───────────────────────────────────────────────────────────────

export type ExecutionPlanPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

// ─── Mode ───────────────────────────────────────────────────────────────────
// How the plan should be executed

export type ExecutionPlanMode =
  | "SINGLE" // One target only
  | "BATCH" // Multiple targets, all at once
  | "SEQUENTIAL" // Multiple targets, one after another
  | "PARALLEL"; // Multiple targets, concurrent (future)

// ─── Step Status ────────────────────────────────────────────────────────────

export type ExecutionPlanStepStatus =
  | "PENDING"
  | "READY"
  | "DISPATCHED"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

// ─── Execution Plan Step ────────────────────────────────────────────────────
// Individual action within a plan (one per target or generic)

export interface ExecutionPlanStep {
  // Identification
  id: string;
  planId: string;
  stepNumber: number; // 1-indexed order

  // Worker assignment
  workerType: "CALLER" | "RESEARCHER" | "OUTREACH" | "SCHEDULER" | "ANALYST";
  workerName?: string; // e.g., "Veya"

  // Objective and outcome
  objective: string; // What to accomplish in this step
  target?: string; // Lead/prospect identifier (name, email, phone)
  leadContext?: string; // Specific context about this target
  desiredOutcome: string; // What success looks like for this step

  // Status
  status: ExecutionPlanStepStatus;

  // Dependencies
  dependencies: string[]; // IDs of steps that must complete first

  // Scheduling
  scheduledFor?: string; // ISO timestamp, when this step should run

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// ─── Execution Plan ─────────────────────────────────────────────────────────
// Complete operational plan for a mission

export interface ExecutionPlan {
  // Identification
  id: string;
  missionId: string;
  executionRequestId?: string; // Reference to parent execution request

  // Definition
  title: string; // Human-readable plan name
  status: ExecutionPlanStatus;
  priority: ExecutionPlanPriority;
  mode: ExecutionPlanMode; // SINGLE, BATCH, SEQUENTIAL, PARALLEL

  // Context
  companyContext: string; // Who is being contacted
  missionObjective: string; // What the mission intends to accomplish
  desiredOutcome: string; // Overall desired outcome

  // Scale
  totalTargets?: number; // How many targets/leads this plan covers

  // Steps
  plannedSteps: ExecutionPlanStep[]; // One per target, or one generic step

  // Strategy
  assumptions: string[]; // What we're assuming to be true
  risks: string[]; // Known risks and mitigation
  successCriteria: string; // How to measure overall success

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// ─── Execution Plan with Dispatch State ──────────────────────────────────────
// Plan after dispatch, including results

export interface ExecutionPlanWithDispatch {
  plan: ExecutionPlan;
  dispatchedSteps: ExecutionPlanStep[]; // Steps that were dispatched
  dispatchedAt: string; // ISO timestamp
  totalStepsDispatched: number;
  successfulDispatches: number;
}
