import { supabase } from "@/lib/supabase";
import type { Lead, LeadSummary, ClassifiedLead } from "@/lib/leads/types";

// ─── Insert ───────────────────────────────────────────────────────────────────

export async function insertLeads(
  businessId: string,
  missionKey: string | null,
  leads: ClassifiedLead[],
  source: string,
): Promise<Lead[]> {
  const rows = leads.map((l) => ({
    business_id:  businessId,
    mission_key:  missionKey,
    company_name: l.company_name ?? null,
    contact_name: l.contact_name ?? null,
    phone:        l.phone ?? null,
    email:        l.email ?? null,
    website:      l.website ?? null,
    industry:     l.industry ?? null,
    city:         l.city ?? null,
    country:      l.country ?? null,
    source:       source,
    notes:        l.notes ?? null,
    fit_status:   l.fit_status,
    status:       "new" as const,
  }));

  const { data, error } = await supabase
    .from("mission_leads")
    .insert(rows)
    .select();

  if (error) {
    console.error("[Zeya] insertLeads failed:", error);
    throw error;
  }
  return (data ?? []) as Lead[];
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function getLeads(
  businessId: string,
  missionKey?: string | null,
): Promise<Lead[]> {
  let query = supabase
    .from("mission_leads")
    .select("*")
    .eq("business_id", businessId)
    .order("fit_status", { ascending: true })  // likely first
    .order("created_at", { ascending: false });

  if (missionKey) query = query.eq("mission_key", missionKey);

  const { data, error } = await query;
  if (error) {
    console.error("[Zeya] getLeads failed:", error);
    return [];
  }
  return (data ?? []) as Lead[];
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getLeadSummary(
  businessId: string,
  missionKey?: string | null,
): Promise<LeadSummary> {
  let query = supabase
    .from("mission_leads")
    .select("fit_status, status")
    .eq("business_id", businessId);

  if (missionKey) query = query.eq("mission_key", missionKey);

  const { data, error } = await query;
  if (error || !data) return { total: 0, likelyMatch: 0, possibleMatch: 0, weakMatch: 0, selected: 0 };

  return {
    total:         data.length,
    likelyMatch:   data.filter((r) => r.fit_status === "likely_match").length,
    possibleMatch: data.filter((r) => r.fit_status === "possible_match").length,
    weakMatch:     data.filter((r) => r.fit_status === "weak_match").length,
    selected:      data.filter((r) => r.status === "selected").length,
  };
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateLead(
  leadId: string,
  updates: Partial<Pick<Lead, "status" | "fit_status" | "notes">>,
): Promise<void> {
  const { error } = await supabase
    .from("mission_leads")
    .update(updates)
    .eq("id", leadId);

  if (error) {
    console.error("[Zeya] updateLead failed:", error);
    throw error;
  }
}
