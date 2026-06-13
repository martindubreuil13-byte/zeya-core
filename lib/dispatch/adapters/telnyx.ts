/**
 * Telnyx Adapter
 * Handles outbound call execution through Telnyx platform
 * Currently: Architecture only (no production calls)
 */

import type { TelnyxExecutionPackage } from "../types";

// ─── Environment Configuration ───────────────────────────────────────────

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER;

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

// ─── Validation ──────────────────────────────────────────────────────────

export function validateTelnyxConfiguration(): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (!TELNYX_API_KEY) missing.push("TELNYX_API_KEY");
  if (!TELNYX_CONNECTION_ID) missing.push("TELNYX_CONNECTION_ID");
  if (!TELNYX_FROM_NUMBER) missing.push("TELNYX_FROM_NUMBER");

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function ensureTelnyxConfigured(): boolean {
  const config = validateTelnyxConfiguration();
  if (!config.valid) {
    console.warn("[Telnyx Config Missing]", config.missing);
    return false;
  }
  return true;
}

// ─── Outbound Call Interface ─────────────────────────────────────────────

export interface OutboundCallRequest {
  to: string; // E.164 format, e.g., "+15551234567"
  from: string; // E.164 format
  connection_id: string;
  customer_ref?: string;
  record?: boolean;
  timeout_secs?: number;
}

export interface OutboundCallResponse {
  call_control_id: string;
  call_session_id: string;
  call_leg_id: string;
  status: string;
  to: string;
  from: string;
}

/**
 * Create outbound call
 * Currently: Returns mock response with proper structure
 * Future: Integrates with Telnyx API
 */
export async function createOutboundCall(
  pkg: TelnyxExecutionPackage
): Promise<OutboundCallResponse | null> {
  // Validate configuration
  if (!ensureTelnyxConfigured()) {
    console.log("[Telnyx] Not configured - returning mock response");
    return createMockOutboundCall(pkg);
  }

  try {
    const request: OutboundCallRequest = {
      to: pkg.phone_number,
      from: TELNYX_FROM_NUMBER!,
      connection_id: TELNYX_CONNECTION_ID!,
      customer_ref: pkg.dispatch_id,
      record: true,
      timeout_secs: 60,
    };

    console.log("[Telnyx] Creating outbound call", {
      dispatch_id: pkg.dispatch_id,
      to: pkg.phone_number,
      from: request.from,
    });

    // TODO: Implement actual Telnyx API call here
    // const response = await fetch(`${TELNYX_API_BASE}/calls`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${TELNYX_API_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(request),
    // });
    //
    // if (!response.ok) {
    //   const error = await response.json();
    //   throw new Error(error.errors?.[0]?.detail || 'Failed to create call');
    // }
    //
    // return response.json();

    // For now, return mock
    return createMockOutboundCall(pkg);
  } catch (error) {
    console.error("[Telnyx] Create outbound call failed", error);
    return null;
  }
}

/**
 * Handle call answered webhook
 * Called by Telnyx when prospect answers
 */
export async function handleCallAnswered(
  callControlId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  try {
    console.log("[Telnyx] Call answered", {
      call_control_id: callControlId,
      metadata,
    });

    // TODO: Implement webhook handler logic
    // - Update dispatch status to "answered"
    // - Start recording if not already
    // - Begin agent briefing

    return true;
  } catch (error) {
    console.error("[Telnyx] Handle answered failed", error);
    return false;
  }
}

/**
 * Handle call completed webhook
 * Called by Telnyx when call ends
 */
export async function handleCallCompleted(
  callControlId: string,
  metadata: {
    duration_seconds: number;
    transcript?: string;
    recording_url?: string;
  }
): Promise<boolean> {
  try {
    console.log("[Telnyx] Call completed", {
      call_control_id: callControlId,
      duration: metadata.duration_seconds,
      has_recording: !!metadata.recording_url,
    });

    // TODO: Implement webhook handler logic
    // - Create call_outcome record
    // - Store transcript and recording
    // - Update dispatch status to "completed"
    // - Generate memory events from outcome

    return true;
  } catch (error) {
    console.error("[Telnyx] Handle completed failed", error);
    return false;
  }
}

/**
 * Handle no answer webhook
 * Called by Telnyx when call goes unanswered
 */
export async function handleNoAnswer(
  callControlId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  try {
    console.log("[Telnyx] No answer", {
      call_control_id: callControlId,
      metadata,
    });

    // TODO: Implement webhook handler logic
    // - Update dispatch status to "no_answer"
    // - Record attempt count
    // - Determine if should retry

    return true;
  } catch (error) {
    console.error("[Telnyx] Handle no answer failed", error);
    return false;
  }
}

/**
 * Handle call failed webhook
 * Called by Telnyx when call fails
 */
export async function handleCallFailed(
  callControlId: string,
  error: {
    code: string;
    message: string;
  }
): Promise<boolean> {
  try {
    console.log("[Telnyx] Call failed", {
      call_control_id: callControlId,
      error: error.message,
    });

    // TODO: Implement webhook handler logic
    // - Update dispatch status to "failed"
    // - Record error
    // - Determine if should retry

    return true;
  } catch (err) {
    console.error("[Telnyx] Handle failed failed", err);
    return false;
  }
}

// ─── Mock Helpers (for development/testing) ──────────────────────────────

function createMockOutboundCall(
  pkg: TelnyxExecutionPackage
): OutboundCallResponse {
  return {
    call_control_id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    call_session_id: `session_${Date.now()}`,
    call_leg_id: `leg_${Date.now()}`,
    status: "initiated",
    to: pkg.phone_number,
    from: TELNYX_FROM_NUMBER || "+1000000000",
  };
}

// ─── Webhook Handlers (for Next.js API routes) ──────────────────────────

export async function handleWebhook(
  event: Record<string, unknown>
): Promise<{ success: boolean; message?: string }> {
  try {
    const type = event.type;

    switch (type) {
      case "call.answered":
        await handleCallAnswered(
          event.call_control_id as string,
          event.data as Record<string, unknown>
        );
        return { success: true };

      case "call.hangup":
        await handleCallCompleted(
          event.call_control_id as string,
          event.data as any
        );
        return { success: true };

      case "call.initiate_failed":
        await handleCallFailed(
          event.call_control_id as string,
          event.data as any
        );
        return { success: true };

      default:
        console.log("[Telnyx] Unknown webhook type:", type);
        return { success: true };
    }
  } catch (error) {
    console.error("[Telnyx] Webhook handling failed", error);
    return { success: false, message: String(error) };
  }
}
