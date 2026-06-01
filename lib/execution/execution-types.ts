// Phase 11A — Execution Channel Architecture types

// Channel type enumeration
export type ExecutionChannelType =
  | "VOICE"
  | "PHONE"
  | "EMAIL"
  | "SMS"
  | "WHATSAPP"
  | "LINKEDIN"
  | "CUSTOM";

// Channel capabilities and metadata
export interface ExecutionChannel {
  type: ExecutionChannelType;
  enabled: boolean;
  supportsVoice: boolean;
  supportsConversation: boolean;
  supportsOutbound: boolean;
  supportsInbound: boolean;
  description: string;
}

// Request for execution via a channel
export interface ExecutionRequest {
  id: string;
  missionId: string;
  workItemId: string;
  assignmentId: string;
  channel: ExecutionChannelType;
  objective: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "READY" | "BLOCKED" | "DISPATCHED" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

// Result of execution (model only — no actual execution in Phase 11A)
export interface ExecutionResult {
  requestId: string;
  channel: ExecutionChannelType;
  success: boolean;
  outcome: string;
  completedAt?: string;
}

// Readiness assessment for an execution request
export interface ExecutionReadiness {
  readiness: number; // 0-100
  blocked: boolean;
  blocker?: string;
}

// High-level summary of execution state
export interface ExecutionSummary {
  totalRequests: number;
  readyRequests: number;
  blockedRequests: number;
  availableChannels: ExecutionChannelType[];
  nextExecutionAction: string;
  readiness: number; // 0-100
}
