// GET /api/zeya/call-results?businessId=...&assignmentId=...&leadId=...
// POST /api/zeya/call-results

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createCallResult, getCallResults } from "@/lib/supabase/learning-layer";
import type { CreateCallResultInput } from "@/types/zeya/learning";

type RouteDbClient = NonNullable<Parameters<typeof getCallResults>[2]>;
type RouteDbResult =
  | { ok: true; db: RouteDbClient }
  | { ok: false; error: string };

function getRouteDb(req: NextRequest): RouteDbResult {
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return { ok: false, error: "Missing Authorization header." };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, error: "Supabase not configured." };

  const useServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const db = createClient(supabaseUrl, supabaseKey, {
    global: useServiceRole ? {} : { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { ok: true, db };
}

export async function GET(req: NextRequest) {
  const routeDb = getRouteDb(req);
  if (!routeDb.ok) {
    const status = routeDb.error.startsWith("Missing") ? 401 : 500;
    return NextResponse.json({ error: routeDb.error }, { status });
  }

  const { searchParams } = req.nextUrl;
  const businessId = searchParams.get("businessId");
  const assignmentId = searchParams.get("assignmentId");
  const leadId = searchParams.get("leadId");

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  try {
    const callResults = await getCallResults(businessId, { assignmentId, leadId }, routeDb.db);
    return NextResponse.json({ callResults });
  } catch (err) {
    console.error("[Zeya] call-results GET failed:", err);
    return NextResponse.json({ error: "Failed to fetch call results." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const routeDb = getRouteDb(req);
  if (!routeDb.ok) {
    const status = routeDb.error.startsWith("Missing") ? 401 : 500;
    return NextResponse.json({ error: routeDb.error }, { status });
  }

  let body: CreateCallResultInput;
  try {
    body = (await req.json()) as CreateCallResultInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.businessId || !body.outcome) {
    return NextResponse.json({ error: "businessId and outcome are required." }, { status: 400 });
  }

  try {
    const callResult = await createCallResult(body, routeDb.db);
    return NextResponse.json({ callResult }, { status: 201 });
  } catch (err) {
    console.error("[Zeya] call-results POST failed:", err);
    return NextResponse.json({ error: "Failed to create call result." }, { status: 500 });
  }
}
