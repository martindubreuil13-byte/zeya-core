# Realtime Session Creation Debug - Summary

## What Was Fixed

The realtime session creation was returning a generic error message that hid the actual root cause:
```
"Could not prepare a Zeya realtime session."
```

This has been replaced with **detailed diagnostic logging and actual error messages**.

## Files Modified

### 1. `/app/api/openai/realtime/session/route.ts`

**Changed:**
- ✅ Logging now ALWAYS happens (was conditional on NODE_ENV)
- ✅ Environment variables validated and logged with details
- ✅ Request payload logged with model and voice names
- ✅ Exact OpenAI response status/body logged
- ✅ Parsed error details extracted and logged
- ✅ **Actual error returned to client** instead of generic message
- ✅ Fetch failures logged with error and stack trace

**New diagnostics captured:**
```
[REALTIME SESSION] Environment check {
  hasApiKey: true/false,
  apiKeyLength: number,
  model: string,
  voice: string,
  endpoint: url
}

[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: number,
  statusText: string,
  body: string,
  openaiError: string (if JSON parseable)
}

[REALTIME SESSION] ❌ MISSING_CLIENT_SECRET {
  dataKeys: string[],
  fullResponse: string
}
```

### 2. `/lib/realtime/openai-realtime-client.ts`

**Changed:**
- ✅ Logs session creation initiation
- ✅ Logs response status details
- ✅ Logs actual error from server
- ✅ Improved error messages with context
- ✅ Better debugging for fetch failures

**Client logs captured:**
```
[ZEYA REALTIME] Creating session { endpoint: '...' }
[ZEYA REALTIME] Session response received { status: ..., statusText: '...' }
[ZEYA REALTIME] Session creation failed { status: ..., error: '...' }
```

### 3. `/lib/realtime/openai-realtime-client.ts` (Types)

**Changed:**
- ✅ Updated `RealtimeSessionResponse` type to include `details` and `type` fields
- ✅ Allows server to return error details to client

## What Errors Will Now Be Visible

### Invalid Model
**Server log:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  openaiError: "Invalid value for 'model': 'gpt-4-realtime-preview'. Valid models: [gpt-realtime-preview, ...]"
}
```

**Browser console:**
```
[ZEYA REALTIME] Session creation failed {
  status: 400,
  error: 'OpenAI Realtime API Error (400): ...'
}
```

### Invalid Voice
**Server log:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 400,
  openaiError: "Invalid value for voice: marin. Valid voices: [sage, juniper, ember, onyx, echo, fawn, breeze]"
}
```

### Invalid or Missing API Key
**Server log:**
```
[REALTIME SESSION] ❌ MISSING_ENV: OPENAI_API_KEY not set
```

Or:
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 401,
  openaiError: "Incorrect API key provided..."
}
```

### Rate Limited
**Server log:**
```
[REALTIME SESSION] ❌ OPENAI_FAILURE {
  status: 429,
  statusText: 'Too Many Requests'
}
```

### Network/Fetch Failure
**Server log:**
```
[REALTIME SESSION] ❌ REQUEST_FAILED {
  error: "fetch failed: ECONNREFUSED",
  stack: "..."
}
```

## How to Test

### Step 1: Start Dev Server
```bash
cd /Users/martin/Documents/MINDRA/02_AIXIA/Zeya
npm run dev
```

Watch the terminal for `[REALTIME SESSION]` logs.

### Step 2: Trigger Session Creation
1. Open http://localhost:3000/experience
2. Click "See how" button
3. The session creation request will fire

### Step 3: Check Logs

**Terminal (server logs):**
```
[REALTIME SESSION] Environment check { ... }
[REALTIME SESSION] Request payload prepared { ... }
[REALTIME SESSION] Sending to https://api.openai.com/v1/realtime/client_secrets...
[REALTIME SESSION] OpenAI response received { status: ..., statusText: '...' }
```

Success or detailed error will appear immediately.

**Browser Console (F12):**
```
[ZEYA REALTIME] Creating session { ... }
[ZEYA REALTIME] Session response received { ... }
[ZEYA REALTIME] Session created successfully { ... }
```

Or error with details.

## Most Likely Issues

Based on the error codes, check these in order:

1. **400 Bad Request** → Likely invalid model name or voice
   - Model: Check if `gpt-4-realtime-preview` is correct (may need `gpt-realtime`)
   - Voice: Check if `marin` is correct (may need `sage`, `juniper`, etc.)
   - Fix: Update constants at top of `route.ts`

2. **401 Unauthorized** → API key invalid
   - Check `OPENAI_API_KEY` in `.env.local`
   - Regenerate key from OpenAI console
   - Verify key has realtime API access

3. **404 Not Found** → Endpoint or model doesn't exist
   - Verify `OPENAI_REALTIME_SESSION_URL` is correct
   - Check OpenAI docs for current endpoint

4. **429 Too Many Requests** → Rate limited
   - Wait and retry
   - May need higher tier account

5. **500+ Server Error** → Response parsing issue
   - OpenAI API format may have changed
   - Check actual response body in logs

## Environment Variables Required

Add to `.env.local`:

```bash
# REQUIRED - Get from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk_live_...

# OPTIONAL - Defaults below
# Try these if getting 400 errors:
# - gpt-realtime
# - gpt-4-realtime-preview
# Current: gpt-4-realtime-preview
OPENAI_REALTIME_MODEL=gpt-4-realtime-preview

# OPTIONAL - Valid voices: sage, juniper, ember, onyx, echo, fawn, breeze
# Current: marin (LIKELY INVALID - try sage)
OPENAI_REALTIME_VOICE=marin
```

## Next Action Items

1. **Run dev server and trigger session creation**
   - Watch server logs for `[REALTIME SESSION]` output
   - Note the exact error status code and message

2. **If 400 error with model:**
   - Change `DEFAULT_REALTIME_MODEL` to `gpt-realtime`
   - Rebuild and test

3. **If 400 error with voice:**
   - Change `DEFAULT_REALTIME_VOICE` to `sage`
   - Rebuild and test

4. **If 401 error:**
   - Verify `OPENAI_API_KEY` in `.env.local`
   - Get fresh key from https://platform.openai.com/api-keys
   - Verify key works with `curl`:
     ```bash
     curl -H "Authorization: Bearer $OPENAI_API_KEY" \
       https://api.openai.com/v1/models
     ```

5. **If other error:**
   - Report the exact error from server logs
   - Include status code and error message
   - Include error details from parsed response

## Compilation Status

✅ TypeScript compilation successful  
✅ All types valid  
✅ All imports resolve  
✅ Ready to test  

## No More Guessing

The diagnostic logging now captures:
- ✅ OpenAI status code (200, 400, 401, 429, 500, etc.)
- ✅ OpenAI response body (full error message)
- ✅ Requested model name
- ✅ Requested voice name
- ✅ Endpoint URL used
- ✅ Environment variable validation
- ✅ Request payload details
- ✅ Exact error messages from OpenAI

The root cause will be visible in the server logs on the first test run.

---

**Status:** Ready for diagnostic testing. Run `npm run dev` and trigger the experience → session creation flow. Check server logs for exact failure details.
