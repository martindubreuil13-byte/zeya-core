# Memory Events Strategy: Option A + Option B

**Date**: 2026-06-06  
**Status**: ✅ IMPLEMENTED  
**Decision**: Hybrid approach - require mapping in tests (A), graceful skip in production (B)

---

## Summary

Since webhook integration is proven and call_outcomes are successfully persisted:

**Recommendation**: Combine both approaches
- **Option A** (Test Harness Registers Mapping): Required for tests
- **Option B** (Skip Memory Events When Missing): Safety net for production

---

## The Problem

Memory events require `business_id (UUID NOT NULL)` but this is only available if:
1. **Dispatch registers the mapping** (contains businessId from Mission)
2. **Webhook retrieves businessId from that mapping**

If mapping is missing (shouldn't happen in production, but could in tests), webhook must not fail.

---

## Solution: Hybrid Approach

### **For Tests (Option A - Explicit)**
```bash
# Test script now requires explicit mapping registration
Step 1: POST /api/webhooks/elevenlabs/test-mapping
        └─ Registers: conversationId → businessId

Step 2: POST /api/webhooks/elevenlabs
        └─ Webhook retrieves businessId from mapping
        └─ Memory events created successfully
```

**File**: `scripts/test-webhook-signature.sh` (already implemented)

---

### **For Production (Option B - Graceful Fallback)**

If businessId missing from mapping (degraded scenario):

```
Webhook arrives
  ├─ Call outcome processing: ✅ Succeeds (no businessId needed)
  ├─ Memory event processing: 
  │  └─ Check if businessId available
  │  └─ If NO: ⚠️ Log warning, skip memory event, continue
  │  └─ If YES: ✅ Create memory event
  └─ Webhook returns 200 (success)
```

**Result**:
- ✅ Call outcomes always created
- ⚠️ Memory events skipped gracefully if businessId missing
- ✅ Webhook never fails due to memory event issues
- 📊 Calls still recorded, learning just incomplete

---

## Implementation

### **Code Change: call-outcome-processor.ts**

```typescript
// Skip memory event creation if businessId unavailable
if (!businessId) {
  console.warn("[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping", {
    conversationId: outcome.conversationId,
    workerBriefId: outcome.workerBriefId,
    reason: "Mapping must be registered before webhook for memory events to be created",
  });
  return outcome;  // ✅ Don't fail webhook
}

try {
  await processCallOutcomeToMemoryEvent(outcome, businessId);
  // ...
} catch (memoryError) {
  // Log error but don't fail webhook
  console.warn("[outcome-processor] 🟡 Continuing despite memory event error");
}
```

---

## Behavior Matrix

| Scenario | businessId in Mapping | Call Outcome | Memory Event | Webhook Result |
|----------|----------------------|--------------|--------------|---|
| **Normal** (dispatch registered mapping) | ✅ Yes | ✅ Created | ✅ Created | 200 ✅ |
| **Degraded** (no mapping) | ❌ No | ✅ Created | ⏭️ Skipped | 200 ✅ |
| **Test** (mapping via endpoint) | ✅ Yes (explicit) | ✅ Created | ✅ Created | 200 ✅ |
| **Test** (no mapping, old) | ❌ No | ✅ Created | ⏭️ Skipped | 200 ✅ |

---

## When Each Path Occurs

### **Option A Path** (Mapping exists)
```
Dispatch phase (future implementation):
  └─ Worker brief dispatched
  └─ Register mapping: registerConversationMapping(
       conversationId,
       workerBriefId,
       missionId,
       businessId        ← From Mission
     )

Webhook phase:
  └─ Webhook arrives
  └─ businessId retrieved from mapping ✅
  └─ Memory events created ✅
```

### **Option B Path** (Mapping missing)
```
Test phase (synthetic):
  └─ Webhook sent WITHOUT mapping registration
  └─ businessId = null
  └─ Log warning ⚠️
  └─ Skip memory event creation ✏️
  └─ Call outcome already saved ✅

Production phase (degraded):
  └─ Unexpected scenario (dispatch failed?)
  └─ businessId = null
  └─ Same as above - call recorded, memory skipped
```

---

## Test Expectations

### **With Mapping (Recommended)**
```bash
./scripts/test-webhook-signature.sh

Step 1: Register test mapping
✅ Mapping registered successfully

Step 1: Valid signature with registered mapping
✅ HTTP 200
Logs show:
  [event-processor] 🔵 Retrieved context from mapping
    - businessId: 550e8400-...  ✅
  [memory-event-repo] 🟢 Memory event successfully inserted
```

### **Without Mapping (Degraded)**
```bash
# If mapping endpoint not called or fails
POST /api/webhooks/elevenlabs
  └─ Call outcome: ✅ Created
  └─ Memory event: ⏭️ Skipped (businessId missing)
  └─ Response: HTTP 200 ✅

Logs show:
  [event-processor] 🔵 Retrieved context from mapping
    - businessId: null  ⚠️
  [outcome-processor] 🟡 Skipping memory event: businessId not available
  [outcome-processor] 🟢 Complete outcome processing pipeline finished
```

---

## Why This Approach

### **Strengths**
- ✅ **Tests are explicit**: Must register mapping, matches production setup
- ✅ **Production is resilient**: Missing mapping doesn't break webhook
- ✅ **Data safety**: Call outcomes always recorded
- ✅ **Clear signaling**: Logs show when memory events skipped and why
- ✅ **No breaking changes**: Existing code paths still work

### **Trade-offs**
- ⚠️ **Memory events incomplete**: In degraded scenario, learning data lost
- ⚠️ **Test ceremony**: Test setup requires explicit mapping registration
- ✅ **Acceptable**: Tests are temporary, production should use Option A

---

## Logging Guidance

### **When Memory Events Created** (Option A path)
```
[outcome-processor] 🔵 Processing memory event
  - businessId: "550e8400-e29b-41d4-a716-446655440000"

[memory-event-repo] 🟢 Memory event successfully inserted
  - business_id: "550e8400-e29b-41d4-a716-446655440000"
```

### **When Memory Events Skipped** (Option B path)
```
[outcome-processor] 🟡 Skipping memory event: businessId not available in mapping
  - reason: "Mapping must be registered before webhook for memory events"

[outcome-processor] 🟢 Complete outcome processing pipeline finished
```

---

## Files Changed

| File | Change | Type |
|------|--------|------|
| `lib/voice/outcomes/call-outcome-processor.ts` | Added graceful skip logic | Resilience |

---

## Verification

✅ Build passes  
✅ Call outcomes still created in all scenarios  
✅ Memory events created when businessId available  
✅ Memory events gracefully skipped when businessId unavailable  
✅ Webhook never fails due to memory event issues  
✅ Logs clearly indicate which path taken  

---

## Summary

**Option A** (test harness registers mapping): ✅ Implemented via `/test-mapping` endpoint  
**Option B** (skip memory events gracefully): ✅ Implemented via defensive code

**Result**: 
- Tests require explicit mapping (clear intent)
- Production degrades gracefully (call outcomes preserved)
- Memory events created when possible, skipped when necessary
- Webhook integration remains robust

The hybrid approach balances:
- **Data integrity** (call outcomes always recorded)
- **Learning completeness** (memory events when mapping available)
- **System resilience** (webhook never fails)
- **Test clarity** (explicit setup required)
