// Memory event repository — persist MemoryEvents to existing memory_events table

import { createClient } from "@supabase/supabase-js";
import type { MemoryEvent } from "../../memory/events/memory-event-types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface PersistedMemoryEvent {
  id: string;
  business_id: string;
  event_type: string;
  content: string;
  metadata?: unknown;
  source: string;
  created_at: string;
  updated_at: string;
  importance?: string;
  summary?: string;
}

/**
 * Save MemoryEvent to Supabase memory_events table
 * Maps Phase 12A MemoryEvent fields to actual memory_events schema
 * Note: Requires business_id; if not available, defaults to empty string (caller must provide context)
 */
export async function saveMemoryEvent(event: MemoryEvent, businessId?: string): Promise<boolean> {
  console.log("[memory-event-repo] 🔵 Checking Supabase client", {
    configured: !!supabase,
  });

  if (!supabase) {
    console.error("[memory-event-repo] 🔴 Supabase not configured, skipping persistence", {
      memoryType: event.memoryType,
    });
    return false;
  }

  try {
    console.log("[memory-event-repo] 🔵 Inserting memory event into memory_events table", {
      memoryType: event.memoryType,
      source: event.source,
    });

    const { error } = await supabase
      .from("memory_events")
      .insert([
        {
          business_id: businessId || "",
          event_type: event.memoryType,
          content: JSON.stringify(event.payload || {}),
          metadata: event.payload,
          source: event.source,
          updated_at: new Date().toISOString(),
        },
      ]);

    if (error) {
      console.error("[memory-event-repo] 🔴 Supabase INSERT failed", {
        memoryType: event.memoryType,
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return false;
    }

    console.log("[memory-event-repo] 🟢 Memory event successfully inserted", {
      memoryType: event.memoryType,
      source: event.source,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-event-repo] 🔴 Unexpected error saving memory event", {
      memoryType: event.memoryType,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}

/**
 * Get memory event from Supabase by ID
 */
export async function getMemoryEventById(
  id: string
): Promise<PersistedMemoryEvent | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("memory_events")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code !== "PGRST116") {
        console.error("[memory-event-repo] Error fetching memory event:", error.message);
      }
      return null;
    }

    return data as PersistedMemoryEvent;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-event-repo] Unexpected error fetching memory event:", message);
    return null;
  }
}

/**
 * Get recent memory events from Supabase
 */
export async function listRecentMemoryEvents(
  limit: number = 50
): Promise<PersistedMemoryEvent[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("memory_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[memory-event-repo] Error listing memory events:", error.message);
      return [];
    }

    return (data as PersistedMemoryEvent[]) || [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-event-repo] Unexpected error listing memory events:", message);
    return [];
  }
}

/**
 * Count memory events in Supabase
 */
export async function countMemoryEvents(): Promise<number> {
  if (!supabase) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from("memory_events")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error("[memory-event-repo] Error counting memory events:", error.message);
      return 0;
    }

    return count || 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-event-repo] Unexpected error counting memory events:", message);
    return 0;
  }
}

/**
 * Load recent memory events from Supabase (for recovery)
 * Maps actual memory_events columns to MemoryEvent interface
 */
export async function loadRecentMemoryEvents(limit: number = 100): Promise<MemoryEvent[]> {
  if (!supabase) {
    return [];
  }

  try {
    const persisted = await listRecentMemoryEvents(limit);

    return persisted.map((p) => ({
      memoryEventId: p.id,
      memoryType: p.event_type as any,
      source: p.source as any,
      sourceId: p.id, // Use id since source_id doesn't exist in actual schema
      workerBriefId: null, // Not available in actual schema
      conversationId: "", // Not available in actual schema
      confidence: 0.5, // Not available in actual schema
      payload: p.metadata || {},
      createdAt: p.created_at,
    })) as MemoryEvent[];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[memory-event-repo] Error loading memory events for recovery:", message);
    return [];
  }
}
