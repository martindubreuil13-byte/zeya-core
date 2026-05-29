// GET /api/zeya/mission-leads?businessId=...&missionKey=...

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const businessId = searchParams.get("businessId");
  const missionKey = searchParams.get("missionKey");
  const fitStatus  = searchParams.get("fitStatus");

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

  let query = db
    .from("mission_leads")
    .select("*")
    .eq("business_id", businessId)
    .order("fit_status", { ascending: true })
    .order("created_at", { ascending: false });

  if (missionKey) query = query.eq("mission_key", missionKey);
  if (fitStatus)  query = query.eq("fit_status", fitStatus);

  const { data, error } = await query;
  if (error) {
    console.error("[Zeya] getLeads failed:", error);
    return NextResponse.json({ error: "Failed to fetch leads." }, { status: 500 });
  }

  return NextResponse.json({ leads: data ?? [] });
}
