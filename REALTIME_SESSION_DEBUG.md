# Realtime Session Creation Debug Guide

## Problem Summary

The realtime session creation is failing with a generic error message:
```
"Could not prepare a Zeya realtime session."
```

This hides the actual root cause from OpenAI's API.

## Root Causes to Investigate

The diagnostic logging has been added to capture exact failures. The most likely causes:

### 1. **Invalid or Missing API Key**
- `OPENAI_API_KEY` environment variable not set
- API key format invalid
- API key expired or revoked
- API key doesn't have realtime permissions

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] Environment check {
  hasApiKey: false, // or key too short
  ...
}
```

### 2. **Invalid Model Name**
- Model `gpt-4-realtime-preview` no longer valid
- Model name should be `gpt-realtime` instead
- Model name changed by OpenAI

**Current default:** `gpt-4-realtime-preview`
**Alternative to try:** `gpt-realtime`

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  openaiError: "Invalid model: gpt-4-realtime-preview"
}
```

### 3. **Invalid Voice Name**
- Voice `marin` no longer valid
- Voice name should be `sage`, `juniper`, `ember`, etc.

**Current default:** `marin`
**Valid voices:** `sage`, `juniper`, `ember`, `onyx`, `echo`, `fawn`, `breeze`

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  openaiError: "Invalid voice: marin"
}
```

### 4. **Invalid Request Payload**
- Request body structure doesn't match OpenAI Realtime API spec
- Required fields missing
- OpenAI API spec changed

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  openaiError: "Invalid request: ..."
}
```

### 5. **API Rate Limiting (429)**
- Too many requests to OpenAI API
- Rate limit exceeded for account

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 429,
  ...
}
```

### 6. **Authentication Failure (401)**
- API key invalid
- API key lacks required permissions

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 401,
  openaiError: "Unauthorized"
}
```

### 7. **Resource Not Found (404)**
- Endpoint URL changed
- Model doesn't support realtime API

**Diagnostic:** Check server logs for:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 404,
  ...
}
```

## How to Find the Actual Error

### Step 1: Enable Debug Logging

Start the dev server with logging enabled:
```bash
npm run dev
```

The server will now log all realtime session creation attempts to the console.

### Step 2: Trigger Session Creation

1. Open browser to http://localhost:3000/experience
2. Click "See how" button
3. Watch the browser console (F12) for the voice connection to start
4. The session creation request will be made

### Step 3: Check Server Logs

In the terminal where `npm run dev` is running, look for lines starting with:
```
[REALTIME SESSION]
```

Example output:

**SUCCESS:**
```
[REALTIME SESSION] Environment check {
  hasApiKey: true,
  apiKeyLength: 48,
  model: 'gpt-4-realtime-preview',
  voice: 'marin',
  endpoint: 'https://api.openai.com/v1/realtime/client_secrets'
}
[REALTIME SESSION] Request payload prepared {
  model: 'gpt-4-realtime-preview',
  voice: 'marin',
  payloadSize: 1847
}
[REALTIME SESSION] Sending to https://api.openai.com/v1/realtime/client_secrets...
[REALTIME SESSION] OpenAI response received {
  status: 200,
  statusText: 'OK',
  contentLength: 312,
  contentType: 'application/json'
}
[REALTIME SESSION] Response parsed successfully {
  keys: [ 'id', 'object', 'client_secret', 'expires_at' ],
  hasClientSecret: true,
  hasValue: true
}
[REALTIME SESSION] ✅ SESSION_CREATED {
  model: 'gpt-4-realtime-preview',
  voice: 'marin',
  secretLength: 132
}
```

**FAILURE EXAMPLE 1 - Invalid Model:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  statusText: 'Bad Request',
  body: '{"error":{"message":"Invalid value for 'model': 'gpt-4-realtime-preview'. Valid models: [gpt-realtime-preview, ...]",...}}',
  openaiError: "Invalid value for 'model': 'gpt-4-realtime-preview'..."
}
```

**FAILURE EXAMPLE 2 - Invalid API Key:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 401,
  statusText: 'Unauthorized',
  body: '{"error":{"message":"Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error",...}}',
  openaiError: "Incorrect API key provided..."
}
```

**FAILURE EXAMPLE 3 - Invalid Voice:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  statusText: 'Bad Request',
  body: '{"error":{"message":"Invalid value for voice: marin. Valid voices: [sage, juniper, ember, ...]",...}}',
  openaiError: "Invalid value for voice: marin..."
}
```

### Step 4: Check Browser Console

In the browser (F12 → Console), you'll see client-side logs like:
```
[ZEYA REALTIME] Creating session { endpoint: '/api/openai/realtime/session' }
[ZEYA REALTIME] Session response received { status: 200, statusText: 'OK' }
[ZEYA REALTIME] Session created successfully { ... }
```

Or on error:
```
[ZEYA REALTIME] Session fetch failed { error: 'OpenAI Realtime API Error (400): {"error":{"message":"Invalid value for \'model\': \'gpt-4-realtime-preview\'...",...}}' }
```

## Environment Variables to Check

Add these to your `.env.local`:

```bash
# REQUIRED - Get from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk_live_...

# OPTIONAL - These have defaults if not set
# Current default: gpt-4-realtime-preview (may need to be gpt-realtime)
OPENAI_REALTIME_MODEL=gpt-4-realtime-preview

# Current default: marin (may need to be sage, juniper, ember, etc.)
OPENAI_REALTIME_VOICE=marin

# Optional - Enable detailed logging on client side
NEXT_PUBLIC_REALTIME_DEBUG=true
```

## Files Modified for Debugging

### `/app/api/openai/realtime/session/route.ts`
- ✅ Always logs environment variable validation
- ✅ Logs exact OpenAI request being sent
- ✅ Logs exact OpenAI response (status, body)
- ✅ Logs parsed error details
- ✅ Returns actual error message to client (instead of generic)

### `/lib/realtime/openai-realtime-client.ts`
- ✅ Logs session creation start/end
- ✅ Logs response status details
- ✅ Logs actual error messages
- ✅ Provides detailed error to error handler

## Quick Troubleshooting Checklist

- [ ] Is `OPENAI_API_KEY` set in `.env.local`?
- [ ] Is the API key valid? (Check at https://platform.openai.com/account/api-keys)
- [ ] Does the API key have realtime API access?
- [ ] Start dev server and check console logs during session creation
- [ ] Look for `[REALTIME SESSION]` log entries
- [ ] Note the exact error status code and message
- [ ] Check if model name needs to change (gpt-4-realtime-preview → gpt-realtime)
- [ ] Check if voice name needs to change (marin → sage/juniper/ember)

## Next Steps After Finding Error

Once you see the exact error in the server logs:

1. **If status 400 (Bad Request):**
   - Check `openaiError` message for invalid model or voice
   - Update constants at top of `route.ts`
   - Redeploy

2. **If status 401 (Unauthorized):**
   - Verify `OPENAI_API_KEY` is correct
   - Get fresh key from OpenAI console
   - Update `.env.local`

3. **If status 429 (Rate Limited):**
   - Wait a moment and try again
   - Check if account has exceeded rate limits
   - Consider upgrading OpenAI account

4. **If status 500+ (Server Error):**
   - Likely parsing error in response
   - Check `openaiError` message for details
   - May indicate OpenAI API changed format

## Expected Response Format

When successful, OpenAI returns:
```json
{
  "id": "sess_xxx",
  "object": "realtime.session",
  "client_secret": {
    "value": "ek_live_xxx...",
    "expires_at": 1718368600
  },
  "expires_at": 1718372200
}
```

The logs verify:
- Client secret value is extracted
- Model and voice are valid
- Connection can proceed

## Enable Verbose Client Logging

If you need more detailed browser-side logging, add to `.env.local`:
```bash
NEXT_PUBLIC_REALTIME_DEBUG=true
```

This will log all WebRTC connection details to browser console.

## Need to Report the Bug?

When reporting, include:

1. Server log output from `[REALTIME SESSION]` section
2. Browser console output from `[ZEYA REALTIME]` section
3. OpenAI status code (200, 400, 401, 429, etc.)
4. Exact error message from OpenAI
5. Environment: development, staging, or production
6. Browser type and version
7. OpenAI API key status (valid, expired, limited)

This will allow debugging without guessing.
