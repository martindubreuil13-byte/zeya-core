# ElevenLabs Wrong Agent Audit

**Issue:** Outbound call used wrong agent (male voice, "Zoe" instead of "Veya", no context)

**Date:** 2026-06-08 (after successful dispatch but before understanding agent issue)

**Status:** Investigation underway — need server logs from the failed call

---

## Critical Facts

The call that used the wrong agent:
- ✅ Connected successfully to the prospect's phone
- ✅ Someone answered and spoke
- ❌ Voice was male (should be Veya)
- ❌ Self-identified as "Zoe" (should be "Veya")
- ❌ Had no Martin context
- ❌ Had no mission context
- ❌ Didn't use any dynamic variables

**This indicates:** A different agent entirely was invoked, not just different settings on Veya.

---

## Possible Root Causes

### Theory 1: Wrong Agent ID in Payload
**Risk Level:** 🔴 CRITICAL

The `agent_id` field might be incorrect or pointing to an old "Zoe" agent instead of current Veya.

**How to verify:**
1. Check server logs for: `[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT`
2. Look at the `agent_id` field in the payload
3. Compare to expected: `agent_9401ks7h7k14ev9a7t9rtsgbwkm3`

### Theory 2: Phone Number Configuration Override
**Risk Level:** 🟠 HIGH

The `phone_number_id` (`phnum_7801ktbvzt2gf45as1krxpqecxtq`) might be assigned to a different agent in ElevenLabs than the `agent_id` we're sending.

**How to verify:**
1. Log into ElevenLabs Dashboard
2. Go to Phone Numbers
3. Find `phnum_7801ktbvzt2gf45as1krxpqecxtq`
4. Check which agent is assigned to it
5. If it's "Zoe", that's the problem

### Theory 3: Branch ID Issues
**Risk Level:** 🟠 MEDIUM

The `branch_id` might not be published, or might be pointing to an old unpublished version.

**How to verify:**
1. Check server logs for: `[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION`
2. Look at `branchIdBeingSent`: should be `agtbrch_7801ks7h7m7de3y8vybdfstt1619`
3. In ElevenLabs, verify this branch is published on Veya agent

### Theory 4: Dynamic Variables Not Sent
**Risk Level:** 🟡 MEDIUM

Even if Veya answered, the context variables might not have been sent, so Veya had no context to use.

**How to verify:**
1. Check server logs for: `[elevenlabs-provider] Dynamic variables being sent`
2. Count should be 24 (or more)
3. If count is 0 or very low, variables not being sent

---

## The Exact Dispatch Flow

### Step 1: dispatchWorkerBrief() called
**File:** [lib/workers/worker-dispatcher.ts:125-132](lib/workers/worker-dispatcher.ts#L125-L132)

### Step 2: ElevenLabsProvider.dispatch() invoked
**File:** [lib/providers/elevenlabs-provider.ts:7](lib/providers/elevenlabs-provider.ts#L7)

### Step 3: Configuration read from environment
**File:** [lib/providers/elevenlabs-provider.ts:29, 40, 51](lib/providers/elevenlabs-provider.ts#L29-L51)

```typescript
const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;        // Line 29
const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;       // Line 40
const agentBranchId = process.env.ELEVENLABS_AGENT_BRANCH_ID;       // Line 51
```

### Step 4: Dynamic variables constructed
**File:** [lib/providers/elevenlabs-provider.ts:64-69](lib/providers/elevenlabs-provider.ts#L64-L69)

```typescript
const dynamicVariables: Record<string, unknown> = {
  ...request.dynamicVariables,
  target: request.targetName || "prospect",
  targetPhone: request.targetPhone,
  objective: request.objective,
};
```

### Step 5: Payload assembled
**File:** [lib/providers/elevenlabs-provider.ts:74-84](lib/providers/elevenlabs-provider.ts#L74-L84)

```typescript
const payload = {
  agent_id: agentId,                    // ← CRITICAL: Which agent?
  agent_phone_number_id: phoneNumberId, // ← CRITICAL: Phone assignment?
  to_number: request.targetPhone,
  conversation_initiation_client_data: {
    user_id: request.workerBriefId,
    branch_id: agentBranchId,          // ← CRITICAL: Which branch?
    dynamic_variables: dynamicVariables, // ← CRITICAL: Variables sent?
    webhook_url: webhookUrl,
  },
};
```

### Step 6: NEW CRITICAL LOGGING (JUST ADDED)
**File:** [lib/providers/elevenlabs-provider.ts:131-152](lib/providers/elevenlabs-provider.ts#L131-L152)

Logs the EXACT payload JSON before sending:

```typescript
// Log the EXACT JSON payload being sent before fetch
const payloadJson = JSON.stringify(payload);
console.log("[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT", {
  endpoint: ELEVENLABS_SIP_TRUNK_ENDPOINT,
  method: "POST",
  headers: { ... },
  payload: payload,
  payloadJson: payloadJson,  // ← EXACT JSON STRING
});

console.log("[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION", {
  agentIdBeingSent: agentId,        // ← What agent ID?
  branchIdBeingSent: agentBranchId, // ← What branch ID?
  phoneNumberIdBeingSent: phoneNumberId, // ← What phone number?
  dynamicVariablesBeingSent: { ... }, // ← How many variables?
});
```

### Step 7: API call made
**File:** [lib/providers/elevenlabs-provider.ts:154-161](lib/providers/elevenlabs-provider.ts#L154-L161)

```typescript
const response = await fetch("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: payloadJson,  // ← EXACT JSON sent
});
```

---

## How to Debug This

### Immediate Action Required:

**1. Get the server logs from the failed call**

Look for these exact log lines:

```
[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT
[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION
```

If these logs don't exist in your logs, the build wasn't running the latest code.

**2. Check the agent_id in the payload**

```
Expected: agent_9401ks7h7k14ev9a7t9rtsgbwkm3
Found: ???
```

If different, that's the problem.

**3. Check the branch_id in the payload**

```
Expected: agtbrch_7801ks7h7m7de3y8vybdfstt1619
Found: ???
```

If different, that's the problem.

**4. Check the dynamic_variables count**

```
Expected: 24 (or more)
Found: ???
```

If 0 or very low, variables weren't constructed.

---

## Runtime Config Endpoint

**New endpoint:** `GET /api/elevenlabs/runtime-config`

This endpoint shows what WOULD be sent on the next call:

```bash
curl -X GET http://localhost:3000/api/elevenlabs/runtime-config | jq .
```

**Response includes:**

```json
{
  "currentRuntimeConfig": {
    "agentId": {
      "value": "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",
      "source": "process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID"
    },
    "branchId": {
      "value": "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
      "source": "process.env.ELEVENLABS_AGENT_BRANCH_ID"
    },
    "phoneNumberId": {
      "value": "phnum_7801ktbvzt2gf45as1krxpqecxtq",
      "source": "process.env.ELEVENLABS_PHONE_NUMBER_ID"
    }
  },
  "simulatedPayload": {
    "agent_id": "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",
    "agent_phone_number_id": "phnum_7801ktbvzt2gf45as1krxpqecxtq",
    "conversation_initiation_client_data": {
      "branch_id": "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
      "dynamic_variables": { 24 variables },
      "webhook_url": "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs"
    }
  },
  "criticalQuestions": {
    "Is agent_id correct?": { "value": "...", "matches": true/false },
    "Is branch_id correct?": { "value": "...", "matches": true/false },
    "Is phone_number_id correct?": { "value": "...", "matches": true/false }
  }
}
```

---

## What the Enhanced Logging Shows

### NEW Log 1: CRITICAL AUDIT

**When:** Immediately before API call to ElevenLabs

```
[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT
{
  endpoint: "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
  method: "POST",
  headers: { "xi-api-key": "SET", "Content-Type": "application/json" },
  payload: {
    agent_id: "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",        // ← WHICH AGENT?
    agent_phone_number_id: "phnum_7801ktbvzt2gf45as1krxpqecxtq",
    to_number: "+13055551234",
    conversation_initiation_client_data: {
      user_id: "brief_1780906490124_q1u57ocrj",
      branch_id: "agtbrch_7801ks7h7m7de3y8vybdfstt1619",   // ← WHICH BRANCH?
      dynamic_variables: { 24 fields },                    // ← VARIABLES SENT?
      webhook_url: "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs"
    }
  },
  payloadJson: "{\"agent_id\":\"agent_9401ks7h7k14ev9a7t9rtsgbwkm3\",...}" // ← EXACT JSON
}
```

### NEW Log 2: CRITICAL VERIFICATION

```
[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION
{
  agentIdBeingSent: "agent_9401ks7h7k14ev9a7t9rtsgbwkm3",
  branchIdBeingSent: "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
  phoneNumberIdBeingSent: "phnum_7801ktbvzt2gf45as1krxpqecxtq",
  dynamicVariablesBeingSent: {
    count: 24,
    keys: ["target", "targetPhone", "objective", "workerName", ...],
    sample: "{\"target\":\"Martin Dubreuil\",\"targetPhone\":\"+13055551234\",...}"
  },
  conversationInitiationClientData: {
    user_id: "brief_...",
    branch_id: "agtbrch_...",
    dynamic_variables: { ... },
    webhook_url: "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs"
  }
}
```

---

## ElevenLabs Phone Number vs Agent ID Relationship

### Important Discovery Needed:

**Does the phone_number_id override agent_id?**

In ElevenLabs SIP trunk outbound calls:

1. **agent_id** — Tells ElevenLabs which agent to use
2. **agent_phone_number_id** — Which phone number to place the call from
3. **branch_id** — Which branch of the agent to use

**Question:** If `agent_phone_number_id` is assigned to a different agent in ElevenLabs, does it override the `agent_id` we send?

**To answer:** Check ElevenLabs Phone Numbers dashboard:

```
Go to: Phone Numbers → phnum_7801ktbvzt2gf45as1krxpqecxtq
Look for: "Assigned to Agent"
Check: Is it assigned to Veya (agent_9401ks7h7k14ev9a7t9rtsgbwkm3)?
Or: Is it assigned to a different agent (e.g., Zoe)?
```

If phone number is assigned to Zoe, that would explain why Zoe answered.

---

## Required Next Step: Server Logs

### To Debug This You Need:

**Server log from the call that used the wrong agent:**

Look for:

```
[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT
[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION
```

**Show me:**

1. The full `agentIdBeingSent`
2. The full `branchIdBeingSent`
3. The full `phoneNumberIdBeingSent`
4. The count of `dynamicVariablesBeingSent`
5. The full `payloadJson`

---

## Hypothesis Testing

### If agent_id was wrong:
- [ ] Logs will show different agent_id (not agent_9401ks7h7k14ev9a7t9rtsgbwkm3)
- [ ] Different agent answered
- [ ] Fix: Update NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local

### If branch_id was wrong:
- [ ] Logs will show different branch_id (not agtbrch_7801ks7h7m7de3y8vybdfstt1619)
- [ ] Old agent version answered
- [ ] Fix: Update ELEVENLABS_AGENT_BRANCH_ID in .env.local

### If phone_number_id assignment was wrong:
- [ ] Logs show correct agent_id but wrong agent answered
- [ ] Phone number assigned to different agent in ElevenLabs
- [ ] Fix: Reassign phone number in ElevenLabs dashboard

### If dynamic_variables not sent:
- [ ] Logs show count = 0 or very low
- [ ] Agent had no context
- [ ] Fix: Check request.dynamicVariables being passed to provider

---

## Files Modified

```
✅ lib/providers/elevenlabs-provider.ts — Added aggressive logging
✅ app/api/elevenlabs/runtime-config/route.ts — New diagnostic endpoint
✅ ELEVENLABS_WRONG_AGENT_AUDIT.md — This document
```

---

## Build Status

```
✓ Compiled successfully in 5.2s
✓ Generating static pages using 7 workers (43/43)
```

---

## Next Investigation Steps

**1. Make a test call RIGHT NOW with enhanced logging:**

```bash
curl -X POST http://localhost:3000/api/operational-intelligence/test-dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "e2db4a3e-7c37-4b61-b123-7e1915eb4a91",
    "missionId": "wrong_agent_debug_test",
    "companyContext": "Zeya",
    "missionContext": "Diagnose wrong agent issue",
    "desiredOutcome": "Identify which agent is being invoked",
    "targets": [{
      "id": "t1",
      "name": "Debug Target",
      "phone": "+13055551234"
    }]
  }' | jq '.dispatchResults[0]'
```

**2. Check server logs IMMEDIATELY for:**

```
[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT
[elevenlabs-provider] 🔴 CRITICAL AGENT & BRANCH VERIFICATION
```

**3. Answer these questions from logs:**

- What is `agentIdBeingSent`?
- What is `branchIdBeingSent`?
- What is `phoneNumberIdBeingSent`?
- What is `dynamicVariablesBeingSent.count`?

**4. Check ElevenLabs Dashboard:**

- Is agent_id the Veya agent?
- Is branch_id published on Veya?
- Is phone_number_id assigned to Veya (not Zoe)?

---

## Proof Required

**This investigation proves:**

✅ Exact agent_id being sent
✅ Exact branch_id being sent
✅ Exact phone_number_id being sent
✅ How many variables being sent
✅ Whether phone_number assignment is correct
✅ Whether branch is published

**NOT assumptions** — Direct evidence from logs and API payload.
