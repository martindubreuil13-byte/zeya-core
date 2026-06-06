# Production Mapping Registration - Implementation Plan

**Status**: Minimal implementation identified  
**Approach**: Agent ID linking (zero new persistence)  

---

## Problem Statement

Real production calls need mapping registration, but conversationId is not available until webhook arrives.

**Data availability timeline**:
```
Dispatch time:     workerBriefId ✅, missionId ✅, businessId ✅, conversationId ❌
Webhook time:      conversationId ✅, agent_id ✅, workerBriefId ❌
```

---

## Minimal Solution: Agent ID Linking

Use agent assignment context to bridge dispatch and webhook.

### Changes Required

#### 1. ProviderDispatchResult (Extend return type)

**File**: `lib/providers/provider-types.ts`

Add workerBriefId to result so dispatch code can access it:

```typescript
export interface ProviderDispatchResult {
  providerType: ProviderType;
  providerCallId: string;
  workerBriefId: string;        // ✅ NEW - Echo back for dispatch-time registration
  status: ProviderDispatchStatus;
  message: string;
  createdAt: string;
}
```

**Impact**: Both Mock and Twilio providers return this value

---

#### 2. MockProvider (Return workerBriefId)

**File**: `lib/providers/mock-provider.ts`

```typescript
export class MockProvider implements WorkerProvider {
  async dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    return {
      providerType: "MOCK",
      providerCallId: generateMockCallId(),
      workerBriefId: request.workerBriefId,  // ✅ Echo it back
      status: "SIMULATED",
      message: `Mock dispatch accepted for brief ${request.workerBriefId}. Objective: ${request.objective}.`,
      createdAt: new Date().toISOString(),
    };
  }
}
```

---

#### 3. dispatchWorkerBrief (Register mapping at dispatch time)

**File**: `lib/workers/worker-dispatcher.ts`

Register mapping immediately after provider dispatches:

```typescript
import { mappingStore } from "@/lib/voice/events/conversation-brief-mapping";

export async function dispatchWorkerBrief(
  brief: WorkerBrief,
  providerType: ProviderType = "MOCK"
): Promise<WorkerDispatchResult> {
  const provider = getProvider(providerType);
  
  const providerResult = await provider.dispatch({
    workerBriefId: brief.id,
    missionId: brief.missionId,
    targetName: valueAsString(brief.dynamicVariables.target) ?? brief.leadContext ?? null,
    targetPhone: valueAsString(brief.dynamicVariables.targetPhone ?? brief.dynamicVariables.phone) ?? null,
    objective: brief.objective,
    dynamicVariables: brief.dynamicVariables,
  });

  // ✅ NEW: Register provisional mapping
  // Use workerBriefId as temporary conversationId key
  // This allows webhook to look up context by workerBriefId
  const provisionalConversationId = `dispatch_${brief.id}_${Date.now()}`;
  
  mappingStore.createMapping(
    provisionalConversationId,  // Temporary key until real conversationId arrives
    brief.id,                   // workerBriefId
    brief.missionId,            // missionId
    "unknown"                   // businessId - will fetch from mission lookup
  );
  
  console.log("[worker-dispatcher] 🔵 Registered provisional mapping", {
    workerBriefId: brief.id,
    missionId: brief.missionId,
    provisionalConversationId,
  });

  return {
    briefId: brief.id,
    workerName: brief.workerName,
    workerType: brief.workerType,
    status: providerResult.status,
    message: providerResult.message,
    providerType: providerResult.providerType,
    providerCallId: providerResult.providerCallId,
    createdAt: providerResult.createdAt,
  };
}
```

---

#### 4. Add WorkerBrief Lookup Method

**File**: `lib/voice/events/conversation-brief-mapping.ts`

Add method to look up by workerBriefId:

```typescript
getBusinessIdByWorkerBriefId(workerBriefId: string): string | null {
  // Search for mapping with matching workerBriefId
  for (const mapping of this.conversationToMapping.values()) {
    if (mapping.workerBriefId === workerBriefId) {
      return mapping.businessId;
    }
  }
  return null;
}

getConversationIdByWorkerBriefId(workerBriefId: string): string | null {
  return this.briefToConversation.get(workerBriefId) ?? null;
}
```

---

#### 5. Webhook Handler Update (Use provisional mapping)

**File**: `lib/voice/events/elevenlabs-event-processor.ts`

When webhook arrives, check if workerBriefId is available in context:

```typescript
export async function processElevenLabsWebhook(
  webhook: unknown,
  rawPayload?: Record<string, unknown>,
  workerBriefId?: string  // ✅ NEW OPTIONAL PARAM - from agent context
): Promise<ProcessedWebhookResult> {
  if (!isPostCallTranscriptionWebhook(webhook)) {
    return { /* ... */ };
  }

  const webhook_typed = webhook as ElevenLabsPostCallTranscriptionWebhook;
  const conversationId = webhook_typed.data.conversation_id;
  const eventTimestamp = webhook_typed.event_timestamp;

  if (isDuplicate(eventTimestamp, conversationId)) {
    return { /* ... */ };
  }

  try {
    // ...existing code...

    // ✅ NEW: Try to use provisional mapping if workerBriefId provided
    let businessId: string | null = null;
    
    if (workerBriefId) {
      businessId = mappingStore.getBusinessIdByWorkerBriefId(workerBriefId);
      
      // Update mapping with real conversationId
      if (businessId) {
        const missionId = mappingStore.getMissionId(
          mappingStore.getConversationIdByWorkerBriefId(workerBriefId) || ""
        );
        
        // Re-register with real conversationId
        mappingStore.createMapping(conversationId, workerBriefId, missionId || "", businessId);
        
        console.log("[event-processor] 🟢 Updated mapping with real conversationId", {
          conversationId,
          workerBriefId,
        });
      }
    }
    
    // Fallback: Try direct lookup
    if (!businessId) {
      businessId = mappingStore.getBusinessId(conversationId);
    }

    await processAndStoreOutcome(conversation, workerBriefId || null, businessId);

    return { /* ... */ };
  } catch (error) {
    // ...existing error handling...
  }
}
```

---

## Data Flow

### Before Implementation
```
Dispatch
  ├─ WorkerBrief: brief.id, brief.missionId ✅
  └─ Provider.dispatch()
     └─ No mapping registration ❌

ElevenLabs Call
  └─ conversationId generated ✅

Webhook Arrives
  ├─ conversationId ✅, agent_id ✅
  ├─ mappingStore.getBusinessId(conversationId) = null ❌
  └─ Memory events SKIPPED ⏭️
```

### After Implementation
```
Dispatch
  ├─ WorkerBrief: brief.id, brief.missionId ✅
  └─ Provider.dispatch()
     └─ mappingStore.createMapping(provisionalId, workerBriefId, missionId, businessId) ✅

ElevenLabs Call
  └─ conversationId generated ✅

Webhook Arrives
  ├─ conversationId ✅, agent_id ✅
  ├─ mappingStore.getBusinessId(conversationId) or getBusinessIdByWorkerBriefId() ✅
  ├─ call_outcomes CREATED ✅
  └─ memory_events CREATED ✅
```

---

## Files Changed

| File | Change | Type |
|------|--------|------|
| `lib/providers/provider-types.ts` | Add `workerBriefId: string` to `ProviderDispatchResult` | Interface |
| `lib/providers/mock-provider.ts` | Echo `request.workerBriefId` in response | Return value |
| `lib/workers/worker-dispatcher.ts` | Call `mappingStore.createMapping()` after dispatch | New logic |
| `lib/voice/events/conversation-brief-mapping.ts` | Add `getBusinessIdByWorkerBriefId()` method | New method |
| `lib/voice/events/elevenlabs-event-processor.ts` | Accept optional `workerBriefId` param, use provisional mapping | New logic |

---

## Verification Steps

### Test 1: Dispatch registers provisional mapping
```bash
npm run dev
# In another terminal:
curl -X POST http://localhost:3000/api/workers/test-brief \
  -H "Content-Type: application/json" \
  -d '{"missionId":"test_mission","workerBriefId":"test_brief"}'

# Check logs for:
# [worker-dispatcher] 🔵 Registered provisional mapping
```

### Test 2: Webhook finds businessId from provisional mapping
```bash
# Use existing test-mapping endpoint to register
curl -X POST http://localhost:3000/api/webhooks/elevenlabs/test-mapping \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"conv_123",
    "workerBriefId":"brief_456",
    "missionId":"mission_789",
    "businessId":"550e8400-e29b-41d4-a716-446655440000"
  }'

# Send webhook
ELEVENLABS_WEBHOOK_SECRET="test-secret" ./scripts/test-webhook-signature.sh

# Check logs for:
# [event-processor] 🟢 Retrieved context from mapping
#   - businessId: 550e8400-e29b-41d4-a716-446655440000
# [memory-event-repo] 🟢 Memory event successfully inserted
#   - business_id: 550e8400-e29b-41d4-a716-446655440000
```

### Test 3: Both tables populated
```bash
# After webhook test completes:
# Check Supabase
SELECT COUNT(*) FROM call_outcomes;    -- Should be > 0 ✅
SELECT COUNT(*) FROM memory_events;    -- Should be > 0 ✅
```

---

## Impact Summary

| Aspect | Before | After |
|--------|--------|-------|
| Real call → call_outcomes | ✅ Works | ✅ Works |
| Real call → memory_events | ❌ Skipped | ✅ Works |
| Dispatch time mapping | ❌ No | ✅ Provisional |
| Webhook businessId lookup | ❌ null | ✅ Found |
| HTTP 200 response | ✅ Always | ✅ Always |
| Error handling | ✅ Graceful | ✅ Graceful |

---

## Notes

- Solution requires NO schema changes
- Solution requires NO new persistence layers
- Solution works with existing webhook handler
- Provisional mapping is lightweight and in-memory
- When real conversationId arrives, mapping is updated
- Fallback: direct conversationId lookup still works for test endpoints

---

## Next Steps After Implementation

1. Commit test-mapping endpoint (currently untracked)
2. Implement dispatch-time mapping registration (above)
3. Test with real Twilio integration (provider implementation)
4. Verify both call_outcomes and memory_events are created for real calls
