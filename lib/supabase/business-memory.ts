import { supabase } from "@/lib/supabase";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";

// ─── Business Profile ────────────────────────────────────────────────────────

export async function getBusinessProfile(userId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[Zeya] getBusinessProfile failed:", error);
    throw error;
  }
  return data;
}

export async function initBusinessProfile(userId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .insert({
      user_id: userId,
      business_name: null,
      industry: null,
      business_profile: {},
      memory_summary: null,
    })
    .select()
    .single();

  if (error) {
    console.error("[Zeya] initBusinessProfile failed:", error);
    throw error;
  }
  return data;
}

export async function updateBusinessProfile(businessId: string, memory: Partial<BusinessMemory>) {
  const updates: Record<string, unknown> = {};

  if (memory.business_name !== undefined) updates.business_name = memory.business_name;
  if (memory.industry !== undefined) updates.industry = memory.industry;

  const profileFields = [
    "offer",
    "target_customers",
    "differentiators",
    "acquisition_channels",
    "preferred_tone",
    "pain_points",
    "objections",
    "goals",
  ] as const;

  const profileUpdates: Record<string, unknown> = {};
  for (const field of profileFields) {
    if (memory[field] !== undefined) profileUpdates[field] = memory[field];
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { data: existing, error: fetchError } = await supabase
      .from("businesses")
      .select("business_profile")
      .eq("id", businessId)
      .single();

    if (fetchError) {
      console.error("[Zeya] updateBusinessProfile fetch failed:", fetchError);
      throw fetchError;
    }

    updates.business_profile = {
      ...(existing?.business_profile ?? {}),
      ...profileUpdates,
    };
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("businesses")
    .update(updates)
    .eq("id", businessId)
    .select()
    .single();

  if (error) {
    console.error("[Zeya] updateBusinessProfile update failed:", error);
    throw error;
  }
  return data;
}

export async function setMemorySummary(businessId: string, summary: string) {
  const { data, error } = await supabase
    .from("businesses")
    .update({ memory_summary: summary, updated_at: new Date().toISOString() })
    .eq("id", businessId)
    .select()
    .single();

  if (error) {
    console.error("[Zeya] setMemorySummary failed:", error);
    throw error;
  }
  return data;
}

// ─── Memory Events ───────────────────────────────────────────────────────────

export async function appendMemoryEvent(
  businessId: string,
  eventType: "onboarding_answer" | "correction" | "confirmation" | "update",
  payload: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from("memory_events")
    .insert({
      business_id: businessId,
      event_type: eventType,
      metadata: payload,
    })
    .select()
    .single();

  if (error) {
    console.error("[Zeya] appendMemoryEvent failed:", error);
    throw error;
  }
  return data;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(businessId: string, intent: string) {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      business_id: businessId,
      intent,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[Zeya] createSession failed:", error);
    throw error;
  }
  return data;
}

export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error("[Zeya] appendMessage failed:", error);
    throw error;
  }
  return data;
}

export async function updateSessionSummary(sessionId: string, summary: string) {
  const { data, error } = await supabase
    .from("sessions")
    .update({
      summary,
      ended_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    console.error("[Zeya] updateSessionSummary failed:", error);
    throw error;
  }
  return data;
}
