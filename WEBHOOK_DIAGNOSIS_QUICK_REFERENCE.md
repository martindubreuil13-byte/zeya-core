# Webhook Diagnosis Quick Reference

**Current Status**: call_outcomes table has 0 rows; memory_events has no new rows

---

## 5-Minute Diagnosis

### Step 1: Deploy logging
```bash
git push origin main  # Push the logging changes
# Wait for Vercel deployment (2-3 minutes)
```

### Step 2: Make a test call
- Open ElevenLabs
- Call your agent
- Complete conversation

### Step 3: Check Vercel logs
```
Vercel Dashboard → Your Project → Functions → elevenlabs webhook
OR
vercel logs --follow
```

### Step 4: Look for FIRST RED log (🔴)

Use the table below to find your failure point:

---

## Failure Point Lookup Table

| First Red Log | Location | Cause | Fix |
|---|---|---|---|
| 🔴 "Webhook route: Request received" + silence | webhook route | Webhook never arrives | Check ElevenLabs webhook config URL |
| 🔴 "Signature verification failed" | webhook route | Secret mismatch | Verify ELEVENLABS_WEBHOOK_SECRET in Vercel |
| 🔴 "JSON parsing failed" | webhook route | Malformed JSON | Check ElevenLabs webhook format (unlikely) |
| 🔴 "Payload validation failed" | webhook route | Wrong webhook type | ElevenLabs sending wrong event type |
| 🔴 "Supabase not configured" | outcome-repo | Missing env vars | Add NEXT_PUBLIC_SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY to Vercel |
| 🔴 "Supabase INSERT failed" | outcome-repo | Database error | Check table exists, migration applied |
| 🔴 "Failed to process webhook" | event-processor | Unknown error | Check error message in logs |

---

## Environment Variables Checklist

In Vercel dashboard → Settings → Environment Variables, verify these are set:

```
ELEVENLABS_WEBHOOK_SECRET = [your secret from ElevenLabs]
NEXT_PUBLIC_SUPABASE_URL = https://[project].supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJ... [your service role key]
```

**To verify they're working**:
- After deploy, check logs for:
  - "Supabase client { configured: true, url: true, key: true }"
  - If any are false, that env var is missing

---

## Most Likely Issue

### Probability Ranking

1. **Webhook never arrives** (40%)
   - Evidence: Zero logs from webhook route
   - Fix: Check ElevenLabs webhook URL in integrations

2. **Supabase not configured** (35%)
   - Evidence: "Supabase not configured" log
   - Fix: Add env vars to Vercel

3. **Signature mismatch** (15%)
   - Evidence: "Signature verification failed"
   - Fix: Verify secret matches

4. **Other** (10%)
   - Evidence: Any other red log
   - Fix: Check the specific error message

---

## Log Pattern Analysis

### If you see this sequence:
```
🔵 Request received
🔵 Body received
🟢 Signature verification passed
🟢 JSON parsing succeeded
🟢 Payload validation passed
🔵 Starting webhook processing
[... then silence ...]
```

**Problem**: Webhook is arriving but processing hangs  
**Cause**: Likely Supabase issue or network timeout  
**Fix**: Check Supabase connectivity, look for timeout errors

---

### If you see this sequence:
```
🔵 Request received
[... no further logs ...]
```

**Problem**: Webhook route never executes code  
**Cause**: Request not reaching the endpoint  
**Fix**: Verify ElevenLabs webhook URL is correct (case-sensitive)

---

### If you see this sequence:
```
🟢 Outcome detected: interested
🔵 Persisting outcome to Supabase
🔴 Supabase not configured
```

**Problem**: Supabase client is null  
**Cause**: SUPABASE_SERVICE_ROLE_KEY not set in Vercel  
**Fix**: Add the env var and redeploy

---

## Minimal Fix Checklist

**If Supabase not configured**:
1. Open Vercel dashboard
2. Project Settings → Environment Variables
3. Add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
4. Click "Save"
5. Click "Redeploy"

**If webhook never arrives**:
1. Open ElevenLabs dashboard
2. Integrations → Webhooks
3. Verify webhook URL is exactly: `https://yourdomain.vercel.app/api/webhooks/elevenlabs`
4. Check HTTPS (not HTTP)
5. Resend test webhook

**If signature fails**:
1. Open ElevenLabs → Integrations → Webhooks
2. Copy the webhook secret
3. Go to Vercel → Settings → Environment Variables
4. Paste into `ELEVENLABS_WEBHOOK_SECRET`
5. Redeploy

---

## After Fixing

1. Make another test call
2. Check logs again
3. If all logs show 🟢 GREEN until the end
4. Query Supabase:
   ```sql
   SELECT count(*) FROM call_outcomes;
   -- Should show > 0
   
   SELECT * FROM call_outcomes ORDER BY created_at DESC LIMIT 1;
   -- Should show your conversation's outcome
   ```

---

## Logs Are Production Safe

These logs:
- ✅ Don't expose API keys
- ✅ Don't expose sensitive conversation data
- ✅ Don't slow down the system (one log per major step)
- ✅ Can be removed later easily (search for console.log)
- ✅ Help identify exactly where the pipeline stops

---

## Still Stuck?

Copy the **full log sequence** and provide:
1. First RED log (🔴)
2. 5 lines before and after that red log
3. Any error messages
4. Supabase client configuration values

