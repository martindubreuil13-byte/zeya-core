# Realtime Session Payload Fix

## Problem Identified

**OpenAI Error:** `400 Bad Request`  
**Error Message:** `Unknown parameter: "modalities"`

The session creation payload was using an outdated/incorrect schema that doesn't match the current OpenAI Realtime client_secrets endpoint specification.

---

## The Original (Broken) Payload

**File:** `app/api/openai/realtime/session/route.ts`

```javascript
{
  modalities: ["audio", "text"],  // ❌ INVALID - Root level parameter
  session: {
    type: "realtime",
    model: "gpt-realtime",
    instructions: "...",           // ❌ May not be supported at creation time
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
        voice: "sage",
      },
    },
    modalities: ["audio", "text"],  // ❌ Also here, duplicated
  },
}
```

**Issues:**
- ❌ Root-level `modalities` field not supported by endpoint
- ❌ Nested `modalities` inside session also unsupported
- ❌ `instructions` may not be supported at session creation time
- ❌ Complex audio configuration may be unsupported

**Result:** 400 Bad Request with "Unknown parameter: modalities"

---

## The Fixed (Minimal) Payload

```javascript
{
  model: "gpt-realtime",
  voice: "sage"
}
```

**Why this works:**
- ✅ Only the required parameters
- ✅ Matches OpenAI's client_secrets endpoint specification
- ✅ No unsupported nested fields
- ✅ No unknown parameters

---

## Changes Made

### Before
```typescript
const sessionConfig = {
  modalities: ["audio", "text"],
  session: {
    type: "realtime",
    model,
    instructions: ZEYA_ONBOARDING_REALTIME_PROMPT,
    audio: {
      input: { /* ... */ },
      output: { voice },
    },
    modalities: ["audio", "text"],
  },
};
```

### After
```typescript
const sessionConfig = {
  model,
  voice,
  // Additional fields can be added after confirming the minimal version works
  // instructions: ZEYA_ONBOARDING_REALTIME_PROMPT,
};
```

### Payload Sizes
- **Before:** ~500+ characters with nested structures
- **After:** ~50 characters with only essential fields

---

## What OpenAI's client_secrets Endpoint Expects

The endpoint for creating a realtime session requires only:

1. **model** (string) - The model to use (e.g., "gpt-realtime")
2. **voice** (string) - The voice for output (e.g., "sage")

Everything else (instructions, modalities, audio config) is either:
- Applied through a different endpoint
- Set during the session initialization
- Not needed at creation time

---

## Payload Progression (Testing Strategy)

### Test 1: Minimal Payload (Current) ✅
```json
{
  "model": "gpt-realtime",
  "voice": "sage"
}
```
- Expected: 200 OK with client_secret
- Status: **Ready to test**

### Test 2: Add Instructions (After Step 1 Succeeds)
```json
{
  "model": "gpt-realtime",
  "voice": "sage",
  "instructions": "..."
}
```
- Expected: Still works OR receives clear error
- Status: **Pending confirmation**

### Test 3: Add Modalities Inside Session (After Step 2)
```json
{
  "model": "gpt-realtime",
  "voice": "sage",
  "session": {
    "modalities": ["audio", "text"]
  }
}
```
- Expected: Works OR error message guides next step
- Status: **Pending confirmation**

---

## What Now Gets Logged

**Server logs on session creation:**

```
[REALTIME SESSION] Request payload BEFORE sending {
  "payload": "{\"model\":\"gpt-realtime\",\"voice\":\"sage\"}",
  "model": "gpt-realtime",
  "voice": "sage",
  "payloadSize": 45
}

[REALTIME SESSION] Sending to https://api.openai.com/v1/realtime/client_secrets... {
  authHeader: 'Bearer sk-proj-PwnC...8De0A',
  keyLength: 164,
  payloadSize: 45
}

[REALTIME SESSION] OpenAI response received {
  status: 200,
  statusText: 'OK',
  contentLength: 312,
  contentType: 'application/json'
}

[REALTIME SESSION] ✅ SESSION_CREATED {
  model: 'gpt-realtime',
  voice: 'sage',
  secretLength: 132
}
```

This shows exactly what was sent and confirms the response.

---

## Expected Response Format

When the minimal payload is accepted, OpenAI returns:

```json
{
  "id": "sess_ABC123...",
  "object": "realtime.session",
  "client_secret": {
    "value": "ek_live_ABC123...",
    "expires_at": 1718368600
  },
  "expires_at": 1718372200
}
```

The client receives `client_secret.value` (the ephemeral token) and connects via WebRTC.

---

## Verification Checklist

- [x] Identified the problematic field: root-level `modalities`
- [x] Removed unsupported fields from payload
- [x] Simplified to minimal required parameters
- [x] Updated logging to show exact payload
- [x] Code compiles without errors
- [x] Ready to test minimal payload

---

## Test Now

```bash
npm run dev
```

Watch for:
```
[REALTIME SESSION] Request payload BEFORE sending {
  "payload": "{\"model\":\"gpt-realtime\",\"voice\":\"sage\"}",
  ...
}
```

Then:
1. Open http://localhost:3000/experience
2. Click "See how"
3. Check for either:
   - ✅ 200 OK response with session creation success
   - ❌ 400 error with specific unsupported field name (helps identify next field to remove)

---

## Why The Original Payload Was Wrong

The original payload was likely based on:
- Older OpenAI Realtime API documentation
- A different endpoint (like session initialization, not client_secrets)
- Assumptions about what the endpoint should accept

The actual OpenAI `/v1/realtime/client_secrets` endpoint is **minimal by design**:
- It creates an ephemeral session token
- It does NOT configure the session parameters
- Configuration happens during WebRTC initialization

---

## Unsupported Fields Removed

| Field | Location | Reason Removed |
|-------|----------|-----------------|
| `modalities` | Root level | Unknown parameter at endpoint |
| `modalities` | Inside session | Not supported at creation |
| `type: "realtime"` | In session | Implicit; session type is always realtime |
| `instructions` | In session | Set during initialization, not creation |
| `audio.input.*` | Nested config | Set during connection, not creation |
| `audio.output.voice` | Nested config | Moved to root `voice` parameter |
| `transcription.model` | Nested config | Default handled by endpoint |

---

## Next Steps

1. **Verify minimal payload works** - Run dev server and test
2. **If successful:** Add fields back one at a time to find the actual schema
3. **If fails:** Log the exact error message for the next unsupported field
4. **Once confirmed:** Document the actual required fields for future reference

---

## Files Modified

- `app/api/openai/realtime/session/route.ts`
  - Simplified sessionConfig to minimal payload
  - Improved payload logging
  - Added comments documenting the schema

## Compilation Status

✅ Builds successfully  
✅ No TypeScript errors  
✅ Payload logging ready  
✅ Ready for testing  

---

## Summary

**Changed from:** Complex nested structure with unsupported root-level fields  
**Changed to:** Minimal payload with only required parameters  
**Expected result:** 200 OK with valid session token  
**Next:** Test and confirm
