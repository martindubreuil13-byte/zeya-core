// WorkerBrief Repository — Persist briefs for complete call traceability

import { supabase } from "@/lib/supabase";
import type { WorkerBrief } from "./worker-brief-types";

export interface PersistedWorkerBrief {
  id: string;
  mission_id: string;
  business_id: string;
  target_name?: string | null;
  target_phone?: string | null;
  objective: string;
  desired_outcome: string;
  company_context?: string | null;
  lead_context?: string | null;
  key_questions?: unknown[] | null;
  objection_guidance?: unknown[] | null;
  escalation_rules?: unknown[] | null;
  tone_guidance?: string | null;
  success_criteria?: string | null;
  dynamic_variables?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type SaveWorkerBriefResult = {
  success: boolean;
  error?: {
    code?: string;
    message: string;
    details?: string;
  };
};

/**
 * Save WorkerBrief to Supabase worker_briefs table
 */
export async function saveWorkerBrief(
  brief: WorkerBrief,
  businessId: string,
  targetName?: string | null,
  targetPhone?: string | null
): Promise<SaveWorkerBriefResult> {
  console.log("[worker-brief-repo] 🔵 Saving WorkerBrief to database", {
    briefId: brief.id,
    missionId: brief.missionId,
    businessId,
    hasTargetName: !!targetName,
    hasTargetPhone: !!targetPhone,
  });

  if (!supabase) {
    const error = { code: "SUPABASE_NOT_CONFIGURED", message: "Supabase client not initialized" };
    console.error("[worker-brief-repo] 🔴 Supabase not configured", error);
    return { success: false, error };
  }

  try {
    const insertPayload = {
      id: brief.id,
      mission_id: brief.missionId,
      business_id: businessId,
      target_name: targetName || null,
      target_phone: targetPhone || null,
      objective: brief.objective,
      desired_outcome: brief.desiredOutcome,
      company_context: brief.companyContext || null,
      lead_context: brief.leadContext || null,
      key_questions: brief.keyQuestions || [],
      objection_guidance: brief.objectionGuidance || [],
      escalation_rules: brief.escalationRules || [],
      tone_guidance: brief.toneGuidance || null,
      success_criteria: brief.successCriteria || null,
      dynamic_variables: brief.dynamicVariables || {},
      created_at: brief.createdAt,
      updated_at: brief.updatedAt,
    };

    console.log("[worker-brief-repo] 🔵 INSERT payload ready", {
      briefId: insertPayload.id,
      missionId: insertPayload.mission_id,
    });

    const { error } = await supabase.from("worker_briefs").insert([insertPayload]);

    if (error) {
      const errorObj = {
        code: error.code || "UNKNOWN",
        message: error.message || "Unknown Supabase error",
        details: error.details || undefined,
      };
      console.error("[worker-brief-repo] 🔴 INSERT failed", {
        briefId: brief.id,
        error: errorObj.message,
        code: errorObj.code,
      });
      return { success: false, error: errorObj };
    }

    console.log("[worker-brief-repo] 🟢 WorkerBrief persisted successfully", {
      briefId: brief.id,
      missionId: brief.missionId,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const errorObj = {
      code: "UNEXPECTED_ERROR",
      message,
      details: error instanceof Error ? error.stack : undefined,
    };
    console.error("[worker-brief-repo] 🔴 Unexpected error saving brief", {
      briefId: brief.id,
      message,
    });
    return { success: false, error: errorObj };
  }
}

/**
 * Get WorkerBrief by ID from Supabase
 */
export async function getWorkerBriefById(briefId: string): Promise<PersistedWorkerBrief | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("worker_briefs")
      .select("*")
      .eq("id", briefId)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        console.error("[worker-brief-repo] Error fetching brief:", error.message);
      }
      return null;
    }

    return data as PersistedWorkerBrief;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[worker-brief-repo] Unexpected error fetching brief:", message);
    return null;
  }
}

/**
 * Get WorkerBriefs by mission ID
 */
export async function getWorkerBriefsByMissionId(missionId: string): Promise<PersistedWorkerBrief[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("worker_briefs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[worker-brief-repo] Error fetching briefs by mission:", error.message);
      return [];
    }

    return (data as PersistedWorkerBrief[]) || [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[worker-brief-repo] Unexpected error fetching briefs:", message);
    return [];
  }
}

/**
 * Get WorkerBriefs by business ID
 */
export async function getWorkerBriefsByBusinessId(businessId: string): Promise<PersistedWorkerBrief[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("worker_briefs")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[worker-brief-repo] Error fetching briefs by business:", error.message);
      return [];
    }

    return (data as PersistedWorkerBrief[]) || [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[worker-brief-repo] Unexpected error fetching briefs:", message);
    return [];
  }
}

/**
 * Count WorkerBriefs in Supabase
 */
export async function countWorkerBriefs(): Promise<number> {
  if (!supabase) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from("worker_briefs")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error("[worker-brief-repo] Error counting briefs:", error.message);
      return 0;
    }

    return count || 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[worker-brief-repo] Unexpected error counting briefs:", message);
    return 0;
  }
}
