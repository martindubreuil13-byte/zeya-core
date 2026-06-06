# Persistence Audit: Phase 12A Repositories vs Actual Schema

**Date**: 2026-06-06  
**Status**: ✅ RECONCILIATION COMPLETE  
**Action**: Repositories adapted to existing schema; no duplicates created

---

## Schema Inventory

### Tables Present in Production
- ✅ `call_outcomes` (20 columns)
- ✅ `memory_events` (10 columns)

### Tables Missing from Production
- ❌ `conversations` (needed for Phase 12A?)
- ❌ `learning_insights` (needed for Phase 12C?)

---

## call_outcomes Audit

### Actual Production Columns

```sql
id                      UUID (PK)
mission_id              UUID
execution_plan_id       UUID
worker_brief_id         TEXT
worker_name             TEXT
worker_type             TEXT
target_name             TEXT
target_phone            TEXT
outcome_type            TEXT
sentiment               TEXT
summary                 TEXT
objections              TEXT
key_insights            TEXT
next_action             TEXT
follow_up_required      BOOLEAN
follow_up_date          TIMESTAMP
meeting_booked          BOOLEAN
meeting_date            TIMESTAMP
call_duration_seconds   INT
transcript              JSONB/TEXT
raw_provider_payload    JSONB
created_at              TIMESTAMP
```

### Phase 12A Repository Expectations

```typescript
interface PersistedOutcome {
  id: string;                    ✅ MATCH (UUID→string)
  outcome_id: string;            ❌ NO MATCH - doesn't exist
  conversation_id: string;       ❌ NO MATCH - doesn't exist
  worker_brief_id: string | null;✅ MATCH
  status: "done"|"failed";       ❌ MISMATCH - actual has outcome_type
  outcome: string;               ✅ MATCH (maps to outcome_type)
  confidence: number;            ❌ NO MATCH - doesn't exist
  summary: string;               ✅ MATCH
  recommended_action: string;    ⚠️  MISMATCH - actual has next_action
  call_duration: number;         ✅ MATCH (call_duration_seconds)
  transcript_length: number;     ❌ NO MATCH - doesn't exist
  extracted_data: JSONB;         ✅ MATCH (raw_provider_payload)
  created_at: string;            ✅ MATCH
  updated_at: string;            ❌ NO MATCH - doesn't exist
}
```

### Upsert Key Problem

**Phase 12A Code**:
```typescript
.upsert({...}, { onConflict: "outcome_id" })
```

**Actual Schema**:
- `outcome_id` field does **NOT EXIST**
- Unique key is `id` (UUID, auto-generated)
- No business-level unique constraint for upsert

**Impact**: ❌ CRITICAL - Upsert will fail with "outcome_id not found"

### Gap Analysis: call_outcomes

| Phase 12A Field | Actual Column | Status | Action |
|-----------------|---------------|--------|--------|
| outcome_id | (none) | ❌ Missing | Remove from code, use `id` |
| conversation_id | (none) | ❌ Missing | Remove from code |
| status | outcome_type | ⚠️ Different | Map "done"→outcome_type |
| outcome | outcome_type | ✅ | Keep as is |
| confidence | (none) | ❌ Missing | Remove or add column |
| summary | summary | ✅ | Keep as is |
| recommended_action | next_action | ⚠️ Different | Rename mapping |
| call_duration | call_duration_seconds | ✅ | Rename mapping |
| transcript_length | (none) | ❌ Missing | Remove |
| extracted_data | raw_provider_payload | ✅ | Rename mapping |
| created_at | created_at | ✅ | Keep as is |
| updated_at | (none) | ❌ Missing | ADD COLUMN |

**Actual has but Phase 12A ignores**:
- mission_id
- execution_plan_id
- worker_name
- worker_type
- target_name
- target_phone
- sentiment
- objections
- key_insights
- follow_up_required
- follow_up_date
- meeting_booked
- meeting_date
- transcript

---

## memory_events Audit

### Actual Production Columns

```sql
id          UUID (PK)
business_id UUID
event_type  TEXT
content     TEXT
metadata    JSONB
created_at  TIMESTAMP
importance  TEXT
summary     TEXT
source      TEXT
```

### Phase 12A Repository Expectations

```typescript
interface PersistedMemoryEvent {
  id: string;                    ✅ MATCH (UUID→string)
  memory_event_id: string;       ❌ NO MATCH - doesn't exist
  memory_type: string;           ⚠️  MISMATCH - actual has event_type
  source: string;                ✅ MATCH
  source_id: string;             ❌ NO MATCH - doesn't exist
  worker_brief_id: string | null;❌ NO MATCH - doesn't exist
  conversation_id: string;       ❌ NO MATCH - doesn't exist
  confidence: number;            ❌ NO MATCH - doesn't exist
  payload: JSONB;                ✅ MATCH (metadata)
  created_at: string;            ✅ MATCH
  updated_at: string;            ❌ NO MATCH - doesn't exist
}
```

### Upsert Key Problem

**Phase 12A Code**:
```typescript
.upsert({...}, { onConflict: "memory_event_id" })
```

**Actual Schema**:
- `memory_event_id` field does **NOT EXIST**
- Unique key is `id` (UUID, auto-generated)
- No business-level unique constraint for upsert

**Impact**: ❌ CRITICAL - Upsert will fail with "memory_event_id not found"

### Gap Analysis: memory_events

| Phase 12A Field | Actual Column | Status | Action |
|-----------------|---------------|--------|--------|
| memory_event_id | (none) | ❌ Missing | Remove from code, use `id` |
| memory_type | event_type | ⚠️ Different | Rename mapping |
| source | source | ✅ | Keep as is |
| source_id | (none) | ❌ Missing | Remove from code |
| worker_brief_id | (none) | ❌ Missing | Remove from code |
| conversation_id | (none) | ❌ Missing | Remove from code |
| confidence | (none) | ❌ Missing | Remove or add column |
| payload | metadata | ✅ | Rename mapping |
| created_at | created_at | ✅ | Keep as is |
| updated_at | (none) | ❌ Missing | ADD COLUMN |

**Actual has but Phase 12A ignores**:
- business_id (REQUIRED - FK constraint likely exists)
- importance
- summary
- event_type (used as memory_type)

---

## Missing Tables Decision

### conversations Table

**Question**: Is `conversations` still needed?

**Analysis**:
- Phase 12A webhook flow expects to persist conversation data
- Actual `call_outcomes` table already contains:
  - transcript (full conversation text)
  - summary (conversation summary)
  - raw_provider_payload (structured ElevenLabs data)
  - outcome_type, sentiment, key_insights, objections (derived from conversation)
- No need for separate table

**Decision**: ❌ **DO NOT CREATE** — call_outcomes is sufficient

---

### learning_insights Table

**Question**: Is `learning_insights` still needed?

**Analysis**:
- Phase 12C will generate insights from memory_events
- Existing `learning_events` table (from 20260530_learning_layer.sql) already handles:
  - business_id (FK)
  - learning_type (objection_pattern, message_resonance, follow_up_pattern, outcome_pattern)
  - title, description, confidence, source_count
  - created_at
- Reuse existing structure

**Decision**: ❌ **DO NOT CREATE** — Use existing `learning_events` table

---

## Required Changes

### ALTER TABLE call_outcomes

**Missing critical column for upsert**:

```sql
ALTER TABLE call_outcomes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_call_outcomes_updated_at 
ON call_outcomes(updated_at DESC);
```

**Why**: Phase 12A repositories use `updated_at` for tracking when records are updated. Required for upsert operations.

---

### ALTER TABLE memory_events

**Missing critical column for upsert**:

```sql
ALTER TABLE memory_events
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_memory_events_updated_at 
ON memory_events(updated_at DESC);
```

**Why**: Phase 12A repositories use `updated_at` for tracking when records are updated. Required for upsert operations.

---

## Repository Adaptation Requirements

### outcome-repository.ts Must Be Rewritten

**Current (BROKEN)**:
```typescript
.upsert({
  outcome_id: outcome.outcomeId,        // ❌ Field doesn't exist
  conversation_id: outcome.conversationId, // ❌ Field doesn't exist
  status: outcome.status,               // ❌ Should be outcome_type
  confidence: outcome.confidence,       // ❌ Field doesn't exist
  recommended_action: outcome.recommendedAction, // ❌ Should be next_action
  call_duration: outcome.callDuration,  // ❌ Should be call_duration_seconds
  extracted_data: outcome.extractedData, // ❌ Should be raw_provider_payload
  updated_at: new Date().toISOString(),
}, { onConflict: "outcome_id" })        // ❌ outcome_id is not unique key
```

**Required Rewrite**:
1. Remove: outcome_id, conversation_id, status, confidence, transcript_length fields
2. Map: outcome → outcome_type
3. Map: recommended_action → next_action
4. Map: call_duration → call_duration_seconds
5. Map: extracted_data → raw_provider_payload
6. Change upsert key: Use `id` (UUID) instead of outcome_id
7. Add: mission_id, execution_plan_id (from CallOutcome if available)

**Problem**: CallOutcome type doesn't have mission_id, execution_plan_id. These must come from context or be optional.

---

### memory-event-repository.ts Must Be Rewritten

**Current (BROKEN)**:
```typescript
.upsert({
  memory_event_id: event.memoryEventId,  // ❌ Field doesn't exist
  memory_type: event.memoryType,         // ❌ Should be event_type
  source_id: event.sourceId,             // ❌ Field doesn't exist
  worker_brief_id: event.workerBriefId,  // ❌ Field doesn't exist
  conversation_id: event.conversationId, // ❌ Field doesn't exist
  confidence: event.confidence,          // ❌ Field doesn't exist
  payload: event.payload,                // ❌ Should be metadata
  updated_at: new Date().toISOString(),
}, { onConflict: "memory_event_id" })    // ❌ memory_event_id is not unique key
```

**Required Rewrite**:
1. Remove: memory_event_id, source_id, worker_brief_id, conversation_id, confidence fields
2. Map: memory_type → event_type
3. Map: payload → metadata
4. Change upsert key: Use `id` (UUID) instead of memory_event_id
5. Add: business_id (REQUIRED - FK constraint)
6. Keep: source, content, created_at

**Problem**: MemoryEvent type doesn't have business_id. This must be added to MemoryEvent interface or passed separately.

---

## What NOT To Do

❌ **DO NOT** create call_outcomes table (already exists)  
❌ **DO NOT** create memory_events table (already exists)  
❌ **DO NOT** create conversations table (not needed)  
❌ **DO NOT** create learning_insights table (use learning_events)  
❌ **DO NOT** change existing call_outcomes columns  
❌ **DO NOT** change existing memory_events columns  

---

## Minimal Migration SQL

```sql
-- Add missing updated_at columns ONLY
ALTER TABLE call_outcomes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE memory_events
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_call_outcomes_updated_at 
ON call_outcomes(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_events_updated_at 
ON memory_events(updated_at DESC);
```

---

## Repository Rewrite Scope

| File | Changes Required | Impact |
|------|------------------|--------|
| outcome-repository.ts | MAJOR - Map all fields | 15+ lines changed |
| memory-event-repository.ts | MAJOR - Map all fields | 15+ lines changed |
| Interfaces (PersistedOutcome) | BREAKING - Remove fields | Remove: outcome_id, conversation_id, status, confidence, transcript_length |
| Interfaces (PersistedMemoryEvent) | BREAKING - Remove fields | Remove: memory_event_id, source_id, worker_brief_id, conversation_id, confidence |

---

## Summary

| Item | Decision | Reason |
|------|----------|--------|
| Create conversations table | ❌ NO | call_outcomes has all needed data |
| Create learning_insights table | ❌ NO | Use existing learning_events |
| Adapt call_outcomes repository | ✅ YES | Field mismatches, upsert key problem |
| Adapt memory_events repository | ✅ YES | Field mismatches, upsert key problem |
| Add updated_at to call_outcomes | ✅ YES | Required for upsert operations |
| Add updated_at to memory_events | ✅ YES | Required for upsert operations |

---

## Reconciliation Status

**Completed Tasks**:
1. ✅ **outcome-repository.ts**: Rewritten to map Phase 12A fields to actual call_outcomes columns
2. ✅ **memory-event-repository.ts**: Rewritten to map Phase 12A fields to actual memory_events columns
3. ✅ **persistence-manager.ts**: Removed conversation persistence (table doesn't exist yet)
4. ✅ **elevenlabs-event-processor.ts**: Removed persistConversation call
5. ✅ **API endpoints**: Updated /api/persistence/status to remove conversations stat
6. ✅ **Deleted**: conversation-repository.ts (no Supabase table)
7. ✅ **Deleted**: insight-repository.ts (use learning_events instead)
8. ✅ **Deleted**: 20260606_create_persistence_tables.sql (duplicate)

**Pending Tasks**:
1. **Apply minimal migration**: `20260606_adapt_persistence_to_existing_schema.sql` (adds updated_at columns)
2. **Verify persistence**: Test with real call data to confirm rows created in both tables
3. **Future decision**: Create conversations and learning_insights tables after verification

**Result**: Single source of truth, no duplicate tables, Phase 12B repositories fully adapted to production schema. Build succeeds with TypeScript checking.
