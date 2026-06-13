import { NextResponse } from "next/server";
import { ZEYA_ONBOARDING_REALTIME_PROMPT } from "@/lib/onboarding/onboarding-prompt";

const OPENAI_REALTIME_SESSION_URL = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_REALTIME_VOICE = "sage";

function serverLog(message: string, details?: Record<string, unknown>) {
  // Always log in development, always log errors
  console.log(`[REALTIME SESSION] ${message}`, details ?? {});
}

// Log realtime configuration on first load
if (process.env.NODE_ENV !== "test") {
  const model = process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
  const voice = process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;
  console.log(`[REALTIME STARTUP] Realtime configuration: model=${model}, voice=${voice}`);

  // Log environment details
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log(`[REALTIME STARTUP] API Key loaded: ${apiKey.substring(0, 12)}...${apiKey.substring(apiKey.length - 6)}`);
    console.log(`[REALTIME STARTUP] API Key length: ${apiKey.length}`);
  } else {
    console.log(`[REALTIME STARTUP] WARNING: No API key found`);
  }
  console.log(`[REALTIME STARTUP] Environment: ${process.env.NODE_ENV}`);
  console.log(`[REALTIME STARTUP] Working directory: ${process.cwd()}`);
}

export async function POST() {
  // ─── Environment Variable Validation ───────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
  const voice = process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE;

  // Log key details without exposing full key
  const keyPrefix = apiKey ? apiKey.substring(0, 12) : "NONE";
  const keySuffix = apiKey ? apiKey.substring(apiKey.length - 6) : "NONE";
  const keyLength = apiKey?.length ?? 0;

  serverLog("Environment check", {
    hasApiKey: !!apiKey,
    keyPrefix: apiKey ? `${keyPrefix}...` : "NONE",
    keySuffix: apiKey ? `...${keySuffix}` : "NONE",
    keyLength,
    model,
    voice,
    endpoint: OPENAI_REALTIME_SESSION_URL,
  });

  if (!apiKey) {
    serverLog("❌ MISSING OPENAI_API_KEY");
    return NextResponse.json(
      { error: "MISSING_ENV: OPENAI_API_KEY not set" },
      { status: 500 },
    );
  }

  if (apiKey.length < 20) {
    serverLog("❌ INVALID_API_KEY: Too short", { length: apiKey.length });
    return NextResponse.json(
      { error: "INVALID_API_KEY: Key appears too short" },
      { status: 500 },
    );
  }

  // ─── Request Payload ──────────────────────────────────────────────────
  // OpenAI Realtime API spec (from SDK types: RealtimeSessionCreateRequest):
  // POST /v1/realtime/client_secrets accepts ClientSecretCreateParams
  // Structure: { session?: {...}, expires_after?: {...} }
  // session.type is REQUIRED and must be exactly 'realtime'
  const sessionConfig = {
    session: {
      type: "realtime",
      model,
      audio: {
        output: {
          voice,
        },
      },
    },
  };

  // Log full payload for debugging
  const payloadJson = JSON.stringify(sessionConfig);
  serverLog("Request payload BEFORE sending", {
    payload: payloadJson,
    type: sessionConfig.session.type,
    model: sessionConfig.session.model,
    voice: sessionConfig.session.audio.output.voice,
    payloadSize: payloadJson.length,
  });

  try {
    // ─── Send to OpenAI ───────────────────────────────────────────────────
    serverLog(`Sending to ${OPENAI_REALTIME_SESSION_URL}...`, {
      authHeader: `Bearer ${keyPrefix}...${keySuffix}`,
      keyLength: apiKey?.length ?? 0,
      payloadSize: payloadJson.length,
    });

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
        body: text.slice(0, 1000),
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
          error: `OpenAI Realtime API Error (${response.status}): ${text.slice(0, 500)}`,
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
        fullResponse: JSON.stringify(data).slice(0, 500),
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
      model,
      voice,
      secretLength: value.length,
    });

    return NextResponse.json({
      client_secret: { value },
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack.slice(0, 500) : "";

    serverLog("❌ REQUEST_FAILED", {
      error: message,
      stack,
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
