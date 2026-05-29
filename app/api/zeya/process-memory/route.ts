// Background memory processing endpoint — runs after a session ends, never during.
//
// Flow:
//   1. Auth + body parse
//   2. Dedup: skip if session already processed (processing_checkpoint)
//   3. Fetch session messages + intent, compact transcript
//   4. Fetch existing business_profile for context
//   5. LLM synthesis: extractOperationalMemory → structured cognition
//   6. Fallback: regex extraction if LLM fails
//   7. Persist memory_events (operational format, content field populated)
//   8. Intelligent merge of business_profile
//   9. Write synthesis fields (last_session_synthesis, strategic_focus, etc.)
//  10. Write processing_checkpoint

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { compactTranscript } from "@/lib/memory/compact-transcript";
import { extractMemoryEvents } from "@/lib/memory/extract-memory";
import {
  extractOperationalMemory,
  EMPTY_EXTRACTION,
} from "@/lib/memory/extract-operational-memory";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";

interface RequestBody {
  sessionId: string;
  businessId: string;
}

function serverLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya process-memory] ${message}`, details ?? {});
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { sessionId, businessId } = body;
  if (!sessionId || !businessId) {
    return NextResponse.json(
      { error: "sessionId and businessId are required." },
      { status: 400 },
    );
  }

  // ── Supabase client ───────────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const useServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const db = createClient(supabaseUrl, supabaseKey, {
    global: useServiceRole
      ? {}
      : { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  serverLog("processing request", { sessionId, businessId, useServiceRole });

  // ── Dedup ─────────────────────────────────────────────────────────────────
  const { data: existingCheckpoint } = await db
    .from("memory_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_type", "processing_checkpoint")
    .contains("metadata", { session_id: sessionId })
    .maybeSingle();

  if (existingCheckpoint) {
    serverLog("skipping — already processed", { sessionId });
    return NextResponse.json({ skipped: true, reason: "already_processed" });
  }

  // ── Fetch messages ────────────────────────────────────────────────────────
  const { data: rawMessages, error: msgErr } = await db
    .from("messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (msgErr) {
    serverLog("message fetch failed", { error: String(msgErr) });
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: 500 });
  }

  if (!rawMessages?.length) {
    serverLog("no messages, skipping", { sessionId });
    return NextResponse.json({ skipped: true, reason: "no_messages" });
  }

  // ── Fetch session intent for session_type ─────────────────────────────────
  const { data: sessionRow } = await db
    .from("sessions")
    .select("intent")
    .eq("id", sessionId)
    .maybeSingle();

  const sessionType: "onboarding" | "briefing" =
    sessionRow?.intent?.includes("onboarding") ? "onboarding" : "briefing";

  serverLog("session type", { sessionType, intent: sessionRow?.intent });

  // ── Compact ───────────────────────────────────────────────────────────────
  const rawTurns = rawMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: (m.content ?? "") as string,
    created_at: (m.created_at ?? new Date().toISOString()) as string,
  }));

  const compacted = compactTranscript(rawTurns);
  serverLog("compaction done", { raw: rawTurns.length, compacted: compacted.length });

  // ── Fetch existing profile for intelligent merge context ──────────────────
  const { data: bizRow } = await db
    .from("businesses")
    .select("business_name, business_profile")
    .eq("id", businessId)
    .maybeSingle();

  const existingProfile = (bizRow?.business_profile as Partial<BusinessMemory> | null) ?? null;

  // ── LLM synthesis ─────────────────────────────────────────────────────────
  // extractOperationalMemory returns EMPTY_EXTRACTION on failure — never throws.
  const operationalMemory = await extractOperationalMemory({
    turns: compacted,
    existingProfile,
    sessionType,
  });

  const llmSucceeded =
    operationalMemory !== EMPTY_EXTRACTION &&
    (Object.keys(operationalMemory.business_profile_patch).length > 0 ||
      operationalMemory.memory_events.length > 0 ||
      operationalMemory.session_summary.length > 0);

  serverLog("LLM extraction done", {
    succeeded: llmSucceeded,
    patchFields: Object.keys(operationalMemory.business_profile_patch).length,
    events: operationalMemory.memory_events.length,
  });

  // ── Regex fallback ────────────────────────────────────────────────────────
  // Used only when the LLM extraction produced nothing useful.
  // Preserves the original extraction as a safety net, not as primary logic.
  const regexEvents = llmSucceeded ? [] : extractMemoryEvents(compacted);
  serverLog("regex fallback", { used: !llmSucceeded, events: regexEvents.length });

  const now = new Date().toISOString();

  // ── Persist memory_events ─────────────────────────────────────────────────
  const eventRows: Record<string, unknown>[] = [];

  if (llmSucceeded) {
    for (const evt of operationalMemory.memory_events) {
      if (!evt.content?.trim()) continue;

      const isCorrection = evt.type === "founder_correction";
      eventRows.push({
        business_id: businessId,
        event_type:  evt.type,
        content:     evt.content,
        metadata: {
          session_id:   sessionId,
          source:       "llm_memory_synthesis",
          importance:   evt.importance,
          session_type: sessionType,
          // Correction-specific fields — only populated when type is founder_correction
          ...(isCorrection && evt.field_changed ? {
            field_changed:     evt.field_changed,
            old_understanding: evt.old_understanding,
            new_understanding: evt.new_understanding,
            confidence:        "confirmed_by_founder",
          } : {}),
        },
      });
    }
  } else {
    for (const evt of regexEvents) {
      if (!evt.content?.trim()) continue;
      eventRows.push({
        business_id: businessId,
        event_type:  evt.event_type,
        content:     evt.content,
        metadata: {
          session_id: sessionId,
          source:     "regex_fallback",
          compacted:  true,
        },
      });
    }
  }

  if (eventRows.length > 0) {
    const { error: insertErr } = await db.from("memory_events").insert(eventRows);
    if (insertErr) {
      serverLog("event insert failed", { error: String(insertErr) });
      return NextResponse.json({ error: "Failed to persist memory events." }, { status: 500 });
    }
  }

  // ── Update business_profile ───────────────────────────────────────────────
  // Strategy: LLM already produced an intelligently merged patch (it saw existing
  // profile + new transcript). Apply non-null patch fields, overwriting existing
  // values — the LLM is trusted to produce improvements, not downgrades.
  // Synthesis fields (last_session_synthesis, strategic_focus, etc.) are only
  // written when the LLM produced a non-empty result.

  const profileUpdates: Record<string, unknown> = {
    ...(existingProfile ?? {}),
    ...operationalMemory.business_profile_patch,
  };

  if (llmSucceeded) {
    if (operationalMemory.session_summary) {
      profileUpdates.last_session_synthesis = operationalMemory.session_summary;
    }
    if (operationalMemory.recommended_next_focus) {
      profileUpdates.strategic_focus = operationalMemory.recommended_next_focus;
    }
    if (operationalMemory.current_mission) {
      profileUpdates.current_mission = operationalMemory.current_mission;
    }
    if (operationalMemory.strategic_gaps.length > 0) {
      profileUpdates.strategic_gaps = operationalMemory.strategic_gaps.join("\n");
    }
    if (operationalMemory.unresolved_tensions.length > 0) {
      profileUpdates.unresolved_tensions = operationalMemory.unresolved_tensions.join("\n");
    }
  } else if (regexEvents.length > 0) {
    // Regex fallback: only fill empty profile fields (original non-destructive logic)
    const fieldMap: Record<string, string> = {
      offer:            regexEvents.find((e) => e.event_type === "offer")?.content ?? "",
      target_customers: regexEvents.find((e) => e.event_type === "icp")?.content ?? "",
      pain_points:      regexEvents.find((e) => e.event_type === "pain_point")?.content ?? "",
      preferred_tone:   regexEvents.find((e) => e.event_type === "tone")?.content ?? "",
      objections:       regexEvents.find((e) => e.event_type === "objection")?.content ?? "",
    };
    for (const [field, value] of Object.entries(fieldMap)) {
      if (value && !existingProfile?.[field as keyof BusinessMemory]) {
        profileUpdates[field] = value;
      }
    }
  }

  // Derive business_name from extraction if not already set
  const nameExtracted = llmSucceeded
    ? (operationalMemory.business_profile_patch as Record<string, unknown>).business_name as string | undefined
    : regexEvents.find((e) => e.event_type === "business_name")?.content;

  const bizUpdates: Record<string, unknown> = {
    business_profile: profileUpdates,
    updated_at:       now,
  };
  if (nameExtracted && !bizRow?.business_name) {
    bizUpdates.business_name = nameExtracted;
  }

  await db.from("businesses").update(bizUpdates).eq("id", businessId);
  serverLog("business profile updated", {
    patchKeys: Object.keys(operationalMemory.business_profile_patch),
    synthesisFields: llmSucceeded
      ? ["last_session_synthesis", "strategic_focus"].filter(
          (f) => profileUpdates[f],
        )
      : [],
  });

  // ── Processing checkpoint ─────────────────────────────────────────────────
  await db.from("memory_events").insert({
    business_id: businessId,
    event_type:  "processing_checkpoint",
    content:     `Processed ${eventRows.length} event(s) from ${rawTurns.length} turn(s) (compacted to ${compacted.length}) via ${llmSucceeded ? "llm_synthesis" : "regex_fallback"}`,
    metadata: {
      session_id:     sessionId,
      processed_at:   now,
      event_count:    eventRows.length,
      raw_count:      rawTurns.length,
      compacted_count: compacted.length,
      extraction_method: llmSucceeded ? "llm_synthesis" : "regex_fallback",
    },
  });

  serverLog("processing complete", {
    sessionId,
    raw: rawTurns.length,
    compacted: compacted.length,
    events: eventRows.length,
    method: llmSucceeded ? "llm" : "regex",
  });

  return NextResponse.json({
    processed: true,
    method: llmSucceeded ? "llm_synthesis" : "regex_fallback",
    turns: { raw: rawTurns.length, compacted: compacted.length },
    events: eventRows.length,
    synthesis: llmSucceeded
      ? {
          summary: operationalMemory.session_summary,
          gaps: operationalMemory.strategic_gaps.length,
          tensions: operationalMemory.unresolved_tensions.length,
        }
      : null,
  });
}
