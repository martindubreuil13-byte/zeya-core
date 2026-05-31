// Helper to build BusinessStateInput from Supabase data
// Bridges the gap between database schema and workflow brain

import type { BusinessStateInput } from "./derive-business-state";
import type { LeadSummary } from "@/lib/leads/types";
import type { CallResult, LearningEvent } from "@/types/zeya/learning";
import type { CallerBrief } from "@/lib/mission/caller-brief";
import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";

export interface DatabaseContext {
  // From businesses table
  businessName?: string | null;
  businessProfile?: Record<string, unknown> | null;

  // Parsed from business_profile.current_mission_detail
  missionDetail?: MissionDetail | null;

  // From business_profile fields
  targetCustomers?: string | null;
  offer?: string | null;
  painPoints?: string | null;

  // From mission_leads aggregation
  leadSummary?: LeadSummary | null;

  // Caller brief (likely from state/context, not persisted to DB yet)
  callerBrief?: CallerBrief | null;

  // From sales_agents + mission_assignments
  assignedAgentName?: string | null;

  // From call_results — always array, never null
  callResults?: CallResult[];

  // From learning_events — always array, never null
  learningEvents?: LearningEvent[];
}

export function buildBusinessStateInput(db: DatabaseContext): BusinessStateInput {
  return {
    businessName: db.businessName,
    businessProfile: db.businessProfile,
    missionDetail: db.missionDetail,
    targetCustomers: db.targetCustomers,
    offer: db.offer,
    painPoints: db.painPoints,
    leadSummary: db.leadSummary,
    callerBrief: db.callerBrief,
    assignedAgentName: db.assignedAgentName,
    callResults: db.callResults,
    learningEvents: db.learningEvents,
  };
}

// ─── Supabase Query Helpers ──────────────────────────────────────────────────

// Fetch all context needed to build business state
// Usage: const state = deriveBusinessState(await getFullBusinessContext(supabase, businessId))

export async function getFullBusinessContext(
  supabase: any, // SupabaseClient type
  businessId: string,
): Promise<DatabaseContext> {
  try {
    // Fetch business record with profile
    const { data: business } = await supabase
      .from("businesses")
      .select("business_name, business_profile")
      .eq("id", businessId)
      .single();

    if (!business) return {};

    // Parse mission detail from profile
    let missionDetail: MissionDetail | null = null;
    if (business.business_profile?.current_mission_detail) {
      try {
        missionDetail = JSON.parse(business.business_profile.current_mission_detail);
      } catch {
        // Silent fail if parsing fails
      }
    }

    // Get lead summary
    const { data: leads = [] } = await supabase
      .from("mission_leads")
      .select("fit_status, status")
      .eq("business_id", businessId);

    const leadSummary: LeadSummary = {
      total: leads.length,
      likelyMatch: leads.filter((l: any) => l.fit_status === "likely_match").length,
      possibleMatch: leads.filter((l: any) => l.fit_status === "possible_match").length,
      weakMatch: leads.filter((l: any) => l.fit_status === "weak_match").length,
      selected: leads.filter((l: any) => l.status === "selected").length,
    };

    // Get latest assignment and check if there's an agent
    const { data: assignments = [] } = await supabase
      .from("mission_assignments")
      .select("agent_id, status")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1);

    let assignedAgentName: string | null = null;
    if (assignments.length > 0 && assignments[0].agent_id) {
      const { data: agent } = await supabase
        .from("sales_agents")
        .select("name")
        .eq("id", assignments[0].agent_id)
        .single();

      assignedAgentName = agent?.name ?? null;
    }

    // Get call results
    const { data: callResults = [] } = await supabase
      .from("call_results")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    // Get learning events
    const { data: learningEvents = [] } = await supabase
      .from("learning_events")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    return {
      businessName: business.business_name,
      businessProfile: business.business_profile,
      missionDetail,
      targetCustomers: business.business_profile?.target_customers,
      offer: business.business_profile?.offer,
      painPoints: business.business_profile?.pain_points,
      leadSummary: leadSummary.total > 0 ? leadSummary : null,
      assignedAgentName,
      callResults: (callResults ?? []) as CallResult[],
      learningEvents: (learningEvents ?? []) as LearningEvent[],
    };
  } catch (error) {
    console.error("[Workflow Brain] Failed to fetch business context:", error);
    return {};
  }
}
