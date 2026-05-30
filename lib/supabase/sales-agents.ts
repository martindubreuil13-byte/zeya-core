import { supabase } from "@/lib/supabase";

export interface SalesAgent {
  id: string;
  business_id: string;
  name: string;
  role: string;
  status: "available" | "busy" | "inactive";
  language: string;
  voice_profile: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissionAssignment {
  id: string;
  business_id: string;
  mission_key: string;
  agent_id: string;
  assignment_type: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  brief_snapshot: string | null;
  selected_lead_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Sales Agents ────────────────────────────────────────────────────────────

export async function getSalesAgents(businessId: string): Promise<SalesAgent[]> {
  const { data, error } = await supabase
    .from("sales_agents")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[Zeya] getSalesAgents failed:", error);
    return [];
  }

  return (data ?? []) as SalesAgent[];
}

export async function getOrCreateDefaultAgent(businessId: string): Promise<SalesAgent | null> {
  try {
    const { data, error } = await supabase
      .rpc("ensure_default_agent", { p_business_id: businessId });

    if (error) {
      console.error("[Zeya] ensure_default_agent failed:", error);
      return null;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const result = data[0] as { agent_id: string; agent_name: string; agent_status: string };

    // Fetch full agent details
    const { data: agent } = await supabase
      .from("sales_agents")
      .select("*")
      .eq("id", result.agent_id)
      .maybeSingle();

    return (agent ?? null) as SalesAgent | null;
  } catch (err) {
    console.error("[Zeya] getOrCreateDefaultAgent failed:", err);
    return null;
  }
}

export async function createSalesAgent(
  businessId: string,
  name: string,
  role: string = "caller",
  language: string = "English"
): Promise<SalesAgent | null> {
  const { data, error } = await supabase
    .from("sales_agents")
    .insert({
      business_id: businessId,
      name,
      role,
      language,
      status: "available",
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error("[Zeya] createSalesAgent failed:", error);
    return null;
  }

  return (data ?? null) as SalesAgent | null;
}

// ─── Mission Assignments ─────────────────────────────────────────────────────

export async function getMissionAssignments(
  businessId: string,
  missionKey?: string
): Promise<MissionAssignment[]> {
  let query = supabase
    .from("mission_assignments")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (missionKey) {
    query = query.eq("mission_key", missionKey);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Zeya] getMissionAssignments failed:", error);
    return [];
  }

  return (data ?? []) as MissionAssignment[];
}

export async function getLatestMissionAssignment(
  businessId: string,
  missionKey: string
): Promise<MissionAssignment | null> {
  const { data, error } = await supabase
    .from("mission_assignments")
    .select("*")
    .eq("business_id", businessId)
    .eq("mission_key", missionKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Zeya] getLatestMissionAssignment failed:", error);
    return null;
  }

  return (data ?? null) as MissionAssignment | null;
}

export async function createMissionAssignment(
  businessId: string,
  missionKey: string,
  agentId: string,
  briefSnapshot: string | null = null,
  selectedLeadCount: number = 0
): Promise<MissionAssignment | null> {
  const { data, error } = await supabase
    .from("mission_assignments")
    .insert({
      business_id: businessId,
      mission_key: missionKey,
      agent_id: agentId,
      assignment_type: "caller_brief",
      status: "pending",
      brief_snapshot: briefSnapshot,
      selected_lead_count: selectedLeadCount,
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error("[Zeya] createMissionAssignment failed:", error);
    return null;
  }

  return (data ?? null) as MissionAssignment | null;
}

// ─── Lookup: Get agent info for an assignment ────────────────────────────────

export async function getAssignedAgentName(businessId: string, missionKey: string): Promise<string | null> {
  const assignment = await getLatestMissionAssignment(businessId, missionKey);
  if (!assignment) return null;

  const { data: agent } = await supabase
    .from("sales_agents")
    .select("name")
    .eq("id", assignment.agent_id)
    .maybeSingle();

  return agent?.name ?? null;
}
