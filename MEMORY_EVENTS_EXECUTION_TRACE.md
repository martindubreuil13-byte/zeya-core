# Memory Events Persistence - Execution Trace Audit

**Test Status**: Webhook returns HTTP 200, call_outcomes created, NO memory_events created  
**Analysis Date**: 2026-06-06

---

## EXECUTION TRACE

### Step 1: Webhook Entry Point

**File**: `app/api/webhooks/elevenlabs/route.ts`  
**Lines**: 88-93  
**Function**: POST handler  
**Arguments**: ElevenLabs webhook payload  
**Call**: `await processElevenLabsWebhook(payload, rawPayload)`

```typescript
const result = await processElevenLabsWebhook(
  payload,
  payload as unknown as Record<string, unknown>
);
```

**Result**: ProcessedWebhookResult object with success flag  
**Early returns**: None (validates signature, JSON, schema before reaching this)  
**Outcome**: Proceeds to Step 2 with result

---

### Step 2: Event Processor

**File**: `lib/voice/events/elevenlabs-event-processor.ts`  
**Lines**: 48-149  
**Function**: `processElevenLabsWebhook(webhook, rawPayload)`  
**Arguments**: 
- webhook: ElevenLabs webhook payload
- rawPayload: Record<string, unknown>

**Key execution points**:

```typescript
// Line 100-111
const workerBriefId = mappingStore.getWorkerBriefId(conversationId);
const businessId = mappingStore.getBusinessId(conversationId);  // ← LINE 101
const missionId = mappingStore.getMissionId(conversationId);

console.log("[event-processor] 🔵 Retrieved context from mapping", {
  conversationId,
  workerBriefId,
  businessId,      // ← Value from mapping store
  missionId,
});

await processAndStoreOutcome(conversation, workerBriefId, businessId);  // ← LINE 111
```

**Critical point**: 
- Line 101: `businessId = mappingStore.getBusinessId(conversationId)`
- If mapping not registered: **businessId = null**

**Result**: Proceeds to Step 3 with businessId value (null or string)  
**Early returns**: Line 52-58 if webhook type invalid  
**Catch block**: Lines 110-148 catches exceptions from processAndStoreOutcome

---

### Step 3: Outcome Processing

**File**: `lib/voice/outcomes/call-outcome-processor.ts`  
**Lines**: 51-139  
**Function**: `processAndStoreOutcome(conversation, workerBriefId, businessId)`  
**Arguments**:
- conversation: CapturedElevenLabsConversation
- workerBriefId: string | null
- businessId: string | null (from Step 2, Line 101)

**Outcome persistence** (Lines 74-96):
```typescript
// Line 84-96
try {
  await persistOutcome(outcome);  // ← Outcome persisted to call_outcomes ✅
  // Line 85-88
} catch (outcomeError) {
  throw outcomeError;
}
```

**Memory event check** (Lines 98-114):
```typescript
// LINE 107-114: THE CRITICAL GUARD
if (!businessId) {  // ← Check: Is businessId null/falsy?
  console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    reason: "Mapping must be registered before webhook for memory events to be created",
  });
  return outcome;  // ← LINE 113: EARLY RETURN
}
```

**Analysis of Line 107 condition**:
- If businessId is null: condition is TRUE → execute lines 108-112, return at line 113
- If businessId is string: condition is FALSE → continue to line 117

**Result if businessId is null**: Function returns at line 113 WITHOUT calling processCallOutcomeToMemoryEvent  
**Result if businessId is string**: Continues to Step 4

---

### Step 4: Memory Event Processing (CONDITIONAL)

**File**: `lib/memory/events/memory-event-processor.ts`  
**Lines**: 12-35  
**Function**: `processCallOutcomeToMemoryEvent(callOutcome, businessId)`  
**Arguments**:
- callOutcome: CallOutcome
- businessId: string (from Step 3, if not returned early)

**Execution path**:
```typescript
// Line 17: Build memory event from outcome
const buildResult = buildMemoryEvent(callOutcome);

// Line 20: Store in memory
memoryEventStore.saveMemoryEvent(buildResult.memoryEvent);

// Line 23: Persist to Supabase
await persistMemoryEvent(buildResult.memoryEvent, businessId);  // ← Calls Step 5
```

**Call status in successful webhook test**:
- **IF businessId is null at Step 3**: processCallOutcomeToMemoryEvent() is NEVER CALLED
- **IF businessId is string at Step 3**: processCallOutcomeToMemoryEvent() IS CALLED, proceeds to Step 5

---

### Step 5: Memory Event Persistence (CONDITIONAL)

**File**: `lib/voice/persistence/persistence-manager.ts`  
**Lines**: 78-117  
**Function**: `persistMemoryEvent(event, businessId)`  
**Arguments**:
- event: MemoryEvent
- businessId: string | null | undefined (from Step 4)

**Execution path**:
```typescript
// Line 86
const result = await saveMemoryEvent(event, businessId || undefined);

// Line 88-93
if (result.success) {
  console.log("[persistence-manager] 🟢 persistMemoryEvent: Success", {...});
  return;  // ← Success path
}

// Line 96-106
// If result.success is false, throw error (caught in Step 3's catch block)
```

**Call status in successful webhook test**:
- **IF Step 4 was not called**: persistMemoryEvent() is NEVER CALLED
- **IF Step 4 was called**: persistMemoryEvent() IS CALLED, proceeds to Step 6

---

### Step 6: Memory Event Repository (CONDITIONAL)

**File**: `lib/voice/persistence/memory-event-repository.ts`  
**Lines**: 40-108  
**Function**: `saveMemoryEvent(event, businessId)`  
**Arguments**:
- event: MemoryEvent
- businessId: string | undefined (from Step 5)

**Critical INSERT construction** (Line 74-80):
```typescript
const insertPayload = {
  business_id: businessId || null,  // ← LINE 76: If businessId is undefined, becomes null
  event_type: event.memoryType,
  content: JSON.stringify(event.payload || {}),
  metadata: event.payload,
  source: event.source,
  updated_at: new Date().toISOString(),
};
```

**Supabase INSERT** (Lines 89-95):
```typescript
const { error } = await supabase
  .from("memory_events")
  .insert([insertPayload]);  // ← If business_id is null and column is NOT NULL: fails
```

**Error handling** (Lines 97-108):
```typescript
if (error) {
  // Return error object - does NOT throw here
  return { success: false, error: errorObj };  // ← Returns error, caught in Step 5
}
```

**Call status in successful webhook test**:
- **IF Step 5 was not called**: saveMemoryEvent() is NEVER CALLED
- **IF Step 5 was called**: saveMemoryEvent() IS CALLED, returns `{ success: false }` if INSERT fails

---

## ROOT CAUSE ANALYSIS

### The Blocking Line

**File**: `lib/voice/outcomes/call-outcome-processor.ts`  
**Line**: 107  
**Condition**: `if (!businessId)`  
**Code**:
```typescript
if (!businessId) {
  console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    reason: "Mapping must be registered before webhook for memory events to be created",
  });
  return outcome;  // ← LINE 113
}
```

### Root Cause Chain

1. **Test sends webhook WITHOUT registering mapping first**
2. Line 101 of `elevenlabs-event-processor.ts`: `businessId = mappingStore.getBusinessId(conversationId)` → returns **null**
3. Line 111 of `elevenlabs-event-processor.ts`: `await processAndStoreOutcome(conversation, workerBriefId, null)` → passes null businessId
4. **Line 107 of `call-outcome-processor.ts`: `if (!businessId)` evaluates to TRUE**
5. **Line 113 of `call-outcome-processor.ts`: `return outcome` returns early**
6. Lines 116-132 (memory event persistence) are **NEVER EXECUTED**
7. `processCallOutcomeToMemoryEvent()` is **NEVER CALLED**
8. `persistMemoryEvent()` is **NEVER CALLED**
9. `saveMemoryEvent()` is **NEVER CALLED**
10. No INSERT to memory_events occurs

### Result

```
HTTP 200 ✅ (call-outcome-processor returns outcome)
call_outcomes row created ✅ (persisted at line 84 before the guard)
memory_events row NOT created ❌ (skipped at line 107)
```

---

## ANSWERS TO SPECIFIC QUESTIONS

### Question 1: Was processCallOutcomeToMemoryEvent() called during successful webhook test?

**Answer**: ❌ **NO**

**Evidence**: Line 107 guard condition `if (!businessId)` is TRUE because mapping was not registered, so function returns at line 113 before line 117 calls processCallOutcomeToMemoryEvent()

---

### Question 2: Was persistMemoryEvent() called during successful webhook test?

**Answer**: ❌ **NO**

**Evidence**: processCallOutcomeToMemoryEvent() was not called (Question 1), so persistMemoryEvent() is never reached

---

### Question 3: Was saveMemoryEvent() called during successful webhook test?

**Answer**: ❌ **NO**

**Evidence**: persistMemoryEvent() was not called (Question 2), so saveMemoryEvent() is never reached

---

### Question 4: If any function was NOT called, show exact line that prevented execution

**Answer**: **`lib/voice/outcomes/call-outcome-processor.ts:107-113`**

```typescript
// Line 107: Guard condition
if (!businessId) {
  // Lines 108-112: Log warning
  console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    reason: "Mapping must be registered before webhook for memory events to be created",
  });
  
  // Line 113: EARLY RETURN - prevents all subsequent memory event code
  return outcome;
}

// Lines 116-132 would follow, but are unreachable when businessId is null
```

**Exact reason**: businessId is null because mapping was not registered before webhook was sent

---

### Question 5: If saveMemoryEvent() was called, show INSERT payload

**Answer**: **Function was not called** (see Question 3), so no INSERT was attempted.

**However, IF it had been called**, the payload would be:
```typescript
{
  business_id: null,  // ← Would fail: column is NOT NULL
  event_type: "lead_interest_detected" (or similar),
  content: "{\"summary\":\"...\",\"recommendedAction\":\"...\",\"callDuration\":45}",
  metadata: {summary, recommendedAction, callDuration},
  source: "call_outcome",
  updated_at: "2026-06-06T12:34:56.000Z"
}
```

---

### Question 6: If INSERT was attempted, show Supabase response handling

**Answer**: **INSERT was not attempted** because saveMemoryEvent() was never called.

**However, IF it had been called and attempted INSERT**, the Supabase response would be:
```javascript
{
  error: {
    code: "23502",  // NOT NULL constraint violation
    message: "null value in column \"business_id\" violates not-null constraint",
    details: "Failing row contains (null, null, call_outcome, {...}, 2026-06-06...)"
  }
}
```

And handling (line 97-108 of memory-event-repository.ts):
```typescript
if (error) {
  return { 
    success: false, 
    error: { 
      code: "23502", 
      message: "null value in column \"business_id\" violates not-null constraint", 
      details: "..."
    } 
  };
}
```

---

### Question 7: Is businessId null at any point during execution?

**Answer**: ✅ **YES**

**Location**: 
- Line 101 of `elevenlabs-event-processor.ts`: `businessId = mappingStore.getBusinessId(conversationId)`
- Returns null because conversation-brief-mapping store has no entry for conversationId
- Line 111 passes null to processAndStoreOutcome()
- Line 107 of call-outcome-processor.ts evaluates this null and triggers early return

---

### Question 8: Does code intentionally skip memory event creation?

**Answer**: ✅ **YES**

**Intent**: Lines 107-113 of `call-outcome-processor.ts` explicitly skip memory event creation when businessId is unavailable

**Mechanism**: Guard condition returns early with warning log

**Design decision**: Graceful degradation - webhook succeeds with call_outcomes only if businessId missing

---

### Question 9: What exact code path produced the observed behavior?

**Answer**:

```
app/api/webhooks/elevenlabs/route.ts:90-93
  ↓ (calls)
lib/voice/events/elevenlabs-event-processor.ts:111
  ├─ Line 100-101: Gets businessId from mapping store (returns null - mapping not registered)
  └─ Calls processAndStoreOutcome(conversation, workerBriefId, null)
     ↓
     lib/voice/outcomes/call-outcome-processor.ts:84
       ├─ Line 84: ✅ persistOutcome(outcome) - call_outcomes row created
       └─ Line 107: if (!businessId) - evaluates to TRUE
          ↓
          Line 113: return outcome - ⏹️ EARLY RETURN
          ┌─ Lines 116-132 (memory event code) are UNREACHABLE
          └─ processCallOutcomeToMemoryEvent() is NEVER CALLED

Result:
  ✅ HTTP 200 (line 124 of route.ts: statusCode = result.success ? 200 : 400)
  ✅ call_outcomes row created
  ❌ memory_events row NOT created
```

---

## SUMMARY

**Root Cause**: Mapping not registered before webhook sent

**Blocking Line**: `lib/voice/outcomes/call-outcome-processor.ts:107`

**Condition**: `if (!businessId)` is TRUE

**Effect**: Line 113 `return outcome` prevents all memory event creation

**Expected behavior to create memory_events**:
1. Register mapping: POST `/api/webhooks/elevenlabs/test-mapping` with businessId
2. Send webhook: POST `/api/webhooks/elevenlabs` with matching conversationId
3. businessId retrieved from mapping at line 101
4. Guard at line 107 is FALSE (businessId is not null)
5. Lines 116-132 execute, creating memory_events

**Current test behavior** (without mapping registration):
- Guard at line 107 is TRUE
- Early return at line 113
- Memory events SKIPPED
