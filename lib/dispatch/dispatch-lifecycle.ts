/**
 * Dispatch Lifecycle Management
 * Handles transitions through dispatch states with event tracking
 */

import { createClient } from "@supabase/supabase-js";
import type { DispatchStatus } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseKey || "");

/**
 * Transition dispatch to new status with event tracking
 */
export async function transitionDispatchStatus(
  dispatchId: string,
  userId: string,
  newStatus: DispatchStatus,
  eventType: string,
  message?: string,
  metadata?: Record<string, unknown>
) {
  try {
    // Use RPC function to atomically update status and create event
    const { data, error } = await supabase.rpc(
      "update_dispatch_with_event",
      {
        p_dispatch_id: dispatchId,
        p_new_status: newStatus,
        p_event_type: eventType,
        p_user_id: userId,
        p_message: message,
        p_metadata: metadata,
      }
    );

    if (error) {
      console.error("[Dispatch Transition Error]", error);
      return null;
    }

    console.log(
      `[Dispatch Transitioned] ${dispatchId} → ${newStatus} (event: ${eventType})`
    );
    return data?.[0];
  } catch (error) {
    console.error("[Dispatch Transition Failed]", error);
    return null;
  }
}

/**
 * Queue dispatch for execution
 * Transition: draft → queued
 */
export async function queueDispatch(dispatchId: string, userId: string) {
  return transitionDispatchStatus(
    dispatchId,
    userId,
    "queued",
    "queued",
    "Dispatch queued for execution"
  );
}

/**
 * Start dispatch execution
 * Transition: queued → calling
 */
export async function startDispatchExecution(
  dispatchId: string,
  userId: string,
  metadata?: Record<string, unknown>
) {
  return transitionDispatchStatus(
    dispatchId,
    userId,
    "calling",
    "calling",
    "Outbound call initiated",
    metadata
  );
}

/**
 * Mark dispatch as call answered
 */
export async function markDispatchAnswered(
  dispatchId: string,
  userId: string,
  metadata?: Record<string, unknown>
) {
  return transitionDispatchStatus(
    dispatchId,
    userId,
    "answered",
    "answered",
    "Call answered",
    metadata
  );
}

/**
 * Mark dispatch as no answer
 */
export async function markDispatchNoAnswer(
  dispatchId: string,
  userId: string,
  metadata?: Record<string, unknown>
) {
  return transitionDispatchStatus(
    dispatchId,
    userId,
    "no_answer",
    "no_answer",
    "No answer received",
    metadata
  );
}

/**
 * Complete dispatch with outcome
 */
export async function completeDispatch(
  dispatchId: string,
  userId: string,
  callOutcomeId: string,
  metadata?: Record<string, unknown>
) {
  try {
    // Update dispatch with call outcome linkage
    const { error: updateError } = await supabase
      .from("dispatches")
      .update({
        call_outcome_id: callOutcomeId,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("dispatch_id", dispatchId);

    if (updateError) {
      console.error("[Dispatch Complete Error]", updateError);
      return null;
    }

    // Create completion event
    return transitionDispatchStatus(
      dispatchId,
      userId,
      "completed",
      "completed",
      "Call completed and outcome recorded",
      { call_outcome_id: callOutcomeId, ...metadata }
    );
  } catch (error) {
    console.error("[Dispatch Complete Failed]", error);
    return null;
  }
}

/**
 * Fail dispatch
 */
export async function failDispatch(
  dispatchId: string,
  userId: string,
  error: string,
  metadata?: Record<string, unknown>
) {
  return transitionDispatchStatus(
    dispatchId,
    userId,
    "failed",
    "failed",
    error,
    metadata
  );
}

/**
 * Get full dispatch context
 */
export async function getDispatchContext(dispatchId: string) {
  try {
    const { data, error } = await supabase.rpc("get_dispatch_context", {
      p_dispatch_id: dispatchId,
    });

    if (error) {
      console.error("[Dispatch Context Error]", error);
      return null;
    }

    return data?.[0];
  } catch (error) {
    console.error("[Dispatch Context Failed]", error);
    return null;
  }
}

/**
 * Get dispatch events (audit trail)
 */
export async function getDispatchEvents(dispatchId: string) {
  try {
    const { data, error } = await supabase
      .from("dispatch_events")
      .select("*")
      .eq("dispatch_id", dispatchId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Dispatch Events Error]", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("[Dispatch Events Failed]", error);
    return [];
  }
}
