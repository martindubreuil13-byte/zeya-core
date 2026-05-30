// POST /api/zeya/caller-brief/generate
// Generate and save a caller brief from mission context.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { generateCallerBrief, formatBriefAsMarkdown } from "@/lib/mission/caller-brief";
import type { BriefContext } from "@/lib/mission/caller-brief";

interface RequestBody {
  businessId: string;
  missionName: string;
  targetSegment: string;
  hypothesis: string;
  salesAngle: string;
  selectedLeadsCount: number;
  selectedCompanies: string[];
  offer: string | null;
  icp: string | null;
  positioning: string | null;
  objections: string | null;
  salesArguments: string | null;
  knownFacts: string | null;
  assumptions: string | null;
  validatedLearnings: string | null;
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

  const { businessId } = body;
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
    // Build context for brief generation
    const briefContext: BriefContext = {
      missionName: body.missionName,
      targetSegment: body.targetSegment,
      hypothesis: body.hypothesis,
      salesAngle: body.salesAngle,
      selectedLeadsCount: body.selectedLeadsCount,
      selectedCompanies: body.selectedCompanies,
      offer: body.offer,
      icp: body.icp,
      positioning: body.positioning,
      objections: body.objections,
      salesArguments: body.salesArguments,
      knownFacts: body.knownFacts,
      assumptions: body.assumptions,
      validatedLearnings: body.validatedLearnings,
    };

    // Generate brief
    const brief = generateCallerBrief(briefContext);

    // Format as markdown for storage
    const briefMarkdown = formatBriefAsMarkdown(brief);

    // Save to business_profile.caller_brief
    const { data: bizRow, error: fetchError } = await db
      .from("businesses")
      .select("business_profile")
      .eq("id", businessId)
      .maybeSingle();

    if (fetchError) {
      console.error("[Zeya] fetch business failed:", fetchError);
      return NextResponse.json({ error: "Failed to fetch business." }, { status: 500 });
    }

    const profile = typeof bizRow?.business_profile === "object" ? bizRow.business_profile : {};
    const updated = { ...profile, caller_brief: briefMarkdown };

    const { error: updateError } = await db
      .from("businesses")
      .update({ business_profile: updated })
      .eq("id", businessId);

    if (updateError) {
      console.error("[Zeya] update business_profile failed:", updateError);
      return NextResponse.json({ error: "Failed to save brief." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      brief: briefMarkdown,
      generatedAt: brief.generatedAt,
    });
  } catch (err) {
    console.error("[Zeya] caller-brief generate failed:", err);
    return NextResponse.json({ error: "Brief generation failed." }, { status: 500 });
  }
}
