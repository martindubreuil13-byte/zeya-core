export type VeyaDelegationStatus =
  | "preparing_brief"
  | "dispatching_call"
  | "call_requested"
  | "call_dispatched"
  | "correlation_pending"
  | "retryable"
  | "dispatch_resolution_pending"
  | "conflict"
  | "failed";

export interface VeyaBriefingPayload {
  name: string | null;
  business: string | null;
  customer: string | null;
  phone: string;
  source: "zeya_experience";
  createdAt: string;
}

export interface VeyaDelegationResponse {
  success: boolean;
  status: "call_dispatched" | "correlation_pending" | "retryable" | "dispatch_resolution_pending" | "conflict" | "failed";
  briefing: VeyaBriefingPayload;
  message?: string;
  error?: string;
}
