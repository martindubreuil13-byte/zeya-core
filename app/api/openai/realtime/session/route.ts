import { NextResponse } from "next/server";
import { ZEYA_ONBOARDING_REALTIME_PROMPT } from "@/lib/onboarding/onboarding-prompt";

const OPENAI_REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "marin";

function serverLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya realtime:server] ${message}`, details ?? {});
}

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    serverLog("missing OpenAI API key");
    return NextResponse.json(
      { error: "OpenAI Realtime is not configured." },
      { status: 500 },
    );
  }

  const sessionConfig = {
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL,
      instructions: ZEYA_ONBOARDING_REALTIME_PROMPT,
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.35,
            prefix_padding_ms: 500,
            silence_duration_ms: 250,
            create_response: true,
            interrupt_response: true,
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
        },
        output: {
          voice: process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
        },
      },
    },
  };

  try {
    const response = await fetch(OPENAI_REALTIME_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      serverLog("session creation failed", {
        status: response.status,
        body: text.slice(0, 500),
      });

      return NextResponse.json(
        { error: "Could not prepare a Zeya realtime session." },
        { status: response.status },
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
      serverLog("session response missing client secret", { keys: Object.keys(data) });
      return NextResponse.json(
        { error: "Realtime session response was incomplete." },
        { status: 502 },
      );
    }

    serverLog("session created", {
      model: sessionConfig.session.model,
      voice: sessionConfig.session.audio.output.voice,
    });

    return NextResponse.json({
      client_secret: { value },
      model: sessionConfig.session.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverLog("session creation threw", { message });

    return NextResponse.json(
      { error: "Could not reach OpenAI Realtime." },
      { status: 502 },
    );
  }
}
