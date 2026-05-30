// GET /api/zeya/sales-agents?businessId=...
// Returns list of sales agents for a business. Ensures default agent exists.

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
    // Ensure default agent exists
    await db.rpc("ensure_default_agent", { p_business_id: businessId });

    // Fetch all agents
    const { data, error } = await db
      .from("sales_agents")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Zeya] fetch sales_agents failed:", error);
      return NextResponse.json({ error: "Failed to fetch agents." }, { status: 500 });
    }

    return NextResponse.json({ agents: data ?? [] });
  } catch (err) {
    console.error("[Zeya] sales-agents GET failed:", err);
    return NextResponse.json({ error: "Request failed." }, { status: 500 });
  }
}
