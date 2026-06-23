export type VeyaDelegationStatus =
  | "preparing_brief"
  | "dispatching_call"
  | "call_requested"
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
  status: "call_requested" | "failed";
  briefing: VeyaBriefingPayload;
  dispatchId?: string;
  workerBriefId?: string;
  provider?: string;
  providerCallId?: string;
  error?: string;
}
