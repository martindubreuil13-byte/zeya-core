# Production Blocking Issues Audit

**Date**: 2026-06-06  
**Status**: IDENTIFIED - 2 Critical Blocking Issues  
**Scope**: Webhook integration verification for production phone calls

---

## Issue Summary

| # | Issue | Status | Impact |
|---|-------|--------|--------|
| 1 | test-mapping endpoint not committed | ❌ BLOCKING | 404 on production tests |
| 2 | Dispatch pipeline doesn't register mappings | ❌ BLOCKING | Real calls won't create memory_events |

---

## Question-by-Question Audit

### Q1: Does test-mapping/route.ts exist in repository?

**Answer**: ✅ YES - File exists locally

**Evidence**:
```
/Users/martin/Documents/MINDRA/02_AIXIA/Zeya/app/api/webhooks/elevenlabs/test-mapping/route.ts
```

File size: 3102 bytes  
Modified: 2026-06-06 21:10

---

### Q2: Is it committed to git?

**Answer**: ❌ NO - **UNTRACKED**

**Evidence**:
```
$ git status app/api/webhooks/elevenlabs/test-mapping/route.ts

On branch main
Untracked files:
  (use "git add <file>..." to include in this commit)
    app/api/webhooks/elevenlabs/test-mapping/route.ts
```

**Impact**: ❌ Will NOT be deployed to production

---

### Q3: Is it included in deployed commit?

**Answer**: ❌ NO

**Evidence**:
- File is untracked (Question 2)
- Latest commit: `9e0d643 Phase 11B execution adapter boundary` (does not include test-mapping)
- The file was created locally after the last commit

**Deployed status**: Not available on zeya.mindrasolutions.com

---

### Q4: Does file export valid App Router handlers?

**Answer**: ✅ YES - Both GET and POST exported

**Evidence**:
```typescript
export async function POST(req: NextRequest) {
  // Lines 6-49: Valid POST handler
}

export async function GET(req: NextRequest) {
  // Lines 51-101: Valid GET handler
}
```

**Validation**:
- ✅ Correct function names (POST, GET)
- ✅ Correct parameter type (NextRequest)
- ✅ Returns NextResponse.json()
- ✅ Proper async handling

---

### Q5: Is route path correct for Next.js App Router?

**Answer**: ✅ YES - Path is correct

**Evidence**:

File location: `app/api/webhooks/elevenlabs/test-mapping/route.ts`

Next.js App Router mapping:
```
app/api/webhooks/elevenlabs/test-mapping/route.ts
           ↓
GET  /api/webhooks/elevenlabs/test-mapping
POST /api/webhooks/elevenlabs/test-mapping
```

Nested path structure: ✅ Correct

---

### Q6: Could build configuration, middleware, or folder structure prevent deployment?

**Answer**: ❌ NO - Nothing would prevent deployment IF file were committed

**Evidence**:

Directory structure is valid:
```
app/api/webhooks/elevenlabs/
├── route.ts                    ✅ Main webhook handler
├── test-signature/
│   └── route.ts               ✅ Signature test endpoint
├── test-mapping/
│   └── route.ts               ⏳ Not committed yet
├── conversation/
│   └── [conversationId]/route.ts
└── status/
    └── route.ts
```

No middlewares blocking /test-mapping:
```bash
$ find app/middleware.ts app/api/_middleware.ts app/api/webhooks/_middleware.ts 2>/dev/null
# (returns nothing - no blockers)
```

Build configuration is standard Next.js:
```bash
$ grep "pages\|routes\|exclude" next.config.js
# (standard configuration - no exclusions)
```

**Conclusion**: ✅ File would deploy successfully IF committed

---

### Q7: Why is curl returning 404 on production?

**Answer**: ❌ Endpoint doesn't exist - file not deployed

```
$ curl https://zeya.mindrasolutions.com/api/webhooks/elevenlabs/test-mapping
404 Not Found
```

**Root cause chain**:
1. File is untracked in git (Question 2)
2. Untracked files not included in deployments
3. Endpoint doesn't exist on deployed branch
4. curl receives 404

**To fix**: Commit the file to git

```bash
git add app/api/webhooks/elevenlabs/test-mapping/route.ts
git commit -m "Add test-mapping endpoint for webhook mapping registration"
git push origin main
# Vercel auto-deploys from main
```

---

### Q8: Does dispatch pipeline store mapping data?

**Answer**: ❌ NO - **NOT IMPLEMENTED**

**Evidence**:

**File**: `lib/workers/worker-dispatcher.ts`

```typescript
export async function dispatchWorkerBrief(
  brief: WorkerBrief,
  providerType: ProviderType = "MOCK"
): Promise<WorkerDispatchResult> {
  const provider = getProvider(providerType);
  const providerResult = await provider.dispatch({
    workerBriefId: brief.id,
    missionId: brief.missionId,
    // ... other fields
  });

  return {
    briefId: brief.id,
    workerName: brief.workerName,
    // ...
    // ❌ NO MAPPING REGISTRATION
  };
}
```

**Search results**: No calls to mapping registration in production code

```bash
$ grep -r "mappingStore.createMapping\|registerConversationMapping" lib/ --include="*.ts"
# Results: ONLY in test utilities and test-mapping endpoint
```

**Implementation status**:
- ❌ dispatchWorkerBrief() doesn't call createMapping
- ❌ dispatchWorkerBrief() doesn't get conversationId from provider
- ❌ dispatchWorkerBrief() doesn't pass businessId to provider
- ❌ No integration point identified for mapping registration

---

### Q9: Production Flow Trace - Current vs Required

**CURRENT FLOW** (What actually happens):

```
Dispatch (worker-dispatcher.ts:12)
  ├─ provider.dispatch() [mock-provider.ts:9]
  │  └─ Returns: providerCallId, status, message
  │  └─ ❌ NO conversationId
  │  └─ ❌ NO mapping registration
  │
ElevenLabs Call (not in codebase - external)
  └─ Call made with agent_id + credentials
  └─ ❌ conversationId not registered anywhere
  
Webhook Arrives (elevenlabs-event-processor.ts:53)
  ├─ mappingStore.getBusinessId(conversationId)
  │  └─ ❌ Returns null (mapping never created)
  │
  ├─ processAndStoreOutcome(conversation, workerBriefId, businessId=null)
  │
  ├─ call-outcome-processor.ts:84
  │  └─ ✅ persistOutcome() - call_outcomes row created
  │
  ├─ call-outcome-processor.ts:107
  │  └─ if (!businessId) return outcome;
  │  └─ ⏭️  Memory event creation skipped
  │
  └─ Return HTTP 200 ✅ (call_outcomes only)

RESULT:
  ✅ call_outcomes row created
  ❌ memory_events row NOT created (businessId unavailable)
```

**FILES INVOLVED**:
- `lib/workers/worker-dispatcher.ts:12` — Dispatch entry point
- `lib/providers/mock-provider.ts:9` — Provider dispatch (no mapping)
- `lib/voice/events/elevenlabs-event-processor.ts:53` — Webhook entry
- `lib/voice/outcomes/call-outcome-processor.ts:84,107` — Outcome & memory processing
- `lib/voice/persistence/persistence-manager.ts` — Persistence layer
- `lib/voice/persistence/outcome-repository.ts` — call_outcomes write
- `lib/voice/persistence/memory-event-repository.ts` — memory_events write (skipped)

---

### Q10: Can REAL production phone call create valid mapping before webhook?

**Answer**: ❌ **NOT IMPLEMENTED**

**Status for each stage**:

| Stage | Status | Evidence | Issue |
|-------|--------|----------|-------|
| Dispatch | ❌ NOT IMPLEMENTED | worker-dispatcher.ts has no mapping logic | conversationId not available at dispatch time |
| Mapping Registration | ❌ NOT IMPLEMENTED | No call to createMapping in dispatch flow | Awaiting conversationId from provider |
| ElevenLabs Call | ⏳ UNKNOWN | External service - not in codebase | Provider doesn't return conversationId |
| Webhook Return | ✅ VERIFIED WORKING | Webhook route receives requests | Signature verification fixed |
| businessId Lookup | ❌ RETURNS NULL | mappingStore.getBusinessId() searches empty map | No mapping created in prior stage |
| call_outcome Persistence | ✅ VERIFIED WORKING | call_outcomes rows being written | Working without businessId |
| memory_event Persistence | ⏭️ GRACEFULLY SKIPPED | call-outcome-processor.ts:107 guard | businessId unavailable, so skipped |

**Blocking factors**:

1. **Dispatch time issue**: conversationId only exists AFTER ElevenLabs accepts the call
   - Dispatch happens BEFORE call is made
   - Provider.dispatch() doesn't return conversationId
   - Can't register mapping with unknown conversationId

2. **Provider interface issue**: No way to pass conversationId back from provider
   - ProviderDispatchResult doesn't include conversationId
   - Mock provider returns providerCallId, not conversationId
   - Real provider (Twilio) would also not return ElevenLabs conversationId

3. **Integration gap**: No integration point in dispatch flow
   - dispatchWorkerBrief() doesn't check if mapping exists
   - No hook after ElevenLabs call to register mapping
   - No mechanism to link providerCallId to conversationId to businessId

---

## Current Production Behavior

**Real phone call current flow**:

```
✅ Worker brief dispatched
✅ Provider call initiated (Twilio, etc.)
✅ Agent calls phone number
✅ ElevenLabs creates conversationId
✅ Webhook sent to POST /api/webhooks/elevenlabs
✅ call_outcomes row created
❌ memory_events row NOT created (businessId = null → skipped)
✅ HTTP 200 returned (outcome persistence only)
```

**Result**: One-way data flow - only call_outcomes recorded, no memory_events

---

## Test vs Production Difference

| Scenario | Mapping | businessId | HTTP Status | call_outcomes | memory_events |
|----------|---------|-----------|------------|---------|---------|
| **Test with /test-mapping** | ✅ Explicit registration | ✅ Present | 200 ✅ | ✅ Created | ✅ Created |
| **Real production call** | ❌ Not registered | ❌ null | 200 ✅ | ✅ Created | ⏭️ Skipped |

---

## Files Involved in Production Flow

**Dispatch Pipeline** (Missing: Mapping registration):
```
lib/workers/worker-dispatcher.ts:12
  └─ dispatchWorkerBrief()
     └─ No mapping logic
```

**Provider Interface** (Missing: conversationId return):
```
lib/providers/provider-interface.ts
lib/providers/provider-types.ts:14 (ProviderDispatchResult)
  └─ Returns: providerCallId, status, message
  └─ Missing: conversationId
```

**Webhook Reception** (Working):
```
app/api/webhooks/elevenlabs/route.ts:20
  └─ POST handler receives webhook ✅

lib/voice/events/elevenlabs-event-processor.ts:53
  └─ processElevenLabsWebhook()
  └─ Retrieves businessId from mapping (returns null) ❌
```

**Outcome Processing** (Working):
```
lib/voice/outcomes/call-outcome-processor.ts:84
  └─ persistOutcome() ✅

lib/voice/persistence/outcome-repository.ts:69
  └─ Supabase INSERT to call_outcomes ✅
```

**Memory Event Processing** (Gracefully degraded):
```
lib/voice/outcomes/call-outcome-processor.ts:107
  └─ Guard: if (!businessId) return ⏭️

lib/memory/events/memory-event-processor.ts:12
  └─ Never called when businessId is null
```

---

## Next Blocking Issue to Resolve

### **ISSUE: Dispatch pipeline does not register conversation-brief mappings**

**Current state**: Mapping registration only available through:
- Test endpoint: `/api/webhooks/elevenlabs/test-mapping`
- Test utilities: `conversation-brief-testing.ts`

**What's missing**: Integration in `dispatchWorkerBrief()` to:
1. Either: Wait for conversationId from provider and register mapping after call setup
2. Or: Provider returns conversationId so mapping can be registered before returning

**To enable memory_events in production**, must:
1. Modify `ProviderDispatchResult` to include conversationId
2. Modify providers (mock and Twilio) to return conversationId
3. Integrate mapping registration in `dispatchWorkerBrief()` after provider.dispatch()
4. Pass businessId from mission context to mapping

---

## Summary

### Blocking Issue #1: Test Endpoint Not Committed ⏱️ QUICK FIX
- File exists: ✅
- Handlers correct: ✅
- Path correct: ✅
- Not deployed: ❌ (untracked)
- **Fix**: `git add` and `git commit`

### Blocking Issue #2: Dispatch Doesn't Register Mappings 🔴 MUST IMPLEMENT
- Dispatch flow: worker-dispatcher.ts
- Provider interface: No conversationId return
- Mapping registration: Not called in dispatch
- **Impact**: Memory events cannot be created for real calls
- **Fix**: Integrate mapping registration in dispatch pipeline

---

## For Production Phone Call to Generate Both Rows

**Required**:
1. ✅ Webhook test-mapping endpoint (blocked by Issue #1)
2. ❌ Dispatch pipeline integration (blocked by Issue #2)

**Current**: Only call_outcomes created for real calls  
**Target**: Both call_outcomes and memory_events created

**Status**: **NOT READY FOR PRODUCTION MEMORY EVENTS** - Dispatch integration pending
