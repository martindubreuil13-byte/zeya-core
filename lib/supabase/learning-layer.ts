import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type {
  CallResult,
  CreateCallResultInput,
  CreateLearningEventInput,
  LearningEvent,
} from "@/types/zeya/learning";

type ZeyaDbClient = Pick<SupabaseClient, "from">;

export async function createCallResult(
  input: CreateCallResultInput,
  db: ZeyaDbClient = supabase,
): Promise<CallResult> {
  const { data, error } = await db
    .from("call_results")
    .insert({
      business_id: input.businessId,
      assignment_id: input.assignmentId ?? null,
      lead_id: input.leadId ?? null,
      outcome: input.outcome,
      interest_level: input.interestLevel ?? null,
      objection: input.objection ?? null,
      follow_up_required: input.followUpRequired ?? false,
      follow_up_date: input.followUpDate ?? null,
      summary: input.summary ?? null,
    })
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error("[Zeya] createCallResult failed:", error);
    throw error ?? new Error("No call_result returned.");
  }

  return data as CallResult;
}

export async function getCallResults(
  businessId: string,
  options: { assignmentId?: string | null; leadId?: string | null } = {},
  db: ZeyaDbClient = supabase,
): Promise<CallResult[]> {
  let query = db
    .from("call_results")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (options.assignmentId) query = query.eq("assignment_id", options.assignmentId);
  if (options.leadId) query = query.eq("lead_id", options.leadId);

  const { data, error } = await query;

  if (error) {
    console.error("[Zeya] getCallResults failed:", error);
    throw error;
  }

  return (data ?? []) as CallResult[];
}

export async function createLearningEvent(
  input: CreateLearningEventInput,
  db: ZeyaDbClient = supabase,
): Promise<LearningEvent> {
  const { data, error } = await db
    .from("learning_events")
    .insert({
      business_id: input.businessId,
      mission_key: input.missionKey ?? null,
      learning_type: input.learningType,
      title: input.title,
      description: input.description ?? null,
      confidence: input.confidence,
      source_count: input.sourceCount,
    })
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error("[Zeya] createLearningEvent failed:", error);
    throw error ?? new Error("No learning_event returned.");
  }

  return data as LearningEvent;
}

export async function getLearningEvents(
  businessId: string,
  missionKey?: string | null,
  db: ZeyaDbClient = supabase,
): Promise<LearningEvent[]> {
  let query = db
    .from("learning_events")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (missionKey) query = query.eq("mission_key", missionKey);

  const { data, error } = await query;

  if (error) {
    console.error("[Zeya] getLearningEvents failed:", error);
    throw error;
  }

  return (data ?? []) as LearningEvent[];
}
