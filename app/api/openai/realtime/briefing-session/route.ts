// Realtime session endpoint for briefing room voice sessions.
// Accepts optional business_context in POST body to build a context-aware system prompt.
// Returns an ephemeral client_secret for WebRTC connection.

import { NextRequest, NextResponse } from "next/server";
import { buildBriefingSessionPrompt } from "@/lib/briefing-room/briefing-session-prompt";

const OPENAI_REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/client_secrets";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI Realtime is not configured." }, { status: 500 });
  }

  let businessContext = "";
  try {
    const body = (await req.json()) as { business_context?: string };
    businessContext = body.business_context ?? "";
  } catch {
    // context is optional — continue without it
  }

  const config = {
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
      instructions: buildBriefingSessionPrompt(businessContext),
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
          voice: process.env.OPENAI_REALTIME_VOICE ?? "marin",
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

    return NextResponse.json({ client_secret: { value }, model: config.session.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
