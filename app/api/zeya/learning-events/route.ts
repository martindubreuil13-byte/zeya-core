// GET /api/zeya/learning-events?businessId=...&missionKey=...
// POST /api/zeya/learning-events

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createLearningEvent, getLearningEvents } from "@/lib/supabase/learning-layer";
import type { CreateLearningEventInput } from "@/types/zeya/learning";

type RouteDbClient = NonNullable<Parameters<typeof getLearningEvents>[2]>;
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
  const missionKey = searchParams.get("missionKey");

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  try {
    const learningEvents = await getLearningEvents(businessId, missionKey, routeDb.db);
    return NextResponse.json({ learningEvents });
  } catch (err) {
    console.error("[Zeya] learning-events GET failed:", err);
    return NextResponse.json({ error: "Failed to fetch learning events." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const routeDb = getRouteDb(req);
  if (!routeDb.ok) {
    const status = routeDb.error.startsWith("Missing") ? 401 : 500;
    return NextResponse.json({ error: routeDb.error }, { status });
  }

  let body: CreateLearningEventInput;
  try {
    body = (await req.json()) as CreateLearningEventInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.businessId || !body.learningType || !body.title) {
    return NextResponse.json(
      { error: "businessId, learningType, and title are required." },
      { status: 400 },
    );
  }

  try {
    const learningEvent = await createLearningEvent(body, routeDb.db);
    return NextResponse.json({ learningEvent }, { status: 201 });
  } catch (err) {
    console.error("[Zeya] learning-events POST failed:", err);
    return NextResponse.json({ error: "Failed to create learning event." }, { status: 500 });
  }
}
