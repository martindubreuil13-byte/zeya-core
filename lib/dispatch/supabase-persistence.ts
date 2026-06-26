import { createClient } from "@supabase/supabase-js";
import type { DispatchStatus } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials not configured");
}

const supabase = createClient(supabaseUrl || "", supabaseKey || "");

/**
 * Create dispatch in Supabase
 */
export async function createDispatchInSupabase(
  userId: string,
  dispatchId: string,
  visitorName: string,
  phoneNumber: string,
  businessOffer: string,
  targetBuyer: string,
  agentBrief: Record<string, unknown>
) {
  try {
    const { data, error } = await supabase.from("dispatches").insert({
      dispatch_id: dispatchId,
      user_id: userId,
      visitor_name: visitorName,
      phone_number: phoneNumber,
      business_offer: businessOffer,
      target_buyer: targetBuyer,
      agent_brief: agentBrief,
      status: "draft",
      source: "experience_conversation",
    });

    if (error) {
      console.error("[Dispatch Supabase Error]", {
        table: "dispatches",
        payload: {
          dispatch_id: dispatchId,
          user_id: userId,
          visitor_name: visitorName,
          phone_number: phoneNumber,
        },
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      });
      return null;
    }

    console.log("[Dispatch Created in Supabase]", dispatchId);
    return data;
  } catch (error) {
    console.error("[Dispatch Create Failed]", error);
    return null;
  }
}

/**
 * Get dispatch by ID
 */
export async function getDispatchFromSupabase(dispatchId: string) {
  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("dispatch_id", dispatchId)
      .single();

    if (error) {
      console.error("[Dispatch Fetch Error]", {
        table: "dispatches",
        query: { dispatch_id: dispatchId },
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      });
      return null;
    }

    return data;
  } catch (error) {
    console.error("[Dispatch Fetch Failed]", error);
    return null;
  }
}

/**
 * Update dispatch status
 */
export async function updateDispatchStatusInSupabase(
  dispatchId: string,
  status: DispatchStatus,
  metadata?: Record<string, unknown>
) {
  try {
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (metadata) {
      updateData.last_error = metadata.error || null;
    }

    const { data, error } = await supabase
      .from("dispatches")
      .update(updateData)
      .eq("dispatch_id", dispatchId);

    if (error) {
      console.error("[Dispatch Status Update Error]", error);
      return null;
    }

    console.log(`[Dispatch Updated] ${dispatchId} → ${status}`);
    return data;
  } catch (error) {
    console.error("[Dispatch Status Update Failed]", error);
    return null;
  }
}

/**
 * Queue dispatch (move from draft to queued)
 */
export async function queueDispatchInSupabase(dispatchId: string) {
  return updateDispatchStatusInSupabase(dispatchId, "queued");
}

/**
 * Get all dispatches for user
 */
export async function getUserDispatches(userId: string) {
  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Dispatch List Error]", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("[Dispatch List Failed]", error);
    return [];
  }
}

/**
 * Get dispatches by status
 */
export async function getDispatchesByStatus(userId: string, status: DispatchStatus) {
  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("user_id", userId)
      .eq("status", status)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Dispatch Filter Error]", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("[Dispatch Filter Failed]", error);
    return [];
  }
}
