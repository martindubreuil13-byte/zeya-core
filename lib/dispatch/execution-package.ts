/**
 * Execution Package Builder
 * Creates standardized contract between Dispatch System and Telnyx Adapter
 */

import type { DispatchRecord, TelnyxExecutionPackage, AgentBrief } from "./types";

export interface ExecutionPackageInput {
  dispatch_id: string;
  visitor_name: string;
  phone_number: string;
  business_offer: string;
  target_buyer: string;
  worker_brief_id: string;
  agent_brief: AgentBrief;
  created_at: string;
}

/**
 * Build execution package from dispatch record
 * This is the contract handed to the Telnyx adapter
 */
export function buildExecutionPackage(
  input: ExecutionPackageInput
): TelnyxExecutionPackage {
  return {
    dispatch_id: input.dispatch_id,
    visitor_name: input.visitor_name,
    phone_number: input.phone_number,
    business_offer: input.business_offer,
    target_buyer: input.target_buyer,
    agent_brief: input.agent_brief,
    execution_status: "ready",
    ready_for_execution: true,
    metadata: {
      created_at: input.created_at,
      source: "experience_conversation",
      worker_brief_id: input.worker_brief_id,
    },
  };
}

/**
 * Validate execution package
 * Ensures all required fields are present
 */
export function validateExecutionPackage(pkg: TelnyxExecutionPackage): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!pkg.dispatch_id) errors.push("dispatch_id is required");
  if (!pkg.visitor_name) errors.push("visitor_name is required");
  if (!pkg.phone_number) errors.push("phone_number is required");
  if (!pkg.business_offer) errors.push("business_offer is required");
  if (!pkg.target_buyer) errors.push("target_buyer is required");
  if (!pkg.agent_brief) errors.push("agent_brief is required");

  // Validate phone number format (basic)
  if (pkg.phone_number && !pkg.phone_number.startsWith("+")) {
    errors.push("phone_number must include country code (e.g., +1)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Add provider-specific configuration to execution package
 * Used by Telnyx adapter before actual call placement
 */
export function addProviderConfiguration(
  pkg: TelnyxExecutionPackage,
  config: {
    connection_id?: string;
    application_id?: string;
    from_number?: string;
  }
): TelnyxExecutionPackage {
  return {
    ...pkg,
    telnyx_config: {
      connection_id: config.connection_id,
      application_id: config.application_id,
      from_number: config.from_number,
    },
  };
}

/**
 * Extract execution summary (for logging/monitoring)
 */
export function summarizeExecutionPackage(pkg: TelnyxExecutionPackage): {
  dispatch_id: string;
  visitor: string;
  phone: string;
  business: string;
  ready: boolean;
} {
  return {
    dispatch_id: pkg.dispatch_id,
    visitor: pkg.visitor_name,
    phone: pkg.phone_number,
    business: pkg.business_offer,
    ready: pkg.ready_for_execution,
  };
}
