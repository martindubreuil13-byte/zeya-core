# Memory Persistence Forensic Audit

**Call Details:**
- Agent: Veya
- Prospect: Martin Dubreuil
- Conversation ID: conv_8301ktkha9pve7d81e4r9aspabg4
- Duration: 1m50s
- Outcome: Summary generated successfully

**Mission:** Trace the complete post-call memory persistence pipeline

---

## Pipeline Stages (Traced)

### STAGE 1: Webhook Reception

**File:** [app/api/webhooks/elevenlabs/route.ts:20-104](app/api/webhooks/elevenlabs/route.ts#L20-L104)

**Function:** POST handler

**Code:**
```typescript
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  // Verify signature (line 30-54)
  const payload = JSON.parse(rawBody);
  // Validate webhook structure (line 73-80)
  const result = await processElevenLabsWebhook(
    payload,
    payload as unknown as Record<string, unknown>,
    workerBriefId
  );
}
```

**Entry Point:**
- POST /api/webhooks/elevenlabs
- Line 100-104: Calls `processElevenLabsWebhook()`

**Status:** ✅ PASS (webhook route exists and calls processor)

---

### STAGE 2: Webhook Validation & Processing

**File:** [lib/voice/events/elevenlabs-event-processor.ts:57-225](lib/voice/events/elevenlabs-event-processor.ts#L57-L225)

**Function:** `processElevenLabsWebhook()`

**Code Flow:**
```typescript
export async function processElevenLabsWebhook(
  webhook: unknown,
  rawPayload?: Record<string, unknown>,
  workerBriefId?: string
): Promise<ProcessedWebhookResult> {
  // Line 62-69: Validate webhook structure
  if (!isPostCallTranscriptionWebhook(webhook)) { return FAILED; }
  
  // Line 71-79: Extract conversation_id and event_timestamp
  const conversationId = webhook_typed.data.conversation_id;
  const eventTimestamp = webhook_typed.event_timestamp;
  
  // Line 75-80: Extract workerBriefId from webhook user_id if not provided
  if (!workerBriefId && webhook_typed.data.user_id) {
    workerBriefId = webhook_typed.data.user_id;
  }
  
  // Line 83-91: Check for duplicates
  if (isDuplicate(eventTimestamp, conversationId)) {
    return { success: true, duplicate: true, ... };
  }
  
  // Line 97-103: Save conversation to in-memory store
  const conversation = conversationStore.saveConversation(
    conversationId,
    webhook_typed.data.agent_id,
    webhook_typed.data,
    eventTimestamp,
    rawPayload
  );
  
  // Line 114-146: Resolve workerBriefId from mapping
  let resolvedWorkerBriefId = mappingStore.getWorkerBriefId(conversationId);
  let businessId = mappingStore.getBusinessId(conversationId);
  let missionId = mappingStore.getMissionId(conversationId);
  
  // Line 180-187: Call outcome processor
  await processAndStoreOutcome(
    conversation,
    resolvedWorkerBriefId,
    businessId,
    missionId,
    targetName,
    targetPhone
  );
}
```

**Key Lines:**
- Line 100-104: Extract conversation_id from webhook
- Line 128-146: Resolve context from persistent mapping
- Line 180: Call `processAndStoreOutcome()`

**Database Tables Accessed:**
- `brief_conversation_mappings` (line 132: getMappingByWorkerBriefId)

**Status:** ✅ PASS (processor receives webhook, extracts data, resolves context)

---

### STAGE 3: Call Outcome Creation

**File:** [lib/voice/outcomes/call-outcome-processor.ts:60-117](lib/voice/outcomes/call-outcome-processor.ts#L60-L117)

**Function:** `processAndStoreOutcome()`

**Code Flow:**
```typescript
export async function processAndStoreOutcome(
  conversation: CapturedElevenLabsConversation,
  workerBriefId: string | null = null,
  businessId: string | null = null,
  missionId?: string | null,
  targetName?: string | null,
  targetPhone?: string | null,
): Promise<CallOutcome> {
  // Line 75: Build CallOutcome from conversation
  const outcome = buildCallOutcomeFromConversation(
    conversation,
    workerBriefId,
    missionId,
    businessId,
    targetName,
    targetPhone
  ) as any;
  
  // Line 92: Store in memory
  outcomeStore.saveOutcome(outcome);
  
  // Line 104: Persist outcome to Supabase
  await persistOutcome(outcome);
  
  // Line 119+: Process memory event
  await processCallOutcomeToMemoryEvent(outcome, ...);
}
```

**Key Lines:**
- Line 22-54: Define buildCallOutcomeFromConversation (creates outcome object)
- Line 75: Build outcome with all conversation data
- Line 104: Persist to Supabase
- Line 119+: Create memory event from outcome

**Outcome Object Contains:**
```typescript
{
  outcomeId: generateOutcomeId(),
  conversationId: conversation.conversationId,
  workerBriefId: workerBriefId,
  status: conversation.status,
  outcome: detection.outcome,
  confidence: detection.confidence,
  summary: conversation.summary,        // ← Summary from call
  extractedData: conversation.extractedData,  // ← Call data
  recommendedAction: detection.recommendedAction,
  callDuration: conversation.callDuration,
  transcriptLength: conversation.transcript.length,
  createdAt: new Date().toISOString(),
  missionId: missionId || null,
  businessId: businessId || null,
  targetName: targetName || null,
  targetPhone: targetPhone || null,
}
```

**Status:** ✅ PASS (outcome created with all conversation data)

---

### STAGE 4: Call Outcome Persistence

**File:** [lib/voice/persistence/persistence-manager.ts](lib/voice/persistence/persistence-manager.ts)

**Function:** `persistOutcome(outcome)`

**Code Flow:**
```typescript
export async function persistOutcome(outcome: CallOutcome): Promise<void> {
  // Calls outcome-repository.ts saveOutcome()
  const result = await saveOutcome(outcome);
  if (!result.success) {
    throw new Error(`Failed to persist outcome: ${result.error?.message}`);
  }
}
```

**Actual Persistence:** [lib/voice/persistence/outcome-repository.ts:46-131](lib/voice/persistence/outcome-repository.ts#L46-L131)

**Function:** `saveOutcome(outcome)`

**Code:**
```typescript
export async function saveOutcome(outcome: CallOutcome): Promise<SaveOutcomeResult> {
  if (!supabase) {
    return { success: false, error: { ... } };
  }
  
  try {
    const insertPayload = {
      worker_brief_id: outcome.workerBriefId,
      outcome_type: outcome.outcome,
      summary: outcome.summary,           // ← Call summary stored
      next_action: outcome.recommendedAction,
      call_duration_seconds: outcome.callDuration,
      transcript: outcome.extractedData,  // ← Transcript stored
      raw_provider_payload: outcome.extractedData,
      conversation_id: outcome.conversationId,
      mission_id: outcome.missionId,
      business_id: outcome.businessId,
      target_name: outcome.targetName,
      target_phone: outcome.targetPhone,
      updated_at: new Date().toISOString(),
    };
    
    const { error } = await supabase
      .from("call_outcomes")
      .insert([insertPayload]);  // ← INSERT to database
    
    if (error) {
      return { success: false, error: errorObj };
    }
    
    return { success: true };
  }
}
```

**Database Table:** `call_outcomes`

**Supabase Client:** Service-role client (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)

**Status:** ✅ PASS (outcome persisted to call_outcomes table)

---

### STAGE 5: Memory Event Creation

**File:** [lib/voice/outcomes/call-outcome-processor.ts:119-145](lib/voice/outcomes/call-outcome-processor.ts#L119-L145)

**Function:** (inside processAndStoreOutcome)

**Code Flow:**
```typescript
// After outcome persisted (line 104), create memory event
console.log("[outcome-processor] 🔵 Processing memory event", { ... });

await processCallOutcomeToMemoryEvent(outcome, ...);
```

**Called Function:** `processCallOutcomeToMemoryEvent()`

**File:** [lib/memory/events/memory-event-processor.ts](lib/memory/events/memory-event-processor.ts)

**Code:**
```typescript
export async function processCallOutcomeToMemoryEvent(
  outcome: CallOutcome,
  workerBriefId?: string,
  businessId?: string,
  missionId?: string,
): Promise<MemoryEvent> {
  // Build MemoryEvent from CallOutcome
  const memoryEvent = buildMemoryEventFromOutcome(
    outcome,
    workerBriefId || outcome.workerBriefId,
    businessId || outcome.businessId,
    missionId || outcome.missionId,
  );
  
  // Persist MemoryEvent
  await persistMemoryEvent(memoryEvent);
  
  return memoryEvent;
}
```

**Memory Event Contains:**
```typescript
{
  id: generateId(),
  worker_brief_id: workerBriefId,
  business_id: businessId,
  mission_id: missionId,
  event_type: "call_completed",
  summary: `Post-call processing completed. ${outcomeDetails}`,
  outcome_data: {
    conversationId: outcome.conversationId,
    summary: outcome.summary,           // ← Call summary
    outcome: outcome.outcome,
    confidence: outcome.confidence,
    duration: outcome.callDuration,
    transcript: outcome.extractedData,  // ← Transcript data
  },
  created_at: new Date().toISOString(),
}
```

**Status:** ✅ PASS (memory event created with outcome data)

---

### STAGE 6: Memory Event Persistence

**File:** [lib/memory/events/memory-event-processor.ts](lib/memory/events/memory-event-processor.ts)

**Function:** `persistMemoryEvent(memoryEvent)`

**Code:**
```typescript
export async function persistMemoryEvent(
  memoryEvent: MemoryEvent
): Promise<void> {
  // Calls memory-event-repository.ts saveMemoryEvent()
  const result = await saveMemoryEvent(memoryEvent);
  if (!result.success) {
    throw new Error(`Failed to persist memory event: ${result.error?.message}`);
  }
}
```

**Actual Persistence:** [lib/memory/events/memory-event-repository.ts:46-131](lib/memory/events/memory-event-repository.ts#L46-L131)

**Function:** `saveMemoryEvent(memoryEvent)`

**Code:**
```typescript
export async function saveMemoryEvent(
  memoryEvent: MemoryEvent
): Promise<SaveMemoryEventResult> {
  if (!supabase) {
    return { success: false, error: { ... } };
  }
  
  try {
    const insertPayload = {
      id: memoryEvent.id,
      worker_brief_id: memoryEvent.worker_brief_id,
      business_id: memoryEvent.business_id,
      mission_id: memoryEvent.mission_id,
      event_type: memoryEvent.event_type,       // = "call_completed"
      summary: memoryEvent.summary,             // ← Contains call summary
      outcome_data: memoryEvent.outcome_data,   // ← Contains outcome data
      created_at: memoryEvent.created_at,
      updated_at: new Date().toISOString(),
    };
    
    const { error } = await supabase
      .from("memory_events")
      .insert([insertPayload]);  // ← INSERT to database
    
    if (error) {
      return { success: false, error: errorObj };
    }
    
    return { success: true };
  }
}
```

**Database Table:** `memory_events`

**Supabase Client:** Service-role client

**Status:** ✅ PASS (memory event persisted to memory_events table)

---

### STAGE 7: Business Memory Update

**File:** [lib/memory/business-memory/business-memory-manager.ts](lib/memory/business-memory/business-memory-manager.ts)

**Function:** Called after memory event persistence

**Purpose:** Update business-level memory with new learnings

**Status:** ⚠️ UNKNOWN (need to verify if this stage runs after memory event)

---

### STAGE 8: Retrieval Path

**To Answer:** "What happened during Martin's validation call?"

**Code Path:**

1. **Find Memory Events by Business:** [lib/memory/events/memory-event-repository.ts](lib/memory/events/memory-event-repository.ts)
   ```typescript
   export async function getMemoryEventsByBusinessId(
     businessId: string,
     limit: number = 100
   ): Promise<MemoryEvent[]> {
     // Query memory_events WHERE business_id = businessId
   }
   ```

2. **Find Call Outcomes by WorkerBriefId:** [lib/voice/persistence/outcome-repository.ts](lib/voice/persistence/outcome-repository.ts)
   ```typescript
   export async function getOutcomeByWorkerBriefId(
     workerBriefId: string
   ): Promise<PersistedOutcome | null> {
     // Query call_outcomes WHERE worker_brief_id = workerBriefId
   }
   ```

3. **Find Worker Brief:** [lib/workers/worker-brief-repository.ts](lib/workers/worker-brief-repository.ts)
   ```typescript
   export async function getWorkerBriefById(
     briefId: string
   ): Promise<PersistedWorkerBrief | null> {
     // Query worker_briefs WHERE id = briefId
   }
   ```

**Status:** ✅ PASS (retrieval functions exist)

---

## FORENSIC FINDINGS

### A. Can we prove the call was stored anywhere?

**Answer:** YES, IF the webhook was received and processed successfully.

**Evidence Required:**
1. Check `call_outcomes` table for row with `conversation_id = conv_8301ktkha9pve7d81e4r9aspabg4`
2. Check `memory_events` table for row with same conversation_id
3. Check `brief_conversation_mappings` for row linking workerBriefId to conversationId

**Query to Verify:**
```sql
SELECT 
  'call_outcomes' as source,
  id,
  conversation_id,
  worker_brief_id,
  summary,
  created_at
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
UNION ALL
SELECT 
  'memory_events',
  id,
  conversation_id,
  worker_brief_id,
  summary,
  created_at
FROM memory_events
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4' OR
      outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'
UNION ALL
SELECT 
  'brief_conversation_mappings',
  id,
  conversation_id,
  worker_brief_id,
  NULL,
  created_at
FROM brief_conversation_mappings
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4';
```

---

### B. Can we prove these facts are stored?

**Questions:**
1. Martin liked the new voice
2. Martin confirmed persona improvements
3. Martin reported latency remains

**Answer:** DEPENDS on what ElevenLabs returned in webhook summary/transcript

**Evidence Required:**
- Check `call_outcomes.summary` field — does it mention voice quality?
- Check `call_outcomes.transcript` field — does it contain Martin's feedback?
- Check `memory_events.outcome_data.summary` — does it capture the feedback?

**Query:**
```sql
SELECT 
  id,
  conversation_id,
  summary,
  transcript,
  outcome_data,
  created_at
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;
```

**What we'll find:**
- ✅ If ElevenLabs summary includes Martin's feedback → stored in call_outcomes.summary
- ✅ If transcript includes the exchange → stored in call_outcomes.transcript
- ✅ Both copied into memory_events.outcome_data
- ❌ If ElevenLabs summary is empty → no feedback captured

---

### C. Can Zeya tomorrow answer "What happened?"

**Answer:** YES, IF the memory_events table contains the data AND Zeya is configured to query memory_events

**Retrieval Path:**
```typescript
// 1. Find memory events for Martin's business
const memoryEvents = await getMemoryEventsByBusinessId(businessId);

// 2. Filter for conversation about validation call
const validationEvent = memoryEvents.find(e => 
  e.outcome_data?.conversationId === 'conv_8301ktkha9pve7d81e4r9aspabg4'
);

// 3. Extract summary and context
const response = `During Martin's validation call on [date], Veya: ${validationEvent.outcome_data.summary}`;
```

**Status:** ✅ PASS (code path exists IF memory event was persisted)

---

### D. Where the chain breaks (if it breaks)

**Potential Break Points (in order of likelihood):**

1. **Webhook Never Received**
   - Location: /api/webhooks/elevenlabs
   - Evidence: No server logs for `[webhook] 🔵 Webhook route: Request received`
   - Result: No call_outcomes, no memory_events

2. **Webhook Validation Failed**
   - Location: elevenlabs-event-processor.ts:62-69
   - Code: `if (!isPostCallTranscriptionWebhook(webhook)) { return FAILED; }`
   - Evidence: Server logs show `ProcessedWebhookResult.success = false`
   - Result: Webhook processed but no data stored

3. **workerBriefId Not Resolved**
   - Location: elevenlabs-event-processor.ts:114-146
   - Code: `resolvedWorkerBriefId = mappingStore.getWorkerBriefId(conversationId);`
   - Evidence: resolvedWorkerBriefId is null/undefined
   - Result: call_outcomes and memory_events created but worker_brief_id is NULL

4. **outcome.persistOutcome() Failed**
   - Location: call-outcome-processor.ts:104
   - Code: `await persistOutcome(outcome);`
   - Evidence: Server logs show `🔴 Outcome persistence failed`
   - Result: call_outcomes row not created, but memory event might still try

5. **Memory Event Not Created**
   - Location: call-outcome-processor.ts:119+
   - Code: `await processCallOutcomeToMemoryEvent(outcome, ...);`
   - Evidence: Server logs show error OR memory_events table empty
   - Result: Call outcome stored but no memory event

6. **Supabase Service-Role Client Not Initialized**
   - Location: outcome-repository.ts:9-11, memory-event-repository.ts:9-11
   - Code: `const supabase = supabaseUrl && supabaseKey ? createClient(...) : null;`
   - Evidence: `if (!supabase) { return { success: false }; }`
   - Result: INSERT fails silently, no rows created

---

## To Complete This Audit

**Run these queries in Supabase SQL editor:**

```sql
-- 1. Check if call outcome exists
SELECT * FROM call_outcomes 
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
OR worker_brief_id IN (
  SELECT id FROM worker_briefs 
  WHERE LOWER(dynamic_variables::text) LIKE '%martin%'
)
ORDER BY created_at DESC
LIMIT 1;

-- 2. Check if memory event exists
SELECT * FROM memory_events
WHERE outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'
OR worker_brief_id IN (
  SELECT id FROM worker_briefs 
  WHERE LOWER(dynamic_variables::text) LIKE '%martin%'
)
ORDER BY created_at DESC
LIMIT 1;

-- 3. Check brief_conversation_mappings
SELECT * FROM brief_conversation_mappings
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- 4. Check server logs (if available)
-- grep for: "[webhook]", "[event-processor]", "[outcome-processor]", "conv_8301"
```

---

## Summary

**Pipeline Structure:** ✅ COMPLETE (all code exists)

**Execution:** ⚠️ UNKNOWN (depends on whether webhook was received)

**Persistence:** ✅ FUNCTIONAL (service-role clients and INSERT statements verified)

**Retrieval:** ✅ AVAILABLE (query functions exist)

**Status:** Ready for database verification

**Next Step:** Query Supabase tables for actual records from conversation conv_8301ktkha9pve7d81e4r9aspabg4
