// Workforce Types — Understanding workforce capacity and readiness
// Workforce awareness: who is available, what role, what is assigned, what is blocked

// ─── Workforce Member ───────────────────────────────────────────────────────

export type WorkforceRole = "CALLER" | "RESEARCHER" | "COPYWRITER" | "STRATEGIST" | "OPERATOR" | "CUSTOM";

export type WorkforceMemberStatus = "AVAILABLE" | "ASSIGNED" | "BUSY" | "BLOCKED" | "INACTIVE";

export interface WorkforceMember {
  // Identification
  id: string;
  businessId: string;
  name: string;

  // Role and capabilities
  role: WorkforceRole;
  capabilities: string[]; // e.g., ["cold_outreach", "follow_up", "research"]
  specialization?: string; // e.g., "B2B SaaS founders"

  // Current status
  status: WorkforceMemberStatus;
  assignedMissionId?: string; // What mission they're working on
  assignedTaskId?: string; // What specific task
  currentWorkload: number; // 0-100, how busy they are

  // Metadata
  notes?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  lastActiveAt?: string;
}

// ─── Work Item ──────────────────────────────────────────────────────────────

export type WorkItemType = "RESEARCH" | "CALLING" | "OUTREACH" | "FOLLOW_UP" | "ANALYSIS" | "ADMIN" | "CUSTOM";

export type WorkItemStatus = "READY" | "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "DONE";

export interface WorkItem {
  // Identification
  id: string;
  missionId: string; // Which mission this supports
  businessId: string;

  // Definition
  title: string;
  description: string;
  type: WorkItemType;

  // Status
  status: WorkItemStatus;
  assignedTo?: string; // WorkforceMember ID
  priority: "low" | "medium" | "high";

  // Dependencies
  blocker?: string; // Reason why blocked (if status is BLOCKED)
  dependsOnWorkItemId?: string; // What must complete first
  requiredCapabilities: string[]; // What capabilities are needed

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  dueDate?: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  estimatedHours?: number;
  actualHours?: number;
}

// ─── Workforce State ────────────────────────────────────────────────────────

export interface WorkforceState {
  // Members by status
  availableMembers: WorkforceMember[];
  assignedMembers: WorkforceMember[];
  busyMembers: WorkforceMember[];
  blockedMembers: WorkforceMember[];

  // Work items by status
  readyWorkItems: WorkItem[];
  assignedWorkItems: WorkItem[];
  inProgressWorkItems: WorkItem[];
  blockedWorkItems: WorkItem[];
  completedWorkItems: WorkItem[];

  // Overall metrics
  totalMembers: number;
  totalWorkItems: number;
  averageWorkload: number; // 0-100

  // Readiness
  workforceReadiness: number; // 0-100
  executionReady: boolean; // Can we start work now?
  executionBlocked: boolean; // Is something blocking execution?
  blockingReason: string | null; // Why execution is blocked

  // Action
  nextWorkforceAction: string; // What should happen next

  // Metadata
  evaluatedAt: string; // ISO timestamp
}

// ─── Workforce Evaluation ────────────────────────────────────────────────────

export interface WorkforceEvaluation {
  // Current state
  state: WorkforceState;

  // Readiness breakdown
  readinessFactors: {
    hasMission: boolean; // Mission exists
    missionHasAction: boolean; // Mission has clear next action
    hasAvailableMember: boolean; // At least one member available
    hasRequiredCapability: boolean; // Capability exists for next action
    hasReadyWorkItem: boolean; // Work item ready to execute
  };

  // Blockers
  executionBlockers: string[]; // List of things preventing execution
  memberBlockers: Array<{
    memberId: string;
    reason: string;
  }>;
  workItemBlockers: Array<{
    workItemId: string;
    reason: string;
  }>;

  // Recommendations
  nextActions: string[]; // Ordered list of recommended actions
  capacityAvailable: number; // 0-100, how much capacity exists
  demandRequired: number; // 0-100, how much capacity is needed

  // Status
  overallStatus: "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED";
  readinessScore: number; // 0-100
}

// ─── Workforce Assignment ────────────────────────────────────────────────────

export interface WorkforceAssignment {
  memberId: string;
  taskId: string;
  missionId: string;
  assignedAt: string;
  estimatedCompletionDate?: string;
  notes?: string;
}

// ─── Workforce Capability ────────────────────────────────────────────────────

export interface WorkforceCapability {
  name: string; // e.g., "cold_outreach", "follow_up", "research"
  description: string;
  requiredFor: WorkItemType[]; // Which work types need this
  members: string[]; // Which member IDs have this capability
}

// ─── Workforce Summary ───────────────────────────────────────────────────────

export interface WorkforceSummary {
  // Overview
  status: "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED";
  readiness: number; // 0-100
  overallSummary: string; // Human-readable status

  // Details
  availableCapacity: number; // 0-100
  utilizationRate: number; // 0-100, % of capacity in use
  blockingReason: string | null;

  // Action
  nextAction: string;
  recommendedAction: string;

  // Assignments
  activeAssignments: Array<{
    memberName: string;
    taskTitle: string;
    missionTitle: string;
    status: WorkItemStatus;
  }>;

  // Capacity
  availableMembers: string[]; // Member names
  neededCapabilities: string[]; // What's missing

  // Risks
  atRiskTasks: Array<{
    taskTitle: string;
    reason: string;
  }>;
}

// ─── Workforce Query ─────────────────────────────────────────────────────────

export interface WorkforceQuery {
  businessId: string;
  role?: WorkforceRole;
  status?: WorkforceMemberStatus;
  missionId?: string;
  capability?: string;
}

export interface WorkforceQueryResult {
  members: WorkforceMember[];
  workItems: WorkItem[];
  total: number;
  activeCount: number;
}
