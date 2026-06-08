# ElevenLabs Variable Mismatch — Forensic Debug Guide

**Problem:** runtime-config shows 22 variables without missionObjective, but ElevenLabs expects it

**Solution:** Enhanced logging to show EXACT dynamic_variables being sent

---

## What Changed

### 1. Enhanced Logging in elevenlabs-provider.ts

Added THREE new critical logs that show the EXACT dynamic_variables object:

```typescript
// Log 1: Raw dynamic_variables object
console.log("[elevenlabs-provider] 🔴 EXACT DYNAMIC_VARIABLES BEING SENT TO ELEVENLABS", {
  dynamicVariablesCount: Object.keys(dynamicVariables).length,
  dynamicVariablesKeys: Object.keys(dynamicVariables).sort(),
  dynamicVariablesObject: dynamicVariables,  // ← FULL OBJECT
  hasMissionObjective: "missionObjective" in dynamicVariables,
  hasObjective: "objective" in dynamicVariables,
  missionObjectiveValue: dynamicVariables.missionObjective,
  objectiveValue: dynamicVariables.objective,
});

// Log 2: Exact payload JSON before fetch
console.log("[elevenlabs-provider] 🔴 CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT", {
  payload: payload,
  payloadJson: JSON.stringify(payload),  // ← EXACT JSON STRING
});

// Log 3: conversation_initiation_client_data isolation
console.log("[elevenlabs-provider] 🔴 CRITICAL CONVERSATION_INITIATION_CLIENT_DATA", {
  dynamic_variables: payload.conversation_initiation_client_data.dynamic_variables,
  dynamic_variables_count: Object.keys(payload.conversation_initiation_client_data.dynamic_variables).length,
  dynamic_variables_keys: Object.keys(payload.conversation_initiation_client_data.dynamic_variables).sort(),
});
```

### 2. Updated runtime-config Endpoint

Now shows ACTUAL variables from real WorkerBrief construction, not simulated:

```typescript
// Build actual WorkerBrief to see real variables
const testBrief = buildWorkerBrief({ /* test inputs */ });

// Get ACTUAL dynamic variables from brief
const actualDynamicVariables = testBrief.dynamicVariables;

// Response includes both simulated and actual
response = {
  actualDynamicVariablesFromBrief: {
    count: Object.keys(actualDynamicVariables).length,
    keys: Object.keys(actualDynamicVariables).sort(),
    variables: actualDynamicVariables,  // ← Full object
  },
  hasMissionObjective: "missionObjective" in variables,
};
```

---

## How to Debug

### Step 1: Check Runtime Config (Before Test)

```bash
curl -X GET http://localhost:3000/api/elevenlabs/runtime-config | jq '.actualDynamicVariablesFromBrief'
```

**Expected output:**
```json
{
  "count": 25,
  "keys": [
    "companyContext",
    "confidence",
    ...
    "missionObjective",  // ← MUST BE HERE
    ...
    "workerName",
    "workerType"
  ],
  "variables": {
    "missionObjective": "Test objective...",
    "objective": "Test objective...",
    ...
  }
}
```

**If missionObjective is missing:**
- Worker brief construction is broken
- Edit worker-brief-builder.ts to verify it's adding missionObjective

### Step 2: Make a Test Dispatch Call

```bash
curl -X POST http://localhost:3000/api/operational-intelligence/test-dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "e2db4a3e-7c37-4b61-b123-7e1915eb4a91",
    "missionId": "variable_mismatch_debug_test",
    "companyContext": "Zeya",
    "missionContext": "Debug variable mismatch",
    "desiredOutcome": "Verify missionObjective is sent",
    "targets": [{
      "id": "t1",
      "name": "Debug Target",
      "phone": "+13055551234"
    }]
  }' | jq '.dispatchResults[0]'
```

### Step 3: Check Server Logs for EXACT Variables

**Look for this log:**

```
[elevenlabs-provider] 🔴 EXACT DYNAMIC_VARIABLES BEING SENT TO ELEVENLABS
```

**Full output will show:**

```json
{
  "dynamicVariablesCount": 25,
  "dynamicVariablesKeys": [
    "businessSummary",
    "companyContext",
    "confidence",
    ...
    "missionObjective",       // ← CHECK: Is this present?
    ...
    "objective",              // ← CHECK: Is this present?
    ...
    "workerName",
    "workerType"
  ],
  "dynamicVariablesObject": {
    "workerName": "Veya",
    "workerType": "CALLER",
    "objective": "Debug variable mismatch",
    "missionObjective": "Debug variable mismatch",  // ← CHECK: Same value as objective?
    "missionId": "variable_mismatch_debug_test",
    "desiredOutcome": "Verify missionObjective is sent",
    "companyContext": "Zeya",
    "leadContext": "Debug Target",
    ...
    // Plus 17+ operational intelligence variables
  },
  "hasMissionObjective": true,     // ← CRITICAL: Should be TRUE
  "hasObjective": true,            // ← CRITICAL: Should be TRUE
  "missionObjectiveValue": "Debug variable mismatch",  // ← CRITICAL: Should match objective
  "objectiveValue": "Debug variable mismatch",
}
```

### Step 4: Check conversation_initiation_client_data Log

**Look for this log:**

```
[elevenlabs-provider] 🔴 CRITICAL CONVERSATION_INITIATION_CLIENT_DATA
```

**Full output will show:**

```json
{
  "user_id": "brief_1780906490124_q1u57ocrj",
  "branch_id": "agtbrch_7801ks7h7m7de3y8vybdfstt1619",
  "webhook_url": "https://zeya.mindrasolutions.com/api/webhooks/elevenlabs",
  "dynamic_variables": {
    // Full object as sent to ElevenLabs
    "workerName": "Veya",
    "workerType": "CALLER",
    ...
    "missionObjective": "Debug variable mismatch",  // ← IS THIS HERE?
    ...
  },
  "dynamic_variables_count": 25,  // ← How many?
  "dynamic_variables_keys": [
    ...
    "missionObjective",           // ← Is missionObjective in the list?
    ...
  ]
}
```

---

## Interpretation Guide

### If missionObjective IS Present in All Logs

**Then:**
- ✅ Code changes are working
- ✅ missionObjective is being constructed
- ✅ missionObjective is being sent to ElevenLabs
- ✅ Problem is NOT in variable construction

**Next investigation:**
- Check if ElevenLabs agent prompt is looking for `{{missionObjective}}` syntax
- Verify branch_id is the published branch with updated prompt

### If missionObjective IS Missing from dynamic_variables Log

**Then:**
- ❌ Variable is being lost between construction and API call
- ❌ Need to trace where it's being dropped

**Trace path:**
1. Check worker-brief-builder.ts line 62 (missionObjective added?)
2. Check operational-brief-builder.ts (spreading variables?)
3. Check worker-dispatcher.ts line 125 (passing request.dynamicVariables?)
4. Check elevenlabs-provider.ts line 65 (spreading request.dynamicVariables?)

### If missionObjective IS in brief but NOT in payload

**Then:**
- ❌ elevenlabs-provider.ts is not spreading request.dynamicVariables correctly
- ❌ Or something is filtering it out

**Fix location:** [lib/providers/elevenlabs-provider.ts:64-72](lib/providers/elevenlabs-provider.ts#L64-L72)

---

## Exact Log Locations

**File:** [lib/providers/elevenlabs-provider.ts:131-165](lib/providers/elevenlabs-provider.ts#L131-L165)

These logs are printed IMMEDIATELY BEFORE the fetch() call to ElevenLabs.

**When:** During every outbound call dispatch

**Order:**
1. First: `EXACT DYNAMIC_VARIABLES BEING SENT TO ELEVENLABS` (shows raw variables)
2. Second: `CRITICAL AUDIT: EXACT PAYLOAD TO BE SENT` (shows full payload JSON)
3. Third: `CRITICAL CONVERSATION_INITIATION_CLIENT_DATA` (shows conversation data in payload)
4. Fourth: `CRITICAL AGENT & BRANCH VERIFICATION` (shows IDs being used)
5. Then: API call is made to ElevenLabs

---

## Variable Construction Path

```
buildWorkerBrief() in worker-brief-builder.ts
  ↓
  Creates dynamicVariables with:
    - workerName: "Veya"
    - workerType: "CALLER"
    - objective: input.objective
    - missionObjective: input.objective  ← ADDED HERE
    - missionId: input.missionId
    - desiredOutcome: input.desiredOutcome
    - companyContext: input.companyContext
    - leadContext: input.leadContext
    - ...input.dynamicVariables (spreads operational vars)
  ↓
  Returns brief with dynamicVariables
  ↓
dispatchWorkerBrief() passes brief to provider
  ↓
ElevenLabsProvider.dispatch(request: ProviderDispatchRequest)
  ↓
  request.dynamicVariables contains all above
  ↓
  Creates local dynamicVariables:
    ...request.dynamicVariables  ← SPREADS all variables
    target: request.targetName || "prospect"
    targetPhone: request.targetPhone
    objective: request.objective
    missionObjective: request.objective
  ↓
  Puts into payload.conversation_initiation_client_data.dynamic_variables
  ↓
  Logs EXACT variables
  ↓
  fetch() to ElevenLabs API
```

---

## What Should Be True

After all my changes:

✅ **In worker-brief-builder.ts:**
- missionObjective is added to dynamicVariables

✅ **In elevenlabs-provider.ts:**
- request.dynamicVariables is spread
- missionObjective is explicitly added

✅ **In API payload:**
- conversation_initiation_client_data.dynamic_variables contains missionObjective

✅ **In server logs:**
- All three critical logs show missionObjective present

---

## Build Status

```
✓ Compiled successfully in 6.3s
✓ Generating static pages using 7 workers (43/43)
```

---

## Files Modified

```
✅ lib/providers/elevenlabs-provider.ts — Added 3 critical logs showing exact variables
✅ app/api/elevenlabs/runtime-config/route.ts — Now shows actual WorkerBrief variables
```

---

## Next: Show Me the Logs

Make a test dispatch and show me:

1. **Output from `/api/elevenlabs/runtime-config`** (the actualDynamicVariablesFromBrief section)
2. **Server logs for `EXACT DYNAMIC_VARIABLES BEING SENT TO ELEVENLABS`**
3. **Server logs for `CRITICAL CONVERSATION_INITIATION_CLIENT_DATA`**

Then I'll trace exactly where missionObjective is being lost (or confirm it's present but ElevenLabs has a different issue).
