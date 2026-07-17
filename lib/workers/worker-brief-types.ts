// WorkerBrief Types — Mission-specific instructions for worker agents
// WorkerBrief bridges Zeya's strategic decisions and worker execution

export type WorkerType = "CALLER" | "RESEARCHER" | "OUTREACH" | "SCHEDULER" | "ANALYST";

export type WorkerBriefStatus = "DRAFT" | "READY" | "DISPATCHED" | "COMPLETED" | "FAILED";

// Core WorkerBrief: Zeya's mission-specific instructions to a worker
export interface WorkerBrief {
  // Identification
  id: string;
  missionId: string;
  executionRequestId?: string; // Reference to parent execution request (if applicable)

  // Worker assignment
  workerType: WorkerType;
  workerName: string; // e.g., "Veya" for CALLER type

  // Status
  status: WorkerBriefStatus;

  // Context: what the worker needs to know
  companyContext: string; // Who is being contacted, what's the business context
  leadContext?: string; // Specific information about the lead/prospect

  // Objective and outcome
  objective: string; // What the worker should try to accomplish
  desiredOutcome: string; // What success looks like

  // Guidance for the worker
  keyQuestions: string[]; // Questions to ask or explore
  objectionGuidance: string[]; // How to handle common objections
  escalationRules: string[]; // When and how to escalate
  successCriteria: string; // How to know the mission succeeded

  // Optional tone guidance
  toneGuidance?: string; // e.g., "professional but warm", "direct and concise"

  // Dynamic variables for runtime substitution
  // These will be used by ElevenLabs for voice personalization, Twilio for delivery, etc.
  dynamicVariables: Record<string, string | number | boolean | null>;

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// Result of worker dispatch
export interface WorkerDispatchResult {
  briefId: string;
  workerName: string;
  workerType: WorkerType;
  status: "SIMULATED" | "DISPATCHED" | "COMPLETED" | "FAILED";
  message: string;
  providerType?: "MOCK" | "TWILIO" | "ELEVENLABS";
  providerCallId?: string;
  conversationId?: string;
  voiceContextId?: string;
  createdAt: string;
}

// Human-readable summary of a brief and its dispatch
export interface WorkerBriefSummary {
  briefId: string;
  workerName: string;
  workerType: WorkerType;
  objective: string;
  desiredOutcome: string;
  companyContext: string;
  leadContext?: string;
  successCriteria: string;
  dispatchStatus: WorkerDispatchResult | null;
  nextSteps: string;
}
