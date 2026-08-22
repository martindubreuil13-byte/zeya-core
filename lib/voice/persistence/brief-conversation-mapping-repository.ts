// Brief-Conversation Mapping Repository — Persistent linkage for webhook routing

import { createClient } from "@supabase/supabase-js";

// Resolve trusted configuration when an operation runs. This repository can be
// imported by Next.js, tests, or local QA tooling before their environment has
// been loaded; an early import must not permanently cache an unavailable client.
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;
}

export interface BriefConversationMapping {
  worker_brief_id: string;
  conversation_id?: string | null;
  mission_id: string;
  business_id: string;
  created_at: string;
  updated_at: string;
}

export type SaveMappingResult = {
  success: boolean;
  error?: {
    code?: string;
    message: string;
    details?: string;
  };
};

/**
 * Save or update brief-conversation mapping to Supabase
 * Used during dispatch (provisional) and webhook (update with real conversationId)
 */
export async function saveBriefConversationMapping(
  workerBriefId: string,
  missionId: string,
  businessId: string,
  conversationId?: string | null
): Promise<SaveMappingResult> {
  console.log("[brief-mapping-repo] 🔵 Saving brief-conversation mapping", {
    workerBriefId,
    missionId,
    businessId,
    hasConversationId: !!conversationId,
  });

  const supabase = createServiceClient();
  if (!supabase) {
    const error = { code: "SUPABASE_NOT_CONFIGURED", message: "Supabase client not initialized" };
    console.error("[brief-mapping-repo] 🔴 Supabase not configured", error);
    return { success: false, error };
  }

  try {
    const insertPayload = {
      worker_brief_id: workerBriefId,
      mission_id: missionId,
      business_id: businessId,
      conversation_id: conversationId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Use upsert: if mapping exists, update it (for real conversationId on webhook)
    // If not, insert it (new mapping at dispatch)
    const { error } = await supabase
      .from("brief_conversation_mappings")
      .upsert([insertPayload], { onConflict: "worker_brief_id" });

    if (error) {
      const errorObj = {
        code: error.code || "UNKNOWN",
        message: error.message || "Unknown Supabase error",
        details: error.details || undefined,
      };
      console.error("[brief-mapping-repo] 🔴 Upsert failed", {
        workerBriefId,
        error: errorObj.message,
      });
      return { success: false, error: errorObj };
    }

    console.log("[brief-mapping-repo] 🟢 Mapping saved/updated successfully", {
      workerBriefId,
      conversationId: conversationId || "provisional",
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const errorObj = {
      code: "UNEXPECTED_ERROR",
      message,
      details: error instanceof Error ? error.stack : undefined,
    };
    console.error("[brief-mapping-repo] 🔴 Unexpected error saving mapping", {
      workerBriefId,
      message,
    });
    return { success: false, error: errorObj };
  }
}

/**
 * Get mapping by worker brief ID
 */
export async function getMappingByWorkerBriefId(
  workerBriefId: string
): Promise<BriefConversationMapping | null> {
  const supabase = createServiceClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("brief_conversation_mappings")
      .select("*")
      .eq("worker_brief_id", workerBriefId)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        // PGRST116 = no rows returned
        console.error("[brief-mapping-repo] Error fetching mapping:", error.message);
      }
      return null;
    }

    return data as BriefConversationMapping;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[brief-mapping-repo] Unexpected error fetching mapping:", message);
    return null;
  }
}

/**
 * Get mapping by conversation ID
 */
export async function getMappingByConversationId(
  conversationId: string
): Promise<BriefConversationMapping | null> {
  const supabase = createServiceClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("brief_conversation_mappings")
      .select("*")
      .eq("conversation_id", conversationId)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        console.error("[brief-mapping-repo] Error fetching mapping by conversation:", error.message);
      }
      return null;
    }

    return data as BriefConversationMapping;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[brief-mapping-repo] Unexpected error fetching mapping:", message);
    return null;
  }
}

/**
 * Get business ID for a worker brief (for backward compatibility)
 */
export async function getBusinessIdForBrief(workerBriefId: string): Promise<string | null> {
  const mapping = await getMappingByWorkerBriefId(workerBriefId);
  return mapping?.business_id ?? null;
}

/**
 * Get mission ID for a worker brief (for backward compatibility)
 */
export async function getMissionIdForBrief(workerBriefId: string): Promise<string | null> {
  const mapping = await getMappingByWorkerBriefId(workerBriefId);
  return mapping?.mission_id ?? null;
}
