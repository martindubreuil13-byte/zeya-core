# HTTP 401 Webhook Authentication Diagnostic

**Status**: 🔴 Webhooks returning 401  
**Confirmed**: ElevenLabs IS sending webhooks (401 proves request arrival)  
**Failure Point**: Signature verification  

---

## 401 Return Points (Confirmed)

**File**: `app/api/webhooks/elevenlabs/route.ts`

| Line | Condition | Cause |
|------|-----------|-------|
| 37 | `if (!signature)` | Signature header not found |
| 46 | `if (!verifyElevenLabsSignature(...) fails` | Signature validation failed |

---

## Diagnostic Hypothesis

The 401 failure indicates **one of these**:

### Hypothesis A: Header name mismatch (Highest Probability)
**Current code looks for**: `x-elevenlabs-signature`  
**ElevenLabs might send**: One of:
- `X-Signature`
- `X-ElevenLabs-Signature` (capitalized)
- `x-signature`
- `Signature`
- Something else entirely

**Fix**: Check all possible header names

### Hypothesis B: Signature encoding mismatch (High Probability)
**Current code assumes**: Signature is hex string  
**Actual issue**:
```typescript
// Line 13 of elevenlabs-signature-verifier.ts
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
```

**Problem**: `Buffer.from(signature)` treats string as UTF-8, not hex  
**If ElevenLabs sends hex**: Must decode as `Buffer.from(signature, 'hex')`

**Fix**: Use proper encoding:
```typescript
return crypto.timingSafeEqual(
  Buffer.from(signature, 'hex'),
  Buffer.from(computed, 'hex')
);
```

### Hypothesis C: Secret encoding mismatch (Medium Probability)
**Current code assumes**: Secret is plaintext UTF-8  
**Actual issue**: ElevenLabs might provide secret as base64  

**Fix**: Check if secret needs decoding from base64

### Hypothesis D: Body encoding issue (Low Probability)
**Current code uses**: Raw body as string (UTF-8)  
**Actual issue**: Might need different encoding  

**Fix**: Verify raw body is exactly what ElevenLabs signed

---

## Diagnostic Logging Added

### Header Detection (app/api/webhooks/elevenlabs/route.ts)

New logging that checks **all possible header names**:
```
[webhook] 🔵 All request headers
[webhook] 🟢 Webhook route: Signature header found { headerName, signatureLength }
```

Checks for:
- `x-elevenlabs-signature`
- `x-signature`
- `signature`
- `X-ElevenLabs-Signature`

### Signature Verification Details (lib/voice/events/elevenlabs-signature-verifier.ts)

New logging showing:
```
[sig-verify] 🔵 Signature verification starting
[sig-verify] 🔵 HMAC computed
[sig-verify] 🔵 Attempted hex comparison
[sig-verify] 🟢 Signature VALID (hex comparison matched)
  OR
[sig-verify] 🔴 Signature INVALID (hex comparison failed)
[sig-verify] 📊 Debug info { signatureFromElevenLabs, computedHMAC }
```

This shows:
- What signature was received
- What HMAC was computed
- Whether they match
- First 30 chars of each for debugging

---

## How to Diagnose

### Step 1: Deploy diagnostic code
```bash
git push origin main
# Wait for Vercel deployment (2-3 minutes)
```

### Step 2: Make a test webhook
- ElevenLabs dashboard
- Call your agent
- Complete conversation

### Step 3: Check Vercel logs
```
Vercel Dashboard → Your Project → Functions → elevenlabs webhook → Logs
```

### Step 4: Look for signature diagnosis logs

**If header not found**:
```
[webhook] 🔵 All request headers { headerNames: "x-forwarded-for, content-type, ..." }
[webhook] 🔴 Webhook route: No signature header found
[webhook] 📊 Checked headers: x-elevenlabs-signature, x-signature, signature, X-ElevenLabs-Signature
```
→ **The actual header name is in the headerNames list**

**If header found but signature fails**:
```
[sig-verify] 🔵 Signature verification starting { signatureLength, signatureFormat: "abc123..." }
[sig-verify] 🔵 HMAC computed { computedLength, computedFormat: "def456..." }
[sig-verify] 🟡 Hex comparison failed
[sig-verify] 🔴 Signature INVALID (UTF-8 comparison failed)
[sig-verify] 📊 Debug info {
  signatureFromElevenLabs: "abc123xyz...",
  computedHMAC: "def456abc..."
}
```
→ **Signatures don't match; compare the two values**

---

## Most Likely Fixes

### Fix 1: Header name is different

**Evidence**: Logs show different header name in list

**Solution**: Find correct header name from logs and update line 31 of webhook route.ts:
```typescript
// Change from:
const signature = req.headers.get("x-elevenlabs-signature");

// To:
const signature = req.headers.get("[actual-header-name-from-logs]");
```

### Fix 2: Signature is base64, not hex

**Evidence**:
- Signature from logs contains base64 chars (A-Z, a-z, 0-9, +, /)
- Computed HMAC is hex (0-9, a-f)
- They don't match

**Solution**: Decode signature from base64:
```typescript
// In elevenlabs-signature-verifier.ts, change:
const signatureBuf = Buffer.from(signature, 'hex');

// To:
const signatureBuf = Buffer.from(signature, 'base64');
```

### Fix 3: Secret needs base64 decoding

**Evidence**:
- Secret in Vercel contains base64 chars
- Signature verification fails

**Solution**: Decode secret from base64:
```typescript
const decodedSecret = Buffer.from(secret, 'base64').toString('utf-8');
const computed = crypto.createHmac("sha256", decodedSecret).update(rawBody).digest("hex");
```

### Fix 4: Signature format is different

**Evidence**: Logs show signature doesn't match any expected format

**Solution**: Check ElevenLabs webhook documentation for exact signature format

---

## Files Modified for Diagnosis

1. **app/api/webhooks/elevenlabs/route.ts**
   - Added: Header inspection for all possible names
   - Added: Logs showing which header was found
   - Change: Line 31-58 (checks multiple header names)

2. **lib/voice/events/elevenlabs-signature-verifier.ts**
   - Added: Comprehensive signature verification logging
   - Added: Attempt hex comparison first, fall back to UTF-8
   - Change: Line 5-17 (signature comparison logic)

---

## Expected Diagnosis Outputs

### Scenario A: Header name mismatch
```
[webhook] 🔵 All request headers { headerNames: "..., x-signature, ..." }
[webhook] 🟢 Webhook route: Signature header found { headerName: "x-signature" }
[sig-verify] 🔵 Signature verification starting
[sig-verify] 🟢 Signature VALID
```
→ **Fix**: Update header name lookup

### Scenario B: Signature encoding mismatch
```
[webhook] 🟢 Webhook route: Signature header found { headerName: "x-elevenlabs-signature" }
[sig-verify] 🔵 Signature verification starting { signatureFormat: "abc+/xyz=..." }
[sig-verify] 🟡 Hex comparison failed
[sig-verify] 🔴 Signature INVALID
[sig-verify] 📊 Debug info { signatureFromElevenLabs: "abc+/xyz=...", computedHMAC: "abcdef..." }
```
→ **Fix**: Signature is base64, not hex. Decode as base64.

### Scenario C: Success
```
[webhook] 🟢 Webhook route: Signature header found { headerName: "x-elevenlabs-signature" }
[sig-verify] 🔵 Signature verification starting
[sig-verify] 🟢 Signature VALID (hex comparison matched)
[webhook] 🟢 Webhook route: Signature verification passed
🟢 [outcome-builder] Outcome detected: interested
🟢 [outcome-repo] Outcome successfully inserted
```
→ **All working!** Check Supabase for new rows.

---

## Code Change Summary

### Minimal patches required:

**Patch 1**: If header name is wrong
```typescript
// Line 31-58 of app/api/webhooks/elevenlabs/route.ts
const signature = req.headers.get("[correct-header-name]");
```

**Patch 2**: If signature is base64
```typescript
// Line 13 of lib/voice/events/elevenlabs-signature-verifier.ts
const signatureBuf = Buffer.from(signature, 'base64');
const computedBuf = Buffer.from(computed, 'hex');
```

**Patch 3**: If secret is base64
```typescript
// Line 11 of lib/voice/events/elevenlabs-signature-verifier.ts
const decodedSecret = Buffer.from(secret, 'base64').toString('utf-8');
const computed = crypto.createHmac("sha256", decodedSecret).update(rawBody).digest("hex");
```

---

## Next Steps

1. **Deploy this diagnostic code**
   ```bash
   git push origin main
   ```

2. **Make a test webhook call**
   - Call your agent in ElevenLabs
   - Complete conversation

3. **Check Vercel logs**
   - Look for header inspection logs
   - Look for signature verification results

4. **Apply appropriate fix** based on what logs show

5. **Test again** and verify rows appear in Supabase

---

## Timeline

- Deploy diagnostic: 2-3 minutes
- Make test call: 30 seconds
- Check logs: 1 minute
- Apply fix: 2 minutes
- Redeploy: 2-3 minutes
- Verify: 30 seconds

**Total**: ~15 minutes to fix

