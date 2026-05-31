// Memory Persistence Layer — Save and retrieve memory events from Supabase
// No API endpoints, no migrations — uses existing database patterns

import type { MemoryEvent, MemoryQuery, MemoryQueryResult, MemoryPersistenceResult } from "./memory-types";
import { buildBusinessKnowledge, deriveLearningEvents } from "./memory-engine";

// Re-export MemoryEvent for convenience
export type { MemoryEvent };

// ─── Save Memory Events ──────────────────────────────────────────────────────

export async function saveMemoryEvent(
  supabase: any,
  event: Omit<MemoryEvent, "id" | "createdAt" | "updatedAt">
): Promise<MemoryEvent | null> {
  try {
    const now = new Date().toISOString();
    const eventWithTimestamps: MemoryEvent = {
      ...event,
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: now,
      updatedAt: now,
    };

    // Save to memory_events table (existing table)
    const { data, error } = await supabase
      .from("memory_events")
      .insert([
        {
          id: eventWithTimestamps.id,
          business_id: eventWithTimestamps.businessId,
          type: eventWithTimestamps.type,
          category: eventWithTimestamps.category,
          source: eventWithTimestamps.source,
          field: eventWithTimestamps.field,
          previous_value: eventWithTimestamps.previousValue,
          new_value: eventWithTimestamps.newValue,
          confidence: eventWithTimestamps.confidence,
          strength: eventWithTimestamps.strength || "moderate",
          created_at: eventWithTimestamps.createdAt,
          updated_at: eventWithTimestamps.updatedAt,
          expires_at: eventWithTimestamps.expiresAt || null,
          related_event_ids: eventWithTimestamps.relatedEventIds || [],
          notes: eventWithTimestamps.notes || null,
        },
      ])
      .select();

    if (error) {
      console.error("[Memory] Failed to save event:", error);
      return null;
    }

    return eventWithTimestamps;
  } catch (err) {
    console.error("[Memory] Save event error:", err);
    return null;
  }
}

export async function saveMemoryEvents(
  supabase: any,
  events: Omit<MemoryEvent, "id" | "createdAt" | "updatedAt">[]
): Promise<MemoryPersistenceResult> {
  const savedEventIds: string[] = [];
  const errors: string[] = [];

  // Save all events
  for (const event of events) {
    const saved = await saveMemoryEvent(supabase, event);
    if (saved) {
      savedEventIds.push(saved.id);
    } else {
      errors.push(`Failed to save event: ${event.type}`);
    }
  }

  // Derive learnings from all events
  const allEvents = events.map((e, i) => ({
    ...e,
    id: `mem_${Date.now()}_${i}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const learnings = deriveLearningEvents(allEvents);

  // Build updated knowledge
  const knowledge = buildBusinessKnowledge(allEvents);

  return {
    success: errors.length === 0,
    savedEventIds,
    newLearnings: learnings,
    updatedKnowledge: knowledge,
    errors,
  };
}

// ─── Retrieve Memory Events ──────────────────────────────────────────────────

export async function getMemoryEvents(
  supabase: any,
  query: MemoryQuery
): Promise<MemoryQueryResult | null> {
  try {
    let queryBuilder = supabase
      .from("memory_events")
      .select("*", { count: "exact" })
      .eq("business_id", query.businessId);

    // Apply filters
    if (query.category) {
      queryBuilder = queryBuilder.eq("category", query.category);
    }

    if (query.source) {
      queryBuilder = queryBuilder.eq("source", query.source);
    }

    if (query.field) {
      queryBuilder = queryBuilder.eq("field", query.field);
    }

    if (query.since) {
      queryBuilder = queryBuilder.gte("created_at", query.since);
    }

    if (query.until) {
      queryBuilder = queryBuilder.lte("created_at", query.until);
    }

    // Sort by creation date descending
    queryBuilder = queryBuilder
      .order("created_at", { ascending: false })
      .limit(query.limit || 100);

    const { data, count, error } = await queryBuilder;

    if (error) {
      console.error("[Memory] Failed to fetch events:", error);
      return null;
    }

    const events: MemoryEvent[] = (data || []).map((row: any) => ({
      id: row.id,
      businessId: row.business_id,
      type: row.type,
      category: row.category,
      source: row.source,
      field: row.field,
      previousValue: row.previous_value,
      newValue: row.new_value,
      confidence: row.confidence,
      strength: row.strength,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      relatedEventIds: row.related_event_ids,
      notes: row.notes,
    }));

    return {
      events,
      total: count || 0,
      hasMore: (count || 0) > (query.limit || 100),
    };
  } catch (err) {
    console.error("[Memory] Fetch events error:", err);
    return null;
  }
}

export async function getMemoryEventsByBusiness(
  supabase: any,
  businessId: string
): Promise<MemoryEvent[]> {
  const result = await getMemoryEvents(supabase, {
    businessId,
    limit: 1000,
  });

  return result?.events || [];
}

// ─── Memory Context for Workflow ─────────────────────────────────────────────

export async function getMemoryContextForWorkflow(
  supabase: any,
  businessId: string
): Promise<{
  recentEvents: MemoryEvent[];
  knowledge: ReturnType<typeof buildBusinessKnowledge>;
} | null> {
  try {
    // Get recent events (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await getMemoryEvents(supabase, {
      businessId,
      since: thirtyDaysAgo,
      limit: 500,
    });

    if (!result) return null;

    const knowledge = buildBusinessKnowledge(result.events);

    return {
      recentEvents: result.events,
      knowledge,
    };
  } catch (err) {
    console.error("[Memory] Get context error:", err);
    return null;
  }
}

// ─── Update Memory Event ─────────────────────────────────────────────────────

export async function updateMemoryEvent(
  supabase: any,
  eventId: string,
  updates: Partial<Omit<MemoryEvent, "id" | "businessId" | "createdAt">>
): Promise<MemoryEvent | null> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("memory_events")
      .update({
        ...updates,
        updated_at: now,
      })
      .eq("id", eventId)
      .select()
      .single();

    if (error) {
      console.error("[Memory] Failed to update event:", error);
      return null;
    }

    return {
      id: data.id,
      businessId: data.business_id,
      type: data.type,
      category: data.category,
      source: data.source,
      field: data.field,
      previousValue: data.previous_value,
      newValue: data.new_value,
      confidence: data.confidence,
      strength: data.strength,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      expiresAt: data.expires_at,
      relatedEventIds: data.related_event_ids,
      notes: data.notes,
    };
  } catch (err) {
    console.error("[Memory] Update event error:", err);
    return null;
  }
}
