// GET /api/zeya/mission-assignments?businessId=...&missionKey=...
// POST /api/zeya/mission-assignments

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

interface CreateAssignmentBody {
  businessId: string;
  missionKey: string;
  agentId: string;
  briefSnapshot?: string | null;
  selectedLeadCount?: number;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const businessId = searchParams.get("businessId");
  const missionKey = searchParams.get("missionKey");

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
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

  try {
    let query = db
      .from("mission_assignments")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (missionKey) {
      query = query.eq("mission_key", missionKey);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Zeya] fetch mission_assignments failed:", error);
      return NextResponse.json({ error: "Failed to fetch assignments." }, { status: 500 });
    }

    return NextResponse.json({ assignments: data ?? [] });
  } catch (err) {
    console.error("[Zeya] mission-assignments GET failed:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  let body: CreateAssignmentBody;
  try {
    body = (await req.json()) as CreateAssignmentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { businessId, missionKey, agentId, briefSnapshot, selectedLeadCount } = body;

  if (!businessId || !missionKey || !agentId) {
    return NextResponse.json(
      { error: "businessId, missionKey, and agentId are required." },
      { status: 400 }
    );
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

  try {
    const { data, error } = await db
      .from("mission_assignments")
      .insert({
        business_id: businessId,
        mission_key: missionKey,
        agent_id: agentId,
        assignment_type: "caller_brief",
        status: "pending",
        brief_snapshot: briefSnapshot ?? null,
        selected_lead_count: selectedLeadCount ?? 0,
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error("[Zeya] create mission_assignment failed:", error);
      return NextResponse.json({ error: "Failed to create assignment." }, { status: 500 });
    }

    return NextResponse.json({ assignment: data }, { status: 201 });
  } catch (err) {
    console.error("[Zeya] mission-assignments POST failed:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
