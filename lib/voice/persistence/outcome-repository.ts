// Outcome repository — persist CallOutcomes to existing call_outcomes table

import { createClient } from "@supabase/supabase-js";
import type { CallOutcome } from "../outcomes/call-outcome-types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface PersistedOutcome {
  id: string;
  worker_brief_id?: string | null;
  outcome_type: string;
  summary?: string;
  next_action?: string;
  call_duration_seconds?: number;
  transcript?: unknown;
  raw_provider_payload?: unknown;
  created_at: string;
  updated_at: string;
  sentiment?: string;
  objections?: string;
  key_insights?: string;
  follow_up_required?: boolean;
  follow_up_date?: string;
  meeting_booked?: boolean;
  meeting_date?: string;
}

/**
 * Save CallOutcome to Supabase call_outcomes table
 * Maps Phase 12A CallOutcome fields to actual call_outcomes schema
 */
export async function saveOutcome(outcome: CallOutcome): Promise<boolean> {
  if (!supabase) {
    console.warn("[outcome-repo] Supabase not configured, skipping persistence");
    return false;
  }

  try {
    const { error } = await supabase
      .from("call_outcomes")
      .insert([
        {
          worker_brief_id: outcome.workerBriefId,
          outcome_type: outcome.outcome,
          summary: outcome.summary,
          next_action: outcome.recommendedAction,
          call_duration_seconds: outcome.callDuration,
          transcript: outcome.extractedData,
          raw_provider_payload: outcome.extractedData,
          updated_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("[outcome-repo] Error saving outcome:", {
        conversationId: outcome.conversationId,
        error: error.message,
      });
      return false;
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[outcome-repo] Saved outcome:", {
        conversationId: outcome.conversationId,
        outcome: outcome.outcome,
        confidence: outcome.confidence,
      });
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Unexpected error saving outcome:", {
      conversationId: outcome.conversationId,
      message,
    });
    return false;
  }
}

/**
 * Get outcome from Supabase by UUID ID
 */
export async function getOutcomeById(
  outcomeId: string
): Promise<PersistedOutcome | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("call_outcomes")
      .select("*")
      .eq("id", outcomeId)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        console.error("[outcome-repo] Error fetching outcome:", error.message);
      }
      return null;
    }

    return data as PersistedOutcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Unexpected error fetching outcome:", message);
    return null;
  }
}

/**
 * Get outcome from Supabase by worker brief ID
 * Note: Actual schema does not have conversation_id; using worker_brief_id as lookup key
 */
export async function getOutcomeByWorkerBriefId(
  workerBriefId: string
): Promise<PersistedOutcome | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("call_outcomes")
      .select("*")
      .eq("worker_brief_id", workerBriefId)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        console.error("[outcome-repo] Error fetching outcome by worker brief:", error.message);
      }
      return null;
    }

    return data as PersistedOutcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Unexpected error fetching outcome by worker brief:", message);
    return null;
  }
}

/**
 * Get recent outcomes from Supabase
 */
export async function listRecentOutcomes(limit: number = 50): Promise<PersistedOutcome[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("call_outcomes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[outcome-repo] Error listing outcomes:", error.message);
      return [];
    }

    return (data as PersistedOutcome[]) || [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Unexpected error listing outcomes:", message);
    return [];
  }
}

/**
 * Count outcomes in Supabase
 */
export async function countOutcomes(): Promise<number> {
  if (!supabase) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from("call_outcomes")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error("[outcome-repo] Error counting outcomes:", error.message);
      return 0;
    }

    return count || 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Unexpected error counting outcomes:", message);
    return 0;
  }
}

/**
 * Load recent outcomes from Supabase (for recovery)
 * Maps actual call_outcomes columns to CallOutcome interface
 */
export async function loadRecentOutcomes(limit: number = 100): Promise<CallOutcome[]> {
  if (!supabase) {
    return [];
  }

  try {
    const persisted = await listRecentOutcomes(limit);

    return persisted.map((p) => ({
      outcomeId: p.id,
      conversationId: "", // Not available in actual schema
      workerBriefId: p.worker_brief_id ?? null,
      status: "done" as const, // Actual schema doesn't have status; assume done
      outcome: p.outcome_type || "unknown",
      confidence: 0.5, // Actual schema doesn't have confidence
      summary: p.summary || "",
      extractedData: p.raw_provider_payload,
      recommendedAction: p.next_action || "",
      callDuration: p.call_duration_seconds,
      transcriptLength: 0, // Not available in actual schema
      createdAt: p.created_at,
    })) as CallOutcome[];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[outcome-repo] Error loading outcomes for recovery:", message);
    return [];
  }
}
