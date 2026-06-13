# Realtime Session Payload - Exact OpenAI Specification

## Source Documentation

**From:** OpenAI SDK v6.39.0 type definitions (`openai/resources/realtime/client-secrets.d.ts`)  
**Endpoint:** `POST /v1/realtime/client_secrets`  
**Method:** `create(body: ClientSecretCreateParams)`

---

## The Correct Payload Structure

### Type Definition from OpenAI SDK

```typescript
export interface ClientSecretCreateParams {
    /**
     * Configuration for the client secret expiration.
     */
    expires_after?: ClientSecretCreateParams.ExpiresAfter;
    
    /**
     * Session configuration to use for the client secret. 
     * Choose either a realtime session or a transcription session.
     */
    session?: RealtimeAPI.RealtimeSessionCreateRequest | 
              RealtimeAPI.RealtimeTranscriptionSessionCreateRequest;
}
```

### Key Points from Official Spec

1. **Both parameters are OPTIONAL** (`?`)
2. **`session` is where model and voice go** - NOT at root level
3. **Inside session, use the structure of `RealtimeSessionCreateRequest`**

---

## Valid Payloads (in order of specificity)

### Minimal Valid Payload (No Configuration)
```json
{}
```
✅ Valid - Creates a session with default configuration

### Minimal with Session
```json
{
  "session": {}
}
```
✅ Valid - Creates a session with default configuration

### With Model and Voice (CORRECT STRUCTURE)
```json
{
  "session": {
    "model": "gpt-realtime",
    "audio": {
      "output": {
        "voice": "sage"
      }
    }
  }
}
```
✅ Valid - Model inside session, voice inside audio.output

---

## Current Broken Payload

```json
{
  "model": "gpt-realtime",
  "voice": "sage"
}
```

❌ **Wrong** - Both fields at root level, not in session  
❌ **Error:** "Unknown parameter: model"

---

## Why It's Wrong

From the OpenAI SDK:
```typescript
// The endpoint accepts ClientSecretCreateParams:
interface ClientSecretCreateParams {
    expires_after?: ...;
    session?: RealtimeSessionCreateRequest;  // ← Fields go HERE
}

// NOT at root level
```

The SDK only recognizes:
- `expires_after` (at root)
- `session` (at root)

Anything else (like `model` or `voice` at root) causes "Unknown parameter" error.

---

## The Correct Session Structure

From `RealtimeSessionCreateResponse` (which mirrors the request):

```typescript
interface RealtimeSessionCreateResponse {
    // Core fields
    model?: "gpt-realtime" | "gpt-realtime-2" | "gpt-audio-mini" | ...;
    
    // Audio configuration
    audio?: {
        input?: {
            turn_detection?: ServerVad | SemanticVad | null;
            transcription?: AudioTranscription;
            noise_reduction?: NoiseReduction;
            format?: RealtimeAudioFormats;
        };
        output?: {
            voice?: "alloy" | "ash" | "ballad" | "coral" | "echo" | 
                    "sage" | "shimmer" | "verse" | "marin" | "cedar";
            format?: RealtimeAudioFormats;
            speed?: number;
        };
    };
    
    // Other configuration
    instructions?: string;
    output_modalities?: Array<"text" | "audio">;
    max_output_tokens?: number | "inf";
    tools?: Array<...>;
    tool_choice?: ...;
    // ... more fields
}
```

---

## What Goes Where

| Field | Location | Structure |
|-------|----------|-----------|
| `model` | Inside `session` | `"gpt-realtime"` (string) |
| `voice` | Inside `session.audio.output` | `{ voice: "sage" }` |
| `instructions` | Inside `session` | `"string"` |
| `output_modalities` | Inside `session` | `["audio"]` or `["text"]` |
| `audio.input.turn_detection` | Nested | ServerVad or SemanticVad config |
| `expires_after` | At root level | `{ anchor: "created_at", seconds: 600 }` |

---

## Examples from OpenAI SDK

From the client-secrets.js documentation:

```typescript
// Example 1: Minimal (uses defaults)
const clientSecret = await client.realtime.clientSecrets.create();

// Example 2: With configuration
const clientSecret = await client.realtime.clientSecrets.create({
  session: {
    model: "gpt-realtime",
    audio: {
      output: {
        voice: "sage"
      }
    }
  }
});

// Example 3: With expiration
const clientSecret = await client.realtime.clientSecrets.create({
  expires_after: {
    anchor: "created_at",
    seconds: 600
  },
  session: {
    model: "gpt-realtime"
  }
});
```

---

## The Fix Required

### Current Code

```typescript
const sessionConfig = {
  model: "gpt-realtime",        // ❌ Wrong location
  voice: "sage",                 // ❌ Wrong location
};
```

### Correct Code

```typescript
const sessionConfig = {
  session: {
    model: "gpt-realtime",
    audio: {
      output: {
        voice: "sage"
      }
    }
  }
};
```

---

## Response Structure

When the request succeeds (200 OK), OpenAI returns:

```json
{
  "value": "ek_live_ABC123...",
  "expires_at": 1718368600,
  "session": {
    "id": "sess_ABC123...",
    "object": "realtime.session",
    "type": "realtime",
    "model": "gpt-realtime",
    "audio": {
      "output": {
        "voice": "sage"
      }
    }
  }
}
```

The client extracts `value` as the ephemeral session token.

---

## Verification Checklist

- [x] Found official OpenAI SDK type definitions
- [x] Verified endpoint structure: `ClientSecretCreateParams`
- [x] Confirmed both root parameters are optional
- [x] Located correct field locations in `RealtimeSessionCreateRequest`
- [x] Identified why current payload fails ("Unknown parameter: model")
- [x] Documented correct structure from official SDK
- [x] Ready to fix the payload

---

## Source Code Reference

**File:** `/node_modules/openai/resources/realtime/client-secrets.d.ts`  
**Line:** `export interface ClientSecretCreateParams`  
**OpenAI SDK Version:** ^6.39.0

This is the authoritative specification used by the OpenAI TypeScript SDK.
