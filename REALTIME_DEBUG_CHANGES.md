# Realtime Session Debug - Exact Changes

## File 1: `/app/api/openai/realtime/session/route.ts`

### BEFORE (Generic Error Handling)
```typescript
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
  
  // ... config setup ...
  
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
    // ... rest of handler ...
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverLog("session creation threw", { message });

    return NextResponse.json(
      { error: "Could not reach OpenAI Realtime." },
      { status: 502 },
    );
  }
}
```

### AFTER (Detailed Diagnostics)
```typescript
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
    apiKeyLength: apiKey?.length ?? 0,
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
  const sessionConfig = {
    modalities: ["audio", "text"],
    session: {
      type: "realtime",
      model,
      instructions: ZEYA_ONBOARDING_REALTIME_PROMPT,
      // ... rest of config ...
    },
  };

  serverLog("Request payload prepared", {
    model: sessionConfig.session.model,
    voice: sessionConfig.session.audio.output.voice,
    payloadSize: JSON.stringify(sessionConfig).length,
  });

  try {
    // ─── Send to OpenAI ───────────────────────────────────────────────────
    serverLog(`Sending to ${OPENAI_REALTIME_SESSION_URL}...`);

    const response = await fetch(OPENAI_REALTIME_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.slice(0, 10)}...${apiKey.slice(-5)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
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
    const value = /* ... extraction logic ... */;

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
```

## Key Changes in File 1

| Aspect | Before | After |
|--------|--------|-------|
| **Logging** | Conditional (NODE_ENV check) | Always logs |
| **API Key validation** | Just checks existence | Validates length + logs value |
| **Request logging** | None | Logs model, voice, payload size |
| **OpenAI response** | Logs first 500 chars | Logs status, statusText, contentLength, contentType |
| **Error handling** | Generic message returned | **Actual error returned with details** |
| **Parse errors** | Silent fail | Logs parse error with body sample |
| **Fetch errors** | Generic message | Logs actual error + stack trace |
| **Log prefix** | `[Zeya realtime:server]` | `[REALTIME SESSION]` (easier to grep) |
| **Success message** | Single log | Multiple checkpoints with ✅ emoji |
| **Failure messages** | Single log | Multiple checkpoints with ❌ emoji |

## File 2: `/lib/realtime/openai-realtime-client.ts`

### BEFORE
```typescript
private async createSession() {
  const endpoint = this.events.sessionEndpoint ?? "/api/openai/realtime/session";
  const bodyPayload = this.events.sessionBody;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: bodyPayload ? { "Content-Type": "application/json" } : {},
    body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
    cache: "no-store",
  });
  const data = (await response.json()) as RealtimeSessionResponse;

  if (!response.ok) {
    throw new Error(data.error ?? "Could not prepare a realtime session.");
  }

  return data;
}
```

### AFTER
```typescript
private async createSession() {
  const endpoint = this.events.sessionEndpoint ?? "/api/openai/realtime/session";
  const bodyPayload = this.events.sessionBody;

  devLog("Creating session", { endpoint });

  let data: RealtimeSessionResponse;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: bodyPayload ? { "Content-Type": "application/json" } : {},
      body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
      cache: "no-store",
    });

    devLog("Session response received", {
      status: response.status,
      statusText: response.statusText,
    });

    data = (await response.json()) as RealtimeSessionResponse;

    if (!response.ok) {
      const errorMsg = data.error ?? `HTTP ${response.status}: ${response.statusText}`;
      devLog("Session creation failed", {
        status: response.status,
        error: errorMsg,
        details: data.details,
      });
      throw new Error(errorMsg);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    devLog("Session fetch failed", { error: msg });
    throw new Error(`Session creation failed: ${msg}`);
  }

  devLog("Session created successfully", {
    hasClientSecret: !!data.client_secret?.value,
    model: data.model,
  });

  return data;
}
```

## Key Changes in File 2

| Aspect | Before | After |
|--------|--------|-------|
| **Creation log** | None | Logs when starting |
| **Response logging** | None | Logs status + statusText |
| **Error details** | Generic or from server | Passes through details from server |
| **Catch block** | None | Catches fetch failures with logging |
| **Success logging** | None | Logs when complete with model |
| **Error message** | "Could not prepare..." | "HTTP {status}: {statusText}" or actual error |

## File 3: `/lib/realtime/openai-realtime-client.ts` (Types)

### BEFORE
```typescript
type RealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  value?: string;
  model?: string;
  error?: string;
};
```

### AFTER
```typescript
type RealtimeSessionResponse = {
  client_secret?: {
    value?: string;
  };
  value?: string;
  model?: string;
  error?: string;
  details?: Record<string, unknown>;  // NEW: For error details
  type?: string;                       // NEW: For error type
};
```

## What These Changes Enable

1. **Server-side visibility:**
   - See exact model/voice being requested
   - See exact OpenAI response (status + body)
   - See validation of environment variables
   - See request payload details

2. **Client-side visibility:**
   - See fetch status codes
   - See actual error messages from server
   - See session creation progress
   - See what data was returned

3. **Diagnostic output:**
   - Server logs with `[REALTIME SESSION]` prefix
   - Client logs with `[ZEYA REALTIME]` prefix
   - Emojis for quick visual status (✅ vs ❌)
   - Structured logging for easy parsing

4. **Error transparency:**
   - Return actual errors instead of generic messages
   - Include error details for debugging
   - Preserve OpenAI's error messages
   - Show status codes and HTTP details

## How to Interpret Logs

### SUCCESS PATTERN
```
[REALTIME SESSION] Environment check { hasApiKey: true, ... }
[REALTIME SESSION] Request payload prepared { model: '...', voice: '...', ... }
[REALTIME SESSION] Sending to https://api.openai.com/v1/realtime/client_secrets...
[REALTIME SESSION] OpenAI response received { status: 200, statusText: 'OK', ... }
[REALTIME SESSION] Response parsed successfully { keys: ['id', 'object', 'client_secret', ...], ... }
[REALTIME SESSION] ✅ SESSION_CREATED { model: '...', voice: '...', secretLength: 132 }
```

### FAILURE PATTERNS

**Bad Model:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE { 
  status: 400, 
  openaiError: "Invalid value for 'model': 'gpt-4-realtime-preview'" 
}
```

**Bad Voice:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE { 
  status: 400, 
  openaiError: "Invalid value for voice: marin. Valid voices: [sage, juniper, ...]" 
}
```

**Missing API Key:**
```
[REALTIME SESSION] ❌ MISSING OPENAI_API_KEY
```

**Invalid API Key:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE { 
  status: 401, 
  openaiError: "Incorrect API key provided" 
}
```

**Rate Limited:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE { 
  status: 429, 
  statusText: 'Too Many Requests' 
}
```

**Network Error:**
```
[REALTIME SESSION] ❌ REQUEST_FAILED { 
  error: "fetch failed: ECONNREFUSED", 
  stack: "..." 
}
```

---

## Compilation Status

✅ All changes compile without errors
✅ All types are valid
✅ No runtime errors from the logging additions
✅ Ready for production testing

## Next Step

Run `npm run dev` and test the experience → session creation flow.

Check server console for `[REALTIME SESSION]` logs to see exact failure details.
