# Webhook Signature Verification Fix & Testing

**Status**: ✅ FIX IMPLEMENTED  
**Build**: ✅ PASSES  
**Testing**: Ready for verification without real calls  

---

## The Fix

### Root Cause
Signature comparison was treating hex-encoded strings as UTF-8:
```typescript
// WRONG - treats hex string as UTF-8 bytes
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
```

### The Fix
Properly decode both as hex before comparison:
```typescript
// CORRECT - decode hex strings to binary buffers
const signatureBuf = Buffer.from(signature, 'hex');
const computedBuf = Buffer.from(computed, 'hex');
return crypto.timingSafeEqual(signatureBuf, computedBuf);
```

### Files Changed
1. **lib/voice/events/elevenlabs-signature-verifier.ts** 
   - Fixed hex encoding in signature comparison
   - Simplified error handling
   - Kept fallback for non-hex formats

2. **app/api/webhooks/elevenlabs/route.ts**
   - Simplified to look for `x-elevenlabs-signature` header (standard ElevenLabs format)
   - Removed multi-header guessing

3. **app/api/webhooks/elevenlabs/test-signature/route.ts** (NEW)
   - Endpoint that signs test payloads
   - Returns curl command for testing

4. **scripts/test-webhook-signature.sh** (NEW)
   - Local test script (no real calls)
   - Tests valid, missing, and invalid signatures
   - Works with local dev server or production

---

## Testing Without Real Calls

### Option 1: Use the Test Endpoint (Simplest)

**Step 1**: Deploy to Vercel or run locally
```bash
npm run build
vercel deploy  # or: npm run dev (for local)
```

**Step 2**: Get the test signature
```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs/test-signature \
  -H "Content-Type: application/json" \
  -d '{
    "type": "post_call_transcription",
    "event_timestamp": 1717651200,
    "data": {
      "conversation_id": "test_123",
      "agent_id": "test_agent",
      "status": "done",
      "transcript": [{"role": "user", "message": "test"}]
    }
  }'
```

**Response**: Copy the `curlCommand` from response and run it

**Expected**: HTTP 200 response

---

### Option 2: Use the Test Script (Recommended)

**Step 1**: Make script executable
```bash
chmod +x scripts/test-webhook-signature.sh
```

**Step 2**: Test locally
```bash
# Test against local dev server
ELEVENLABS_WEBHOOK_SECRET="your-secret" ./scripts/test-webhook-signature.sh

# Test against production
ELEVENLABS_WEBHOOK_SECRET="your-secret" ./scripts/test-webhook-signature.sh https://yourdomain.vercel.app
```

**Expected Output**:
```
✅ Test 1: HTTP 200 - Signature verified successfully!
✅ Test 2: HTTP 401 - Correctly rejected request without signature
✅ Test 3: HTTP 401 - Correctly rejected request with bad signature
```

---

### Option 3: Manual curl Testing

**Test Case 1: Valid Signature**

1. Create test payload file:
```bash
cat > /tmp/test-payload.json << 'EOF'
{
  "type": "post_call_transcription",
  "event_timestamp": 1717651200,
  "data": {
    "conversation_id": "test_conv",
    "agent_id": "test_agent",
    "status": "done",
    "transcript": [{"role": "user", "message": "test"}]
  }
}
EOF
```

2. Compute signature:
```bash
SECRET="your-elevenlabs-webhook-secret"
PAYLOAD=$(cat /tmp/test-payload.json)
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
echo "Signature: $SIGNATURE"
```

3. Send webhook with valid signature:
```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: $SIGNATURE" \
  -d @/tmp/test-payload.json

# Expected: HTTP 200
# Response: { "success": true, ... }
```

**Test Case 2: Missing Signature**

```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d @/tmp/test-payload.json

# Expected: HTTP 401
# Response: { "success": false, "error": "Missing signature header" }
```

**Test Case 3: Invalid Signature**

```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: 0000000000000000000000000000000000000000000000000000000000000000" \
  -d @/tmp/test-payload.json

# Expected: HTTP 401
# Response: { "success": false, "error": "Invalid signature" }
```

---

## Success Criteria

After deploying the fix, verify:

✅ **Valid signature** → HTTP 200 (webhook processed)  
✅ **Missing signature** → HTTP 401 (rejected)  
✅ **Invalid signature** → HTTP 401 (rejected)  
✅ **Real ElevenLabs webhook** → Should now process (check Supabase for new rows)  

---

## How to Run Tests

### Locally (with dev server)
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests
ELEVENLABS_WEBHOOK_SECRET="your-secret" ./scripts/test-webhook-signature.sh
```

### Against Production
```bash
ELEVENLABS_WEBHOOK_SECRET="your-secret" ./scripts/test-webhook-signature.sh https://yourdomain.vercel.app
```

---

## Troubleshooting

### Test shows HTTP 401 for valid signature

**Possible causes**:
1. Secret doesn't match Vercel env var
2. Secret is base64-encoded (try decoding it)
3. Payload has trailing whitespace (use `echo -n`)

**Debug**:
```bash
# Verify secret length
echo -n "$SECRET" | wc -c

# Check if it looks like base64
echo "$SECRET" | grep -E '^[A-Za-z0-9+/=]+$'
```

### Vercel still returns 401 for real ElevenLabs webhooks

1. Check that `ELEVENLABS_WEBHOOK_SECRET` is set in Vercel env vars
2. Verify secret value matches ElevenLabs integration settings
3. Check Vercel logs: `vercel logs` should show signature verification details
4. Try disabling signature verification temporarily to confirm webhook is arriving

---

## Verification Checklist

Before declaring the fix complete:

- [ ] Build passes without errors
- [ ] Test script runs without errors
- [ ] Valid signature test returns HTTP 200
- [ ] Invalid signature test returns HTTP 401
- [ ] Missing signature test returns HTTP 401
- [ ] Deploy to Vercel
- [ ] Real ElevenLabs webhook now processes (check /api/webhooks/elevenlabs/status for new rows)

---

## Files Modified

| File | Change | Purpose |
|------|--------|---------|
| lib/voice/events/elevenlabs-signature-verifier.ts | Fix hex encoding in comparison | Core fix |
| app/api/webhooks/elevenlabs/route.ts | Simplify header lookup | Use standard header name |
| app/api/webhooks/elevenlabs/test-signature/route.ts | NEW endpoint | Test without real calls |
| scripts/test-webhook-signature.sh | NEW script | Local testing automation |

---

## Architecture Notes

✅ No architecture changes  
✅ No new dependencies  
✅ No changes to webhook processing logic  
✅ Only signature verification algorithm fixed  
✅ All existing logging remains in place  

---

## After Successful Fix

Once tests pass and real webhooks start working:

1. Real ElevenLabs webhooks will return HTTP 200
2. Conversations will be processed (check Supabase call_outcomes table)
3. Remove test endpoint if desired (safe to delete app/api/webhooks/elevenlabs/test-signature/)
4. Keep test script for future debugging

---

## Next Step

Run the test script against your deployment:

```bash
ELEVENLABS_WEBHOOK_SECRET="$ELEVENLABS_WEBHOOK_SECRET" ./scripts/test-webhook-signature.sh
```

If all three tests show ✅, the fix is working correctly.

