# Memory Event Business ID Audit

**Date**: 2026-06-06  
**Status**: Incomplete - businessId source not found in webhook pipeline  
**Error**: PostgreSQL 22P02 on memory_events INSERT (business_id NOT NULL UUID)

---

## Data Flow Trace

### 1. **ElevenLabs Webhook Entry**
**Location**: `app/api/webhooks/elevenlabs/route.ts:20`

```
Input: ElevenLabs webhook payload
├── type: "post_call_transcription"
├── event_timestamp: number
└── data:
    ├── conversation_id: string ✅
    ├── agent_id: string ✅
    ├── status: string ✅
    ├── transcript: array ✅
    ├── summary: string ✅
    ├── call_duration: number ✅
    └── extracted_data: object ✅

Available Context: NONE related to business
- No business_id in webhook
- No mission_id in webhook
- No worker_brief_id in webhook (only extracted from mapping)
```

---

### 2. **Conversation Storage**
**Location**: `lib/voice/events/elevenlabs-event-processor.ts:85-91`

```typescript
const conversation = conversationStore.saveConversation(
  conversationId,                    // ✅ Have it
  webhook_typed.data.agent_id,       // ✅ Have it
  webhook_typed.data,                // ✅ Have it
  eventTimestamp,                    // ✅ Have it
  rawPayload                         // ✅ Have it (full webhook)
);
```

**CapturedElevenLabsConversation fields**:
- conversationId ✅
- agentId ✅
- status ✅
- summary ✅
- transcript ✅
- extractedData ✅
- callDuration ✅
- createdAt ✅

**Missing**: businessId, missionId, workerBriefId (not yet mapped)

---

### 3. **Conversation → Worker Brief Mapping**
**Location**: `lib/voice/events/elevenlabs-event-processor.ts:100`

```typescript
const workerBriefId = mappingStore.getWorkerBriefId(conversationId);
// Returns: string | null
// Source: In-memory map only (no database lookup)
```

**Problem**: Mapping has NO businessId information
- Mapping stores: `conversationId ↔ workerBriefId`
- Mapping does NOT store: `workerBriefId → businessId`

**ConversationBriefMapping fields** (from `lib/voice/events/conversation-brief-mapping.ts:3-7`):
```typescript
conversationId: string;      // ✅
workerBriefId: string;       // ✅
createdAt: string;           // ✅
// NO businessId
// NO missionId
// NO businessContext
```

---

### 4. **CallOutcome Creation**
**Location**: `lib/voice/outcomes/call-outcome-processor.ts:22-46`

```typescript
const outcome = buildCallOutcomeFromConversation(conversation, workerBriefId);
```

**CallOutcome fields** (from `lib/voice/outcomes/call-outcome-types.ts:21-41`):
```typescript
outcomeId: string;                    // ✅
conversationId: string;               // ✅
workerBriefId: string | null;         // ✅
status: "done" | "failed";            // ✅
outcome: OutcomeValue;                // ✅
confidence: number;                   // ✅
summary: string;                      // ✅
extractedData: Record<string, unknown>; // ✅
recommendedAction: RecommendedAction; // ✅
callDuration: number;                 // ✅
transcriptLength: number;             // ✅
createdAt: string;                    // ✅

// ❌ NO businessId
// ❌ NO missionId
```

---

### 5. **Outcome Persistence to Supabase**
**Location**: `lib/voice/persistence/outcome-repository.ts:69-91`

**INSERT to call_outcomes table**:
```sql
INSERT INTO call_outcomes (
  worker_brief_id,           -- from outcome.workerBriefId ✅
  outcome_type,              -- from outcome.outcome ✅
  summary,                   -- from outcome.summary ✅
  next_action,               -- from outcome.recommendedAction ✅
  call_duration_seconds,     -- from outcome.callDuration ✅
  transcript,                -- from outcome.extractedData ✅
  raw_provider_payload,      -- from outcome.extractedData ✅
  updated_at                 -- NOW() ✅
)
-- ❌ mission_id NOT sent (omitted if nullable)
-- ❌ execution_plan_id NOT sent (omitted if nullable)
-- ✅ outcome inserts successfully (worker_brief_id is TEXT, not UUID)
```

**Status**: ✅ **This succeeds** (no UUID issues)

---

### 6. **MemoryEvent Creation**
**Location**: `lib/memory/events/memory-event-processor.ts:12-20`

```typescript
const buildResult = buildMemoryEvent(callOutcome);
// buildResult.memoryEvent created from callOutcome
await persistMemoryEvent(buildResult.memoryEvent);
```

**MemoryEvent fields** (from `lib/memory/events/memory-event-types.ts:14-36`):
```typescript
memoryEventId: string;                    // ✅
memoryType: MemoryType;                   // ✅
source: MemoryEventSource;                // ✅
sourceId: string;                         // ✅
workerBriefId: string | null;             // ✅
conversationId: string;                   // ✅
confidence: number;                       // ✅
payload: Record<string, unknown>;         // ✅
createdAt: string;                        // ✅

// ❌ NO businessId field in interface
// ❌ NO missionId
```

---

### 7. **MemoryEvent Persistence to Supabase**
**Location**: `lib/voice/persistence/memory-event-repository.ts:60-101`

**INSERT to memory_events table**:
```sql
INSERT INTO memory_events (
  business_id,           -- from parameter businessId || null ❌❌❌
  event_type,            -- from event.memoryType ✅
  content,               -- from JSON.stringify(event.payload) ✅
  metadata,              -- from event.payload ✅
  source,                -- from event.source ✅
  updated_at             -- NOW() ✅
)
-- ❌ business_id = null (since businessId parameter not passed)
-- ❌ Schema requires: business_id UUID NOT NULL
-- ❌ ERROR 22P02: invalid input syntax for type uuid (now with null)
```

**Status**: ❌ **FAILS** - business_id is NULL but schema requires UUID NOT NULL

---

## Business ID Source Analysis

### Question 1: Where should businessId come from?

**Chain required to get businessId**:

```
ElevenLabs webhook
  ↓ (have conversationId)
Conversation Store
  ↓ (no businessId here)
Conversation-Brief Mapping (conversationId → workerBriefId)
  ↓ (mapping has no businessId)
??? WHERE IS workerBriefId CREATED WITH businessId CONTEXT?
  ↓
??? NEED TO QUERY: SELECT missionId FROM worker_briefs WHERE id = ?
  ↓
??? NEED TO QUERY: SELECT businessId FROM missions WHERE id = ?
```

**Key problem**: No queries are executed. Everything is in-memory or assumptions.

---

### Question 2: Is workerBrief linked to a business?

**WorkerBrief structure** (from `lib/workers/worker-brief-types.ts:9-46`):
```typescript
interface WorkerBrief {
  id: string;                          // ✅
  missionId: string;                   // ✅ YES - Links to Mission
  executionRequestId?: string;
  workerType: WorkerType;
  workerName: string;
  status: WorkerBriefStatus;
  companyContext: string;              // 📝 May contain business info
  leadContext?: string;
  objective: string;
  desiredOutcome: string;
  keyQuestions: string[];
  objectionGuidance: string[];
  escalationRules: string[];
  successCriteria: string;
  toneGuidance?: string;
  dynamicVariables: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  
  // ❌ NO businessId field
  // ✅ Has missionId which has businessId
}
```

**Answer**: WorkerBrief is **indirectly** linked:
- WorkerBrief.missionId → Mission.businessId (need database query)
- WorkerBrief currently not queried from database during webhook processing

---

### Question 3: Is there a default business record?

**Search results**: NO
- No hardcoded default business ID found
- No placeholder business UUID in code
- No "demo" or "test" business ID in config

**Implication**: Every memory event MUST have a real businessId

---

### Question 4: Should MemoryEvents be created if businessId is unknown?

**Current behavior**: YES, but it fails on Supabase

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| A. Skip memory event if no businessId | Prevents data corruption | Loses call context |
| B. Query DB to get businessId | Complete data | Requires DB access, slower |
| C. Add businessId to MemoryEvent type + trace it | Full traceability | Requires architecture change |
| D. Add businessId to webhook mapping | Lightweight, cached | Requires mapping creation to know businessId |

---

## Data Availability at Each Stage

### Stage 1: Webhook Entry
```
✅ conversationId
✅ agentId
✅ transcript, summary, status, duration
❌ workerBriefId (will be mapped later)
❌ missionId
❌ businessId
```

### Stage 2: After Mapping
```
✅ conversationId
✅ agentId
✅ workerBriefId (from mapping)
❌ missionId (would need DB query on workerBriefId)
❌ businessId (would need DB query on missionId)
```

### Stage 3: CallOutcome Created
```
✅ conversationId
✅ workerBriefId
❌ businessId (not in CallOutcome type)
❌ missionId (not in CallOutcome type)
```

### Stage 4: MemoryEvent Creation
```
✅ conversationId
✅ workerBriefId
❌ businessId (not in MemoryEvent type)
❌ missionId (not in MemoryEvent type)
```

### Stage 5: Supabase Persistence
```
Need: business_id (UUID NOT NULL)
Have: null
Result: ❌ PostgreSQL error 22P02
```

---

## Root Cause Summary

| Item | Value | Issue |
|------|-------|-------|
| **Schema requirement** | memory_events.business_id UUID NOT NULL | Hard requirement |
| **Data available at webhook** | No business context | ElevenLabs webhook is agnostic |
| **MemoryEvent interface** | No businessId field | Design gap |
| **CallOutcome interface** | No businessId field | Design gap |
| **WorkerBrief interface** | Has missionId but not businessId | Lookup chain needed |
| **Mapping store** | No businessId data | Only tracks conversationId ↔ workerBriefId |
| **Database queries in flow** | None | Everything in-memory |
| **Current fallback** | null (then failed) | Invalid for NOT NULL UUID column |

---

## Recommended Investigation

Before implementing a fix, need to answer:

1. **Are WorkerBriefs created with a known business context?**
   - Check where conversation-brief mapping is created
   - Does it happen during worker dispatch?
   - Does the dispatcher have access to businessId?

2. **Should mapping store include businessId?**
   - When mapping is created, is businessId available?
   - Would it be more efficient to store it in mapping vs. querying later?

3. **Is the webhook guaranteed to have business context?**
   - Should webhook route accept optional businessId parameter?
   - Should it query database to find businessId from workerBriefId?

4. **What is the expected behavior in demo/test scenarios?**
   - Webhook test script has no businessId context
   - Should memory events be skipped in test scenarios?
   - Should test scenarios use a default demo business ID?

---

## Logging Added

Added comprehensive logging to trace businessId:
- `lib/voice/persistence/memory-event-repository.ts`: businessId parameter trace
- `lib/voice/outcomes/call-outcome-processor.ts`: outcome vs memory event persistence status

**Next deployment**: Logs will show whether outcome inserts successfully before memory event failure.
