# Phase 6 — Persistent Memory Foundation

**Date:** 2026-05-31  
**Duration:** ~1 hour  
**Status:** ✅ **Complete and building successfully**

## Objective

Build the persistent memory architecture that transforms raw conversation events into actionable business knowledge. Memory = history of truth. Profile = current truth.

**Architecture:** Events → Learn Patterns → Derive Facts → Build Knowledge → Persist

## Architecture

### Before Phase 6
```
Conversation Response
    ↓
Extract Facts (Phase 5)
    ↓
Update Profile
    ↓
Refresh Workflow
    ↓
[Next Question]
```

### After Phase 6
```
Conversation Response
    ↓
Extract Facts (Phase 5)
    ↓
Create Memory Events
    ↓
Persist to Database
    ↓
Derive Learning Patterns
    ↓
Build Business Knowledge
    ↓
Update Workflow
    ↓
[Next Question]
```

## Core Components

### 1. Memory Types (`memory-types.ts`)

**Purpose:** Defines the persistent memory data model.

**Key Interfaces:**

- **MemoryEvent:** Raw event with id, type, category, source, field, previousValue, newValue, confidence, timestamps
- **MemoryCategory:** 11 categories (BUSINESS_PROFILE, MISSION, ICP, LEADS, CALL_RESULTS, LEARNINGS, WORKFORCE, WORKFLOW, MESSAGING, COMPETITIVE, OTHER)
- **MemorySource:** 6 sources (CONVERSATION, CALL_RESULT, MANUAL, INFERENCE, SYSTEM, IMPORT)
- **LearningEvent:** Derived insight with pattern, evidence, confidence, description, implication
- **BusinessKnowledge:** Synthesized knowledge with knownFacts, assumptions, validatedLearnings, openQuestions, confidence, coverage
- **KnownFact:** High-confidence statement with category, confidence, sources, firstObserved, lastConfirmed, stable
- **Assumption:** Lower-confidence hypothesis with testable flag, priority, evidence
- **ValidatedLearning:** Evidence-backed learning with frequency, implication, actionable flag
- **OpenQuestion:** Unresolved question with priority, relatedFacts, testMethods

### 2. Memory Engine (`memory-engine.ts`)

**Purpose:** Extract learnings from raw events using rule-based pattern detection.

**Functions:**

- `deriveLearningEvents(events)` — Detect learning patterns and create LearningEvent instances
- `buildBusinessKnowledge(events)` — Transform events into structured BusinessKnowledge
- `buildMemorySummary(knowledge)` — Extract top facts, learnings, and questions for display

**Learning Patterns (4 built-in):**

1. **PRICING_OBJECTION_DETECTED** — 2+ pricing-related objections detected → pricing is a barrier
2. **ICP_CLARIFICATION** — Target customer changed → business refining ICP
3. **ACQUISITION_CHANNEL_IDENTIFIED** — Lead source established → focus outreach on channel
4. **COMMON_OBJECTION_PATTERN** — Same objection in 3+ calls → develop counter-argument

**Confidence Calculation:**

```
Baseline: 50
+ Facts extracted: +10 per fact
+ Long response (>100 chars): +15
+ Long response (>200 chars): +10 additional
+ Direct answer pattern: +10
= Final (capped at 100)
```

### 3. Memory Persistence (`memory-persistence.ts`)

**Purpose:** Save and retrieve memory events from Supabase.

**Functions:**

- `saveMemoryEvent(supabase, event)` — Save single event
- `saveMemoryEvents(supabase, events)` — Save batch, derive learnings, return MemoryPersistenceResult
- `getMemoryEvents(supabase, query)` — Query events with filters (category, source, field, date range)
- `getMemoryEventsByBusiness(supabase, businessId)` — Get all business events
- `getMemoryContextForWorkflow(supabase, businessId)` — Get memory for workflow refresh (last 30 days)
- `updateMemoryEvent(supabase, eventId, updates)` — Update event confidence/notes

**Database Integration:**

Uses existing `memory_events` table (same patterns as `call_results`, `learning_events`).

**No migrations, no new tables, no API endpoints.**

### 4. Conversation-Memory-Workflow Loop (`conversation-memory-workflow-loop.ts`)

**Purpose:** Orchestrates the complete flow from response to next question.

**Main Function:** `processConversationLoop(input) → ConversationLoopResult`

**Flow:**

1. **Extract** — Phase 5 extracts facts from response
2. **Persist** — Phase 6 saves events, derives learnings, builds knowledge
3. **Refresh** — Re-derive business state, guidance, next objective
4. **Return** — New conversation objective for UI to display

**Returns:**

```typescript
{
  extractionResult: ExtractionResult,
  memoryPersisted: boolean,
  newBusinessState: BusinessState | null,
  newExecutiveGuidance: ExecutiveGuidance | null,
  newConversationObjective: ConversationObjective | null,
  errors: string[]
}
```

## Memory-Profile Distinction

### Profile (Current Truth)

Stored in `businesses` and `mission_leads` tables.

Examples:
- `positioning` — What the business does right now
- `target_customers` — Ideal customer right now
- `acquisition_channels` — Current lead sources

**Updated when:** New information directly contradicts or clarifies current state.

**Lifespan:** Persistent. Changed only when founder confirms new reality.

### Memory (History of Truth)

Stored in `memory_events` table.

Examples:
- "Pricing was mentioned in 7 calls" — Evidence of market feedback
- "ICP shifted from SMB to enterprise" — Record of evolution
- "Acquisition channel A performed better than B" — Historical learning

**Updated when:** Any fact extracted from conversation, call result, or system inference.

**Lifespan:** Persistent. Analyzed to derive learnings and insights.

## Example Flow

### Turn 1: Business Context

**Zeya asks:** "What does your business do?"

**Founder answers:** "We help restaurants increase repeat visits through loyalty programs."

**Processing:**
```
Extract: businessDescription = "We help restaurants..."
Event: BUSINESS_PROFILE_UPDATED field=positioning confidence=85
Save: MemoryEvent(type=BUSINESS_PROFILE_UPDATED, field=positioning, newValue=...)
Persist: Save event, derive learnings (none yet)
Profile: Update positioning field
Refresh: deriveBusinessState() → STAGE_MISSION_DEFINITION
Objective: determineNextConversationObjective() → "Define mission"
```

### Turn 2: Mission Definition

**Zeya asks:** "What outcome should this mission create?"

**Founder answers:** "Get 100 restaurants to sign up for our loyalty program in Q3."

**Processing:**
```
Extract: missionOutcome = "Get 100 restaurants..."
Event: BUSINESS_PROFILE_UPDATED field=first_mission confidence=90
Save: MemoryEvent(type=BUSINESS_PROFILE_UPDATED, field=first_mission, ...)
Persist: Save event
Profile: Update first_mission field
Refresh: deriveBusinessState() → readinessScore increases
Objective: determineNextConversationObjective() → "Define ICP"
```

### Turn 3+: Memory Accumulates

Over time, memory events accumulate. After several calls and responses:

**Memory contains:**
- "Pricing objection mentioned 5 times" → PRICING_OBJECTION_DETECTED learning
- "ICP changed 3 times" → ICP_CLARIFICATION learning
- "Channel A produces more conversations" → ACQUISITION_CHANNEL_IDENTIFIED learning

**Knowledge built:**
- KnownFacts: "Target customers are restaurant owners with 5-20 locations"
- Assumptions: "Pricing is a concern for smaller restaurants"
- ValidatedLearnings: "LinkedIn is most effective acquisition channel"
- OpenQuestions: "What discount tier would overcome pricing objection?"

## Files Created

### `lib/memory/memory-types.ts` — 179 lines
Complete type definitions for the memory system. No runtime code.

### `lib/memory/memory-engine.ts` — 320 lines
Pattern detection and business knowledge synthesis.

**Exports:**
- `deriveLearningEvents(events)` — Extract learnings from events
- `buildBusinessKnowledge(events)` — Build complete knowledge base
- `buildMemorySummary(knowledge)` — Extract top items for display

### `lib/memory/memory-persistence.ts` — 263 lines
Supabase integration for memory persistence.

**Exports:**
- `saveMemoryEvent(supabase, event)` — Save single event
- `saveMemoryEvents(supabase, events)` — Save batch with learnings
- `getMemoryEvents(supabase, query)` — Query with filters
- `getMemoryEventsByBusiness(supabase, businessId)` — Get all events
- `getMemoryContextForWorkflow(supabase, businessId)` — Get workflow context
- `updateMemoryEvent(supabase, eventId, updates)` — Update event

### `lib/memory/index.ts` — 4 lines
Central export point for all memory utilities.

### `lib/workflow/conversation-memory-workflow-loop.ts` — 150 lines
Orchestration of conversation → memory → workflow loop.

**Exports:**
- `processConversationLoop(input)` — Main orchestration function
- `buildConversationLoopSummary(result)` — Summary for display

## What This Enables

1. **Persistent Learning** — System remembers what happened and why
2. **Pattern Detection** — Automatically identifies objections, channel performance, market shifts
3. **Evidence Tracking** — Know which conversations/calls support each fact
4. **Confidence Scoring** — Understand how certain we are about each learning
5. **Audit Trail** — See what changed, when, and from what source
6. **Automatic Insights** — System derives assumptions and open questions
7. **No AI/LLM Required** — Pure rule-based pattern detection

## Integration Points

### Phase 5 → Phase 6

Phase 5 (conversation-state-engine.ts) creates:
- `ExtractionResult` with facts, confidence, profile updates

Phase 6 receives this and:
1. Converts facts to MemoryEvents
2. Persists to database
3. Derives learnings
4. Rebuilds business knowledge

### Phase 6 → Workflow Refresh

When memory is persisted with high confidence:
1. `buildBusinessStateInput()` reads from database
2. `deriveBusinessState()` recalculates stages and scores
3. `deriveExecutiveGuidance()` interprets new guidance
4. `determineNextConversationObjective()` determines next question

## Database Schema (No Migration Needed)

Uses existing `memory_events` table with columns:

```sql
id (text)
business_id (text)
type (text)
category (text)
source (text)
field (text)
previous_value (text)
new_value (text)
confidence (integer)
strength (text)
created_at (timestamp)
updated_at (timestamp)
expires_at (timestamp, nullable)
related_event_ids (text[])
notes (text, nullable)
```

Same pattern as `call_results` and `learning_events` tables.

## What Was NOT Changed

✅ **Phase 1 (Workflow Brain)** — Still determines stage from data
✅ **Phase 2 (Executive Guidance)** — Still interprets guidance
✅ **Phase 3 (Conversation Objective)** — Still determines next question
✅ **Phase 4 (Briefing Room UI)** — Still displays orchestration output
✅ **Phase 5 (Conversation Extraction)** — Still extracts facts deterministically
✅ **Database schema** — No migrations required
✅ **Voice/Voice session** — No changes
✅ **API endpoints** — No new endpoints

## Build Status

✅ **TypeScript:** Passes
✅ **Next.js:** Builds in 5.0s
✅ **No errors, no warnings**
✅ **All exports clean**
✅ **Backward compatible**

## Success Indicators

✅ Memory types fully defined
✅ Learning patterns extracted without AI/LLM
✅ Business knowledge synthesized from events
✅ Memory persisted to Supabase
✅ Workflow refresh triggered on memory updates
✅ Conversation loop orchestrated end-to-end
✅ Can integrate with Phase 4.8 UI response handler
✅ No breaking changes to existing phases

## Architecture Summary

**Phase 6 = History of Truth**

```
Raw Events (conversation, calls, system)
    ↓
Learning Patterns (detect signals)
    ↓
Business Knowledge (facts, assumptions, learnings)
    ↓
Persistent Memory (audit trail)
    ↓
Workflow Input (triggers refresh)
```

**Memory is not a dashboard. Memory is not reporting. Memory is the system's understanding of business evolution.**

## What's NOT in Phase 6

❌ Voice transcription
❌ Autonomous agents
❌ Workforce orchestration
❌ LLM-based learning
❌ API endpoints for memory queries
❌ Memory visualization/dashboard
❌ Multi-business comparison
❌ Predictive analytics

## Next Steps

Phase 6 memory foundation is complete. Future phases will:

1. **Phase 7:** Voice transcription → conversation extraction → memory update
2. **Phase 8:** Autonomous call coordinator using memory context
3. **Phase 9:** Workforce orchestration with memory-driven assignments
4. **Phase 10:** Learning summaries and growth insights

## Summary

Phase 6 completes the memory architecture by:

1. **Defining** memory types (what memory looks like)
2. **Extracting** learnings (detecting patterns in events)
3. **Persisting** memory (storing to Supabase)
4. **Synthesizing** knowledge (turning events into insights)
5. **Orchestrating** the loop (connecting phases 5 & 6)

**Key Achievement:** The system now has a persistent record of business evolution. Every conversation, call, and learning is stored, analyzed for patterns, and fed back into workflow decisions.

**Memory transforms Zeya from a stateless responder into a learning operator.**
