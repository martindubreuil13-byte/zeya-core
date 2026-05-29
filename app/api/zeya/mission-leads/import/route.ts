// POST /api/zeya/mission-leads/import
// Receives pre-classified leads from the browser, inserts into mission_leads.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { ClassifiedLead, FitStatus } from "@/lib/leads/types";

interface RequestBody {
  businessId: string;
  missionKey: string | null;
  leads: ClassifiedLead[];
  source: "paste" | "csv" | "manual";
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { businessId, missionKey, leads, source } = body;
  if (!businessId || !Array.isArray(leads)) {
    return NextResponse.json({ error: "businessId and leads are required." }, { status: 400 });
  }
  if (leads.length === 0) {
    return NextResponse.json({ error: "No leads to import." }, { status: 400 });
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

  const rows = leads.map((l) => ({
    business_id:  businessId,
    mission_key:  missionKey ?? null,
    company_name: l.company_name ?? null,
    contact_name: l.contact_name ?? null,
    phone:        l.phone ?? null,
    email:        l.email ?? null,
    website:      l.website ?? null,
    industry:     l.industry ?? null,
    city:         l.city ?? null,
    country:      l.country ?? null,
    source:       source,
    notes:        l.notes ?? null,
    fit_status:   l.fit_status,
    status:       "new",
  }));

  const { error } = await db.from("mission_leads").insert(rows);
  if (error) {
    console.error("[Zeya] import leads failed:", error);
    return NextResponse.json({ error: "Failed to import leads." }, { status: 500 });
  }

  const counts = leads.reduce(
    (acc, l) => {
      if (l.fit_status === "likely_match")   acc.likelyMatch++;
      else if (l.fit_status === "possible_match") acc.possibleMatch++;
      else acc.weakMatch++;
      return acc;
    },
    { likelyMatch: 0, possibleMatch: 0, weakMatch: 0 },
  );

  return NextResponse.json({ imported: leads.length, ...counts });
}
