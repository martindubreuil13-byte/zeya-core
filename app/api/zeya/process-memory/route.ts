// Background memory processing endpoint.
// Called asynchronously after a realtime session ends — NOT during the voice turn.
//
// Flow:
//   1. Validate request + auth (user JWT required for RLS)
//   2. Dedup: skip if this session was already processed (processing_checkpoint)
//   3. Fetch session messages from DB
//   4. Compact fragmented transcript turns
//   5. Extract structured memory events
//   6. Batch-insert events into memory_events
//   7. Update business_profile with first-seen key fields (non-destructive)
//   8. Write processing_checkpoint to prevent duplicate runs

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { compactTranscript } from "@/lib/memory/compact-transcript";
import { extractMemoryEvents } from "@/lib/memory/extract-memory";

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

  // ── Supabase client (user-authenticated, respects RLS) ────────────────────
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

  // ── Dedup: skip if already processed ────────────────────────────────────
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

  // ── Compact ───────────────────────────────────────────────────────────────
  const rawTurns = rawMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: (m.content ?? "") as string,
    created_at: (m.created_at ?? new Date().toISOString()) as string,
  }));

  const compacted = compactTranscript(rawTurns);
  serverLog("compaction done", {
    raw: rawTurns.length,
    compacted: compacted.length,
  });

  // ── Extract ───────────────────────────────────────────────────────────────
  const extracted = extractMemoryEvents(compacted);
  serverLog("extraction done", { events: extracted.length });

  const now = new Date().toISOString();

  // ── Persist memory events ─────────────────────────────────────────────────
  if (extracted.length > 0) {
    const rows = extracted.map((e) => ({
      business_id: businessId,
      event_type: e.event_type,
      content: e.content,
      metadata: {
        session_id: sessionId,
        source: "realtime_memory_processor",
        compacted: true,
      },
    }));

    const { error: insertErr } = await db.from("memory_events").insert(rows);
    if (insertErr) {
      serverLog("event insert failed", { error: String(insertErr) });
      return NextResponse.json({ error: "Failed to persist memory events." }, { status: 500 });
    }
  }

  // ── Update business_profile (non-destructive: only fill empty fields) ─────
  const fieldMap: Record<string, string> = {
    offer: extracted.find((e) => e.event_type === "offer")?.content ?? "",
    target_customers: extracted.find((e) => e.event_type === "icp")?.content ?? "",
    pain_points: extracted.find((e) => e.event_type === "pain_point")?.content ?? "",
    preferred_tone: extracted.find((e) => e.event_type === "tone")?.content ?? "",
    objections: extracted.find((e) => e.event_type === "objection")?.content ?? "",
  };

  const nameExtracted = extracted.find((e) => e.event_type === "business_name")?.content;
  const hasProfileUpdates = Object.values(fieldMap).some(Boolean) || nameExtracted;

  if (hasProfileUpdates) {
    const { data: biz } = await db
      .from("businesses")
      .select("business_name, business_profile")
      .eq("id", businessId)
      .maybeSingle();

    const existingProfile = (biz?.business_profile as Record<string, unknown>) ?? {};
    const updatedProfile: Record<string, unknown> = { ...existingProfile };

    for (const [field, value] of Object.entries(fieldMap)) {
      if (value && !existingProfile[field]) updatedProfile[field] = value;
    }

    const bizUpdates: Record<string, unknown> = {
      business_profile: updatedProfile,
      updated_at: now,
    };

    if (nameExtracted && !biz?.business_name) {
      bizUpdates.business_name = nameExtracted;
    }

    await db.from("businesses").update(bizUpdates).eq("id", businessId);
    serverLog("business profile updated", { fields: Object.keys(fieldMap).filter((k) => fieldMap[k]) });
  }

  // ── Write processing checkpoint ───────────────────────────────────────────
  await db.from("memory_events").insert({
    business_id: businessId,
    event_type: "processing_checkpoint",
    content: `Processed ${extracted.length} event(s) from ${rawTurns.length} turn(s) (compacted to ${compacted.length})`,
    metadata: {
      session_id: sessionId,
      processed_at: now,
      event_count: extracted.length,
      raw_count: rawTurns.length,
      compacted_count: compacted.length,
    },
  });

  serverLog("processing complete", {
    sessionId,
    raw: rawTurns.length,
    compacted: compacted.length,
    events: extracted.length,
  });

  return NextResponse.json({
    processed: true,
    turns: { raw: rawTurns.length, compacted: compacted.length },
    events: extracted.length,
  });
}
