// Phase 10 — Autonomous Operating Loop types

import type { BusinessState } from "@/lib/workflow/types";
import type { ExecutiveGuidance } from "@/lib/workflow/derive-executive-guidance";
import type { ConversationObjective } from "@/lib/workflow/conversation-objective-types";
import type { BusinessStateInput } from "@/lib/workflow/derive-business-state";
import type { MissionEvaluation } from "@/lib/mission/mission-types";
import type { Mission, Evidence } from "@/lib/mission/mission-types";
import type { WorkforceEvaluation } from "@/lib/workforce/workforce-types";
import type { WorkforceMember, WorkItem } from "@/lib/workforce/workforce-types";
import type { ExecutionPlan } from "@/lib/orchestration/orchestration-types";
import type { MemoryEvent } from "@/lib/memory/memory-types";

// Event type enumeration
export type AutonomyEventType =
  | "BUSINESS_PROFILE_UPDATED"
  | "MEMORY_EVENT_ADDED"
  | "LEARNING_EVENT_ADDED"
  | "MISSION_UPDATED"
  | "MISSION_STATUS_CHANGED"
  | "WORKFORCE_MEMBER_ADDED"
  | "WORKFORCE_MEMBER_UPDATED"
  | "WORK_ITEM_CREATED"
  | "WORK_ITEM_ASSIGNED"
  | "WORK_ITEM_COMPLETED"
  | "CALL_RESULT_ADDED"
  | "FOUNDER_FEEDBACK_RECEIVED"
  | "EXECUTION_PLAN_UPDATED";

// Event structure
export interface AutonomyEvent {
  type: AutonomyEventType;
  businessId: string;
  missionId?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

// System names that can change
export type SystemName = "WORKFLOW" | "MISSION" | "WORKFORCE" | "EXECUTION_PLAN";

// Describes what changed in response to an event
export interface SystemChangeMap {
  changedSystems: SystemName[];
  requiresWorkflowRefresh: boolean;
  requiresMissionRefresh: boolean;
  requiresWorkforceRefresh: boolean;
  requiresExecutionPlanRefresh: boolean;
  reason: string;
}

// Context needed to re-run all engines
export interface ReevaluationContext {
  businessId: string;
  missionId: string;
  businessStateInput: BusinessStateInput;
  mission: Mission | null;
  evidence: Evidence[];
  workforceMembers: WorkforceMember[];
  workItems: WorkItem[];
  memoryEvents: MemoryEvent[];
}

// Operating health assessment
export interface OperatingHealth {
  score: number; // 0-100
  status: "HEALTHY" | "AT_RISK" | "CRITICAL";
  workflowScore: number;
  missionScore: number;
  workforceScore: number;
  executionScore: number;
}

// Blocker aggregated from all systems
export interface OperatingBlocker {
  source: "WORKFLOW" | "MISSION" | "WORKFORCE" | "EXECUTION_PLAN";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  resolutionHint: string;
}

// Highest-level view of Zeya's operating environment
export interface OperatingState {
  businessId: string;
  missionId: string;
  businessState: BusinessState;
  executiveGuidance: ExecutiveGuidance;
  conversationObjective: ConversationObjective;
  missionEvaluation: MissionEvaluation;
  workforceEvaluation: WorkforceEvaluation;
  executionPlan: ExecutionPlan;
  operatingHealth: OperatingHealth;
  blockers: OperatingBlocker[];
  nextAction: string;
  readiness: number; // 0-100
  lastUpdated: string;
  lastEventType?: AutonomyEventType;
  changedSystems?: SystemName[];
}

// Executive-facing summary
export interface AutonomySummary {
  health: OperatingHealth;
  readiness: number;
  blockers: OperatingBlocker[];
  nextAction: string;
  changedSystems: SystemName[];
  recommendations: string[];
  executiveSummary: string;
  generatedAt: string;
}
