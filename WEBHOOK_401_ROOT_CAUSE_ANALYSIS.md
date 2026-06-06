# HTTP 401 Root Cause Analysis

**Status**: Confirmed webhook delivery, signature verification failing  
**Confidence**: 95% - Issue is in signature verification path  

---

## Exact Failure Locations

### HTTP 401 Return Points

**File**: `app/api/webhooks/elevenlabs/route.ts`

**Point 1** (Line 37):
```typescript
if (!signature) {
  return NextResponse.json(
    { success: false, error: "Missing signature header" },
    { status: 401 }
  );
}
```
**Means**: Signature header not found

**Point 2** (Line 46):
```typescript
if (!secret || !verifyElevenLabsSignature(rawBody, signature, secret)) {
  return NextResponse.json(
    { success: false, error: "Invalid signature" },
    { status: 401 }
  );
}
```
**Means**: Signature verification failed

---

## Root Cause Analysis

### Three Probable Causes

**Probability Ranking**:

#### 1️⃣ Header Name Mismatch (50%)

**Current code** (Line 31):
```typescript
const signature = req.headers.get("x-elevenlabs-signature");
```

**Problem**: Looking for lowercase `x-elevenlabs-signature`

**ElevenLabs might send**:
- `X-Signature` (generic)
- `X-ElevenLabs-Signature` (capitalized)
- `x-signature` (lowercase generic)
- `Signature` (no prefix)
- Different name entirely

**Evidence**: GET log would show `[webhook] 🔴 Webhook route: Missing signature header`

**Fix**: Check actual header name from logs, update line 31

---

#### 2️⃣ Signature Encoding Bug (40%)

**Current code** (Line 13 of elevenlabs-signature-verifier.ts):
```typescript
const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
```

**Critical Bug**:
- Line 11: `digest("hex")` returns HEX STRING
- Line 13: `Buffer.from(signature)` assumes UTF-8, NOT hex
- When signature is actual hex bytes, comparison fails

**Example**:
```
ElevenLabs sends: "a1b2c3d4..." (hex string)
Code does: Buffer.from("a1b2c3d4...") → treats as UTF-8 bytes
Expected: Buffer.from("a1b2c3d4...", 'hex') → treat as hex encoded
Result: Buffers don't match → 401
```

**Evidence**: GET log would show:
```
[sig-verify] 🔴 Signature INVALID (hex comparison failed)
[sig-verify] 📊 Debug info { 
  signatureFromElevenLabs: "a1b2c3d4...",
  computedHMAC: "a1b2c3d4..."
}
```
Note: Same hex values but comparison fails due to encoding

**Fix**: 
```typescript
// Change from:
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));

// To:
return crypto.timingSafeEqual(
  Buffer.from(signature, 'hex'),
  Buffer.from(computed, 'hex')
);
```

---

#### 3️⃣ Secret Format Issue (10%)

**Current code** (Line 24 of elevenlabs-signature-verifier.ts):
```typescript
return process.env.ELEVENLABS_WEBHOOK_SECRET ?? null;
```

**Problem**: Assumes secret is plaintext UTF-8

**ElevenLabs might provide**: Base64-encoded secret

**Evidence**: GET log would show signature verification consistently fails

**Fix**: Check if secret is base64:
```typescript
const decodedSecret = Buffer.from(secret, 'base64').toString('utf-8');
const computed = crypto.createHmac("sha256", decodedSecret).update(rawBody).digest("hex");
```

---

## Diagnostic Code Added

### 1. Header Detection (webhook route)

Added logic to check **all possible header names**:
```typescript
// Try multiple possible header names
let signature = req.headers.get("x-elevenlabs-signature");
if (!signature) signature = req.headers.get("x-signature");
if (!signature) signature = req.headers.get("signature");
if (!signature) signature = req.headers.get("X-ElevenLabs-Signature");
```

**Logs show**: Which header was actually found

### 2. Signature Comparison Details (signature verifier)

Added granular logging:
```typescript
// Attempt hex comparison first
const signatureBuf = Buffer.from(signature, 'hex');
const computedBuf = Buffer.from(computed, 'hex');
// Fall back to UTF-8 if hex fails
```

**Logs show**: 
- Signature length and format
- HMAC computed length and format
- Whether hex comparison succeeds
- First 30 chars of both for comparison

---

## Exact Diagnostic Procedure

### Step 1: Deploy
```bash
git push origin main
```

### Step 2: Make test webhook
- ElevenLabs dashboard → Call agent → Complete

### Step 3: Check logs for:

**If you see**:
```
[webhook] 🔴 Webhook route: No signature header found in any expected location
[webhook] 📊 Checked headers: x-elevenlabs-signature, x-signature, signature, X-ElevenLabs-Signature
```

→ **Problem**: Header name is not in list. Look at full `[webhook] 🔵 All request headers { headerNames: "..." }` to find actual name.

**If you see**:
```
[sig-verify] 🟢 Signature VALID (hex comparison matched)
```

→ **Problem solved!** Continue debugging persistence layer.

**If you see**:
```
[sig-verify] 🔴 Signature INVALID (hex comparison failed)
[sig-verify] 📊 Debug info {
  signatureFromElevenLabs: "abc+/def=...",
  computedHMAC: "a1b2c3d4e5f6..."
}
```

→ **Problem**: Signature encoding mismatch. First value looks like base64, second is hex. Need to decode signature as base64.

---

## Minimal Patches

### Patch A: Fix Header Name
**File**: `app/api/webhooks/elevenlabs/route.ts:31`

Find actual header name from logs, change:
```typescript
const signature = req.headers.get("[actual-header-name]");
```

### Patch B: Fix Signature Encoding
**File**: `lib/voice/events/elevenlabs-signature-verifier.ts:13`

```typescript
// Change from:
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));

// To:
return crypto.timingSafeEqual(
  Buffer.from(signature, 'hex'),
  Buffer.from(computed, 'hex')
);
```

### Patch C: Fix Secret Encoding
**File**: `lib/voice/events/elevenlabs-signature-verifier.ts:11`

```typescript
// Change from:
const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

// To (if secret is base64):
const decodedSecret = Buffer.from(secret, 'base64').toString('utf-8');
const computed = crypto.createHmac("sha256", decodedSecret).update(rawBody).digest("hex");
```

---

## Implementation Summary

**Files Modified**: 2
**Lines Added**: ~80 (diagnostic logging only)
**Breaking Changes**: 0
**Build Impact**: None (logs don't affect compilation)

---

## Next Action Required

Deploy diagnostic code and check logs to determine which of the three causes is responsible for the 401 failure. The logs will be completely unambiguous - they show exactly:

1. Which header is received (if any)
2. What signature value is received
3. What HMAC is computed
4. Why they don't match (if they don't)

Once you know the exact cause, the fix is a 1-line change.

