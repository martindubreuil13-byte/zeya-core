# Production Call Memory Events Audit

**Scenario**: Real production call successfully created call_outcomes but NO memory_events  
**Timestamp**: 2026-06-06  
**Call Data**: 
- outcome_type: unknown
- summary: "Production test call"
- created_at: 2026-06-06 14:49:05

---

## Questions and Answers (No Speculation)

### 1. Did processCallOutcomeToMemoryEvent() execute?

**Answer**: ❌ **NO**

**Evidence**: 
- Code path at `lib/voice/outcomes/call-outcome-processor.ts:107-113`
- Guard condition: `if (!businessId)` evaluated to TRUE
- Line 113: Early return prevented execution of line 117 which calls processCallOutcomeToMemoryEvent()

---

### 2. Did the businessId guard trigger?

**Answer**: ✅ **YES - Line 107 guard triggered**

**Code**:
```typescript
// Line 107-114 of call-outcome-processor.ts
if (!businessId) {
  console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    reason: "Mapping must be registered before webhook for memory events to be created",
  });
  return outcome;  // ← Early return at line 113
}
```

Guard fired because businessId was null.

---

### 3. What value did businessId contain?

**Answer**: **businessId = null**

**Source**: 
- `lib/voice/events/elevenlabs-event-processor.ts:104`
- Line: `let businessId = mappingStore.getBusinessId(conversationId);`
- Result: null (no mapping found by real conversationId)

---

### 4. Was workerBriefId present in the webhook request?

**Answer**: ❌ **NO - workerBriefId was undefined**

**Evidence**: 
- `app/api/webhooks/elevenlabs/route.ts:89-92`
- Lines check three sources:
  ```typescript
  const workerBriefId =
    req.nextUrl.searchParams.get("workerBriefId") ||      // ← No query param
    req.headers.get("X-Worker-Brief-Id") ||               // ← No header
    undefined;                                             // ← Result: undefined
  ```

Real production call did NOT include workerBriefId parameter.

---

### 5. Was workerBriefId used to resolve businessId?

**Answer**: ❌ **NO - Resolution attempt was not executed**

**Evidence**:
- `lib/voice/events/elevenlabs-event-processor.ts:108-130`
- Line 108 condition: `if (workerBriefId && !businessId)`
- Evaluates to: `if (undefined && true)` = **FALSE**
- Lines 109-129 (workerBriefId resolution logic) SKIPPED

Condition failed because workerBriefId was undefined.

---

### 6. Did mappingStore.getBusinessIdByWorkerBriefId() return null?

**Answer**: ❌ **Function was NEVER CALLED**

**Reason**: 
- Line 108 condition failed (workerBriefId is undefined)
- Line 109 code block not executed
- Function never invoked

Provisional mapping exists (registered at dispatch), but no way to access it without workerBriefId.

---

### 7. Was memory event creation skipped intentionally?

**Answer**: ✅ **YES - Graceful degradation by design**

**Mechanism**: 
- Guard at `call-outcome-processor.ts:107` intentionally skips memory events when businessId unavailable
- This is NOT a bug, it's intentional graceful degradation
- Webhook returns HTTP 200 success anyway
- call_outcomes already persisted, which is the primary goal

**Code Comment** (lines 108-111):
```typescript
console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
  conversationId: outcome.conversationId,
  workerBriefId: outcome.workerBriefId,
  reason: "Mapping must be registered before webhook for memory events to be created",
});
```

---

### 8. Show the exact code path and line numbers

**Complete execution trace for production call WITHOUT workerBriefId parameter:**

```
app/api/webhooks/elevenlabs/route.ts:89-92
├─ Line 89-92: Extract workerBriefId from request
│  └─ Query param: null
│  └─ Header: null
│  └─ Result: workerBriefId = undefined
│
└─ Line 100-104: Call processElevenLabsWebhook(payload, rawPayload, undefined)
   │
   └─ lib/voice/events/elevenlabs-event-processor.ts:53-139
      │
      ├─ Line 103: resolvedWorkerBriefId = mappingStore.getWorkerBriefId(conversationId)
      │  └─ Result: null (no mapping by real conversationId)
      │
      ├─ Line 104: businessId = mappingStore.getBusinessId(conversationId)
      │  └─ Result: null (no mapping by real conversationId)
      │
      ├─ Line 108: if (workerBriefId && !businessId)
      │  └─ Condition: if (undefined && true) = FALSE
      │  └─ Lines 109-129: SKIPPED (resolution logic not executed)
      │  └─ businessId remains: null
      │
      └─ Line 139: processAndStoreOutcome(conversation, null, null)
         │
         └─ lib/voice/outcomes/call-outcome-processor.ts:51-140
            │
            ├─ Line 84: persistOutcome(outcome)
            │  └─ ✅ SUCCESS: call_outcomes row CREATED
            │  └─ Line 85-88: "Outcome persisted to Supabase successfully"
            │
            ├─ Line 99-104: Log memory event processing
            │  └─ Log: "Processing memory event"
            │  └─ businessId: "MISSING"
            │
            ├─ Line 107: if (!businessId)
            │  └─ Condition: if (!null) = TRUE
            │  └─ ⏹️ GUARD TRIGGERED
            │
            ├─ Line 108-112: Log warning
            │  └─ "🟡 Skipping memory event: businessId not available in mapping"
            │  └─ "Mapping must be registered before webhook for memory events"
            │
            └─ Line 113: return outcome
               └─ ⏹️ EARLY RETURN
               └─ Lines 116-132 (memory event code) UNREACHABLE
               └─ processCallOutcomeToMemoryEvent() NEVER CALLED

Result:
  ✅ call_outcomes: CREATED successfully
  ❌ memory_events: SKIPPED (graceful degradation)
```

---

## Root Cause Identified

**Exact Blocking Condition**: 
- **Line**: `lib/voice/events/elevenlabs-event-processor.ts:108`
- **Condition**: `if (workerBriefId && !businessId)`
- **Evaluated as**: `if (undefined && true)` = FALSE
- **Effect**: Provisional mapping lookup code not executed
- **Result**: businessId remains null, triggering guard at line 107 of call-outcome-processor.ts

---

## Why Memory Events Were Not Created

### The Chain

1. **Dispatch Time** ✅
   - Provisional mapping registered with businessId
   - Key: `dispatch_${brief.id}_${timestamp}` → {workerBriefId, businessId, missionId}
   - Example: `dispatch_prod_brief_xxx_timestamp` → {businessId: "550e8400-..."}

2. **Call Time** ✅
   - ElevenLabs makes the call
   - Generates real conversationId

3. **Webhook Time** ❌ **MISSING LINK**
   - Webhook arrives with real conversationId
   - **BUT**: No workerBriefId parameter in request
   - Cannot access provisional mapping
   - businessId lookup by real conversationId = null
   - workerBriefId resolution skipped (undefined)

4. **Processing Time** ❌ **GRACEFUL SKIP**
   - processAndStoreOutcome() called with businessId = null
   - call_outcomes persisted (doesn't need businessId)
   - businessId guard triggered (line 107)
   - memory_events creation skipped
   - HTTP 200 returned (webhook succeeds)

---

## The Missing Link

The implementation registers provisional mappings at dispatch time, but production ElevenLabs webhooks do NOT include the workerBriefId parameter.

### Missing Parameter Options:

**Option 1: Query Parameter (Not Present)**
```
POST /api/webhooks/elevenlabs?workerBriefId={workerBriefId}
↑ Not sent by ElevenLabs
```

**Option 2: Custom Header (Not Present)**
```
X-Worker-Brief-Id: {workerBriefId}
↑ Not sent by ElevenLabs
```

**Option 3: Direct Mapping by conversationId (Not Available)**
```
Provisional key: dispatch_brief_xyz_timestamp
Real conversationId from ElevenLabs: conv_abc123
↑ No way to link them without workerBriefId
```

---

## Summary Table

| Item | Status | Evidence |
|------|--------|----------|
| processCallOutcomeToMemoryEvent() executed? | ❌ NO | Guard at line 107 prevented execution |
| businessId guard triggered? | ✅ YES | Line 107: `if (!businessId)` = TRUE |
| businessId value | null | Line 104 returned null |
| workerBriefId in webhook? | ❌ NO | Lines 89-92 returned undefined |
| workerBriefId resolution attempted? | ❌ NO | Line 108 condition = FALSE |
| getBusinessIdByWorkerBriefId() called? | ❌ NO | Never reached (condition failed) |
| Memory skip intentional? | ✅ YES | Guard by design (graceful degradation) |

---

## Code Path Summary

```
NO workerBriefId in webhook request
         ↓
workerBriefId = undefined
         ↓
Line 108: if (workerBriefId && !businessId) = FALSE
         ↓
businessId resolution SKIPPED
         ↓
businessId remains null
         ↓
Line 107: if (!businessId) = TRUE
         ↓
Line 113: return outcome (EARLY RETURN)
         ↓
❌ memory_events SKIPPED
✅ call_outcomes CREATED (already persisted at line 84)
```

---

## Why This Happened

The production mapping registration implementation assumes that **ElevenLabs webhook requests will include workerBriefId** in either:
- Query parameter: `?workerBriefId=xxx`
- Header: `X-Worker-Brief-Id: xxx`

**In production, this parameter is NOT being sent.**

Without this linkage parameter, the webhook cannot access the provisional mapping registered at dispatch time, so businessId cannot be resolved, triggering the graceful degradation path.

---

## To Fix for Production

**Requirement**: Configure ElevenLabs to include workerBriefId when calling webhook

**Option A: Update ElevenLabs callback URL**
```
Current: https://yourdomain.com/api/webhooks/elevenlabs
Change to: https://yourdomain.com/api/webhooks/elevenlabs?workerBriefId={workerBriefId}
                                                          ↑ Include this in agent config
```

**Option B: Custom Header Configuration**
```
If ElevenLabs supports custom headers, add:
X-Worker-Brief-Id: {workerBriefId}
```

**Option C: Continue with Test Endpoint**
```
Keep using POST /api/webhooks/elevenlabs/test-mapping for explicit registration
(existing flow, works but requires extra step)
```

