import { NextResponse } from "next/server";
import { ZEYA_ONBOARDING_REALTIME_PROMPT } from "@/lib/onboarding/onboarding-prompt";

const OPENAI_REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "sage";

function serverLog(message: string, details?: Record<string, unknown>) {
  // Always log in development, always log errors
  console.log(`[REALTIME SESSION] ${message}`, details ?? {});
}

export async function POST() {
  // ─── Environment Variable Validation ───────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
  const voice = process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;

  serverLog("Environment check", {
    hasApiKey: !!apiKey,
  });

  if (!apiKey) {
    serverLog("Missing required OpenAI configuration");
    return NextResponse.json(
      { error: "Realtime session is not configured" },
      { status: 500 },
    );
  }

  if (apiKey.length < 20) {
    serverLog("Invalid OpenAI configuration");
    return NextResponse.json(
      { error: "Realtime session is not configured correctly" },
      { status: 500 },
    );
  }

  // ─── Request Payload ──────────────────────────────────────────────────
  // OpenAI Realtime API spec (from SDK types: RealtimeSessionCreateRequest):
  // POST /v1/realtime/client_secrets accepts ClientSecretCreateParams
  // Structure: { session?: {...}, expires_after?: {...} }
  // session.type is REQUIRED and must be exactly 'realtime'
  //
  // CRITICAL: For Experience Engine (BeatController), we must:
  // 1. Disable create_response to prevent autonomous model generation
  // 2. Only allow transcript capture and TTS synthesis
  // 3. BeatController makes all dialogue decisions via speakExact()
  const sessionConfig = {
    session: {
      type: "realtime",
      model,
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            // CRITICAL: Disable autonomous response creation
            // The application (BeatController) controls all dialogue
            create_response: false,
            interrupt_response: false,
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
        },
        output: {
          voice,
        },
      },
    },
  };

  // Log full payload for debugging
  const payloadJson = JSON.stringify(sessionConfig);
  const audioInput = (sessionConfig.session.audio as Record<string, unknown>).input as Record<string, unknown>;
  const turnDetection = audioInput?.turn_detection as Record<string, unknown>;

  serverLog("Request payload BEFORE sending", {
    type: sessionConfig.session.type,
    "turn_detection.create_response": turnDetection?.create_response ?? "NOT SET",
    "turn_detection.interrupt_response": turnDetection?.interrupt_response ?? "NOT SET",
  });

  serverLog("⚠️  CRITICAL: Autonomous response generation is DISABLED", {
    "create_response": false,
    "reason": "BeatController controls all dialogue via speakExact()",
    "expected_events": "Only response.created when explicitly requested by application",
  });

  try {
    // ─── Send to OpenAI ───────────────────────────────────────────────────
    serverLog("Sending OpenAI realtime session request");

    const response = await fetch(OPENAI_REALTIME_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: payloadJson,
      cache: "no-store",
    });

    const text = await response.text();

    serverLog("OpenAI response received", {
      status: response.status,
      statusText: response.statusText,
      contentLength: text.length,
      contentType: response.headers.get("content-type"),
    });

    // ─── Handle Non-Success Response ───────────────────────────────────
    if (!response.ok) {
      let errorDetails: Record<string, unknown> = {
        status: response.status,
        statusText: response.statusText,
      };

      try {
        const jsonError = JSON.parse(text);
        errorDetails.parsed = jsonError;
        if (jsonError.error) {
          errorDetails.openaiError = jsonError.error.message || jsonError.error;
        }
      } catch {
        // Not JSON, keep raw text
      }

      serverLog("❌ OPENAI_FAILURE", errorDetails);

      // Return detailed error to client
      return NextResponse.json(
        {
          error: `OpenAI Realtime API Error (${response.status})`,
          details: {
            status: response.status,
            statusText: response.statusText,
          },
        },
        { status: response.status },
      );
    }

    // ─── Parse Success Response ────────────────────────────────────────
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch (e) {
      serverLog("❌ PARSE_ERROR: Could not parse OpenAI response", {
        error: e instanceof Error ? e.message : String(e),
        text: text.slice(0, 500),
      });
      return NextResponse.json(
        { error: `Failed to parse OpenAI response: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    serverLog("Response parsed successfully", {
      keys: Object.keys(data),
      hasClientSecret: !!data.client_secret,
      hasValue: !!data.value,
    });

    // ─── Extract Client Secret ────────────────────────────────────────
    const value =
      typeof data.value === "string"
        ? data.value
        : typeof (data.client_secret as Record<string, unknown> | undefined)?.value === "string"
          ? ((data.client_secret as Record<string, unknown>).value as string)
          : undefined;

    if (!value) {
      serverLog("❌ MISSING_CLIENT_SECRET", {
        dataKeys: Object.keys(data),
      });
      return NextResponse.json(
        {
          error: "Response missing client_secret.value - OpenAI API response format changed?",
          details: { keys: Object.keys(data) },
        },
        { status: 502 },
      );
    }

    serverLog("✅ SESSION_CREATED", {
      hasClientSecret: true,
    });

    return NextResponse.json({
      client_secret: { value },
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    serverLog("❌ REQUEST_FAILED", {
      error: message,
    });

    return NextResponse.json(
      {
        error: `Fetch failed: ${message}`,
        type: "FETCH_ERROR",
      },
      { status: 502 },
    );
  }
}
