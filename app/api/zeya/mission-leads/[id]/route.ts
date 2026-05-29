// PATCH /api/zeya/mission-leads/:id
// Updates status, fit_status, or notes on a single lead.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Lead ID is required." }, { status: 400 });
  }

  let updates: Record<string, string>;
  try {
    updates = (await req.json()) as Record<string, string>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const allowed = new Set(["status", "fit_status", "notes"]);
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.has(k)),
  );

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }

  const useServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const db = createClient(supabaseUrl, supabaseKey, {
    global: useServiceRole ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await db
    .from("mission_leads")
    .update(filtered)
    .eq("id", id);

  if (error) {
    console.error("[Zeya] updateLead failed:", error);
    return NextResponse.json({ error: "Failed to update lead." }, { status: 500 });
  }

  return NextResponse.json({ updated: true });
}
