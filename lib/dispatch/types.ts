export type DispatchStatus = "draft" | "queued" | "calling" | "answered" | "no_answer" | "completed" | "failed";

export interface DispatchPayload {
  id: string;
  source: string;
  timestamp: string;
  visitor: {
    name: string;
    phone: string;
  };
  business: {
    offer: string;
    target_buyer: string;
  };
}

export interface AgentBrief {
  visitor_name: string;
  business_summary: string;
  outreach_objective: string;
  call_context: {
    offer: string;
    target_market: string;
  };
  instructions: string;
}

export interface DispatchRecord {
  dispatch_id: string;
  payload: DispatchPayload;
  brief: AgentBrief;
  status: DispatchStatus;
  created_at: string;
  updated_at: string;
}

export interface TelnyxExecutionPackage {
  dispatch_id: string;
  visitor_name: string;
  phone_number: string;
  business_offer: string;
  target_buyer: string;
  agent_brief: AgentBrief;
  execution_status: "ready" | "in_progress" | "completed" | "failed";
  ready_for_execution: boolean;
  telnyx_config?: {
    connection_id?: string;
    application_id?: string;
    call_control_id?: string;
    from_number?: string;
  };
  metadata?: {
    created_at: string;
    source: string;
    campaign_id?: string;
    worker_brief_id?: string;
  };
}
