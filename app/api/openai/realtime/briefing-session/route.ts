// Realtime session endpoint for briefing room voice sessions.
// Business context is resolved exclusively from authorized Canonical Representation State.
// Returns an ephemeral client_secret for WebRTC connection.

import { NextRequest, NextResponse } from "next/server";
import { buildBriefingSessionPrompt } from "@/lib/briefing-room/briefing-session-prompt";
import { createAuthenticatedRepresentationContext } from "@/lib/representation/api-auth";
import { assembleVoiceRepresentationContext } from "@/lib/voice/representation-context";
import { saveVoiceRepresentationLineage } from "@/lib/voice/persistence/representation-lineage-repository";
import { createClient } from "@supabase/supabase-js";

const OPENAI_REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/client_secrets";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI Realtime is not configured." }, { status: 500 });
  }

  const auth = await createAuthenticatedRepresentationContext(req);
  if (auth instanceof NextResponse) return auth;

  let businessId = "";
  let provisionalMode = false;
  let conversationId = "";
  try {
    const body = (await req.json()) as { businessId?: string; provisionalMode?: boolean; conversationId?: string };
    businessId = body.businessId ?? "";
    provisionalMode = body.provisionalMode === true;
    conversationId = typeof body.conversationId === "string" ? body.conversationId.slice(0, 200) : "";
  } catch {
    return NextResponse.json({ error: "Voice context request was invalid." }, { status: 400 });
  }

  if (!businessId) return NextResponse.json({ error: "Voice context is unavailable." }, { status: 404 });

  let voiceContext;
  const voiceContextId = crypto.randomUUID();
  try {
    voiceContext = await assembleVoiceRepresentationContext({
      db: auth.supabase,
      tenantUserId: auth.user.id,
      businessId,
      agent: { id: "zeya-realtime", type: "ZEYA", role: "strategic_briefing" },
      provisionalMode,
    });
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) throw new Error("Voice lineage storage unavailable");
    const trustedDb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    await saveVoiceRepresentationLineage({
      db: trustedDb,
      voiceContextId,
      workerBriefId: `zeya_${voiceContextId}`,
      missionId: "zeya_realtime_briefing",
      conversationId: conversationId || `zeya_${voiceContextId}`,
      lineage: voiceContext.lineage,
    });
  } catch {
    return NextResponse.json({ error: "Voice context is unavailable." }, { status: 404 });
  }

  const config = {
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
      instructions: buildBriefingSessionPrompt(voiceContext.systemContext),
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.35,
            prefix_padding_ms: 500,
            silence_duration_ms: 400,
            create_response: true,
            interrupt_response: true,
          },
          transcription: { model: "gpt-4o-mini-transcribe" },
        },
        output: {
          voice: process.env.OPENAI_REALTIME_VOICE ?? "sage",
        },
      },
    },
  };

  try {
    const res = await fetch(OPENAI_REALTIME_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Could not start briefing session." },
        { status: res.status },
      );
    }

    const data = JSON.parse(text) as Record<string, unknown>;
    const value =
      typeof data.value === "string"
        ? data.value
        : typeof (data.client_secret as Record<string, unknown> | undefined)?.value === "string"
          ? ((data.client_secret as Record<string, unknown>).value as string)
          : undefined;

    if (!value) {
      return NextResponse.json(
        { error: "Realtime session response was incomplete." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      client_secret: { value },
      model: config.session.model,
      voice_context_id: voiceContextId,
      representation_lineage: voiceContext.lineage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
