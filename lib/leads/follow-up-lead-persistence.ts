import { supabase } from "@/lib/supabase";
import type { FollowUpLead } from "@/types/experience";

export async function persistFollowUpLead(
  userId: string | undefined,
  data: {
    name: string;
    email: string;
    phone?: string;
    businessSummary?: string;
    goal?: string;
    representationFit: "high" | "medium" | "low";
  }
): Promise<FollowUpLead> {
  const leadId = `follow_up_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const lead: FollowUpLead = {
    id: leadId,
    visitorName: data.name,
    visitorEmail: data.email,
    visitorPhone: data.phone || "",
    businessSummary: data.businessSummary,
    goal: (data.goal as any) || undefined,
    representationFit: data.representationFit,
    capturedAt: new Date().toISOString(),
  };

  try {
    if (!userId) {
      console.log("[FollowUp] Skipping persistence for anonymous user", { leadId });
      return lead;
    }

    const { error } = await supabase.from("follow_up_leads").insert({
      id: leadId,
      user_id: userId,
      visitor_name: data.name,
      visitor_email: data.email,
      visitor_phone: data.phone || null,
      business_summary: data.businessSummary || null,
      goal: data.goal || null,
      representation_fit: data.representationFit,
      captured_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[FollowUp] Failed to persist lead", { leadId, error: error.message });
      throw error;
    }

    console.log("[FollowUp] Lead persisted successfully", { leadId, email: data.email });
    return lead;
  } catch (error) {
    console.error("[FollowUp] Persistence error", { leadId, error });
    // Don't throw - let the UI know it captured locally even if persistence fails
    return lead;
  }
}
