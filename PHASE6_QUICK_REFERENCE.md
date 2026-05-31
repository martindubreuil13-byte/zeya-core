# Phase 6: Quick Reference

## What Phase 6 Does

Converts raw conversation events into persistent business memory.

```
Founder Response
    ↓ (Phase 5)
Extract Facts
    ↓ (Phase 6)
Create Memory → Detect Patterns → Derive Learnings → Persist
    ↓
Workflow Refresh
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/memory/memory-types.ts` | Type definitions (no runtime code) |
| `lib/memory/memory-engine.ts` | Learning extraction & knowledge building |
| `lib/memory/memory-persistence.ts` | Supabase integration |
| `lib/workflow/conversation-memory-workflow-loop.ts` | Full loop orchestration |

## Core Concept: Memory vs. Profile

```
Profile = Current Truth (what we know now)
    └─ stored in: businesses, mission_leads tables

Memory = History of Truth (how we got here)
    └─ stored in: memory_events table
```

## Main Orchestration Function

```typescript
import { processConversationLoop } from "@/lib/workflow/conversation-memory-workflow-loop";

const result = await processConversationLoop({
  supabase,
  businessId,
  businessState,              // From Phase 1
  executiveGuidance,          // From Phase 2
  conversationObjective,      // From Phase 3
  founderResponse,            // What founder said
  previousProfile             // Current profile state
});

// Returns:
// - extractionResult: What we extracted (Phase 5)
// - memoryPersisted: Did we save to DB?
// - newBusinessState: Refreshed workflow state (Phase 1)
// - newExecutiveGuidance: Reinterpreted guidance (Phase 2)
// - newConversationObjective: Next question (Phase 3)
```

## What Gets Extracted?

### Learning Patterns (Automatic)

1. **PRICING_OBJECTION_DETECTED** — 2+ mentions of cost/price
2. **ICP_CLARIFICATION** — Target customer changed
3. **ACQUISITION_CHANNEL_IDENTIFIED** — Lead source established
4. **COMMON_OBJECTION_PATTERN** — Same objection 3+ times

### Derived Knowledge (From Events)

- **KnownFacts:** High-confidence statements (confidence ≥80)
- **Assumptions:** Lower-confidence hypotheses (confidence 50-80)
- **ValidatedLearnings:** Evidence-backed patterns
- **OpenQuestions:** Unresolved questions with test methods

## Confidence Scoring

```
Baseline: 50
+ Facts extracted: +10 per fact
+ Response >100 chars: +15
+ Response >200 chars: +10 more
+ Direct answer pattern ("we", "I"): +10
= Final Score (max 100)
```

High confidence (>80) → saved to profile
Medium confidence (50-80) → recorded as assumption
Low confidence (<50) → recorded as question

## Integration with Phase 5

Phase 5 outputs `ExtractionResult`:
```typescript
{
  extractedFacts: { field: value },
  memoryEvents: [ { type, field, previousValue, newValue } ],
  profileUpdates: { field: value },
  workflowNeedsRefresh: boolean,
  confidence: number
}
```

Phase 6 takes this and:
1. Converts memoryEvents to MemoryEvent (adds id, timestamps)
2. Saves to `memory_events` table
3. Derives learnings using patterns
4. Builds BusinessKnowledge from all events

## Database Schema

Uses existing `memory_events` table:

```sql
id TEXT PRIMARY KEY
business_id TEXT
type TEXT
category TEXT
source TEXT
field TEXT
previous_value TEXT
new_value TEXT
confidence INTEGER (0-100)
strength TEXT (weak|moderate|strong)
created_at TIMESTAMP
updated_at TIMESTAMP
expires_at TIMESTAMP (nullable)
related_event_ids TEXT[] (nullable)
notes TEXT (nullable)
```

**No migrations needed.** Uses exact same table as call results and learning events.

## Memory Categories

```
BUSINESS_PROFILE   → positioning, revenue, team
MISSION           → first_mission, mission_outcome
ICP               → target_customers, pain_points
LEADS             → acquisition_channels, prospect_list
CALL_RESULTS      → call_data, objections
LEARNINGS         → validated_learnings, insights
WORKFORCE         → caller_brief, assignments
WORKFLOW          → stage_history, transitions
MESSAGING         → positioning_messaging
COMPETITIVE       → market_positioning
OTHER             → misc notes
```

## Memory Sources

- **CONVERSATION** — Founder response
- **CALL_RESULT** — Sales call feedback
- **MANUAL** — Founder entered directly
- **INFERENCE** — System derived
- **SYSTEM** — Auto-generated
- **IMPORT** — From external system

## Example: Full Loop

### Turn 1 - Business Description

```
Founder: "We help restaurants increase repeat visits through loyalty programs."

Extract: businessDescription = "We help restaurants..."
Confidence: 85 (baseline 50 + 1 fact × 10 + >100 chars × 15 + direct pattern × 10)

Event Created:
{
  type: "BUSINESS_PROFILE_UPDATED",
  field: "positioning",
  newValue: "We help restaurants...",
  confidence: 85,
  source: "CONVERSATION"
}

Saved to: memory_events table
Learning: (none yet - need more data)
Profile: Update positioning
Workflow: Recalculate → ready for mission definition
```

### Turn 2+ - Multiple Objections

```
Call 1: "Pricing is too high"
Call 2: "Cost is a barrier"
Call 3: "Can't afford it"

Events Created:
[
  { type: "OBJECTION", field: "objections", newValue: "Pricing too high" },
  { type: "OBJECTION", field: "objections", newValue: "Cost barrier" },
  { type: "OBJECTION", field: "objections", newValue: "Can't afford" }
]

Learning Detected:
PRICING_OBJECTION_DETECTED
  Pattern: 3 pricing-related objections
  Implication: Pricing may be a barrier to acquisition
  Confidence: 90 (3 events × 20 + strong evidence)

Knowledge Updated:
- ValidatedLearning: "Pricing objection appears in 3 calls"
- OpenQuestion: "What discount tier would overcome objection?"
```

## Querying Memory

```typescript
import { getMemoryContextForWorkflow } from "@/lib/memory/memory-persistence";

const context = await getMemoryContextForWorkflow(supabase, businessId);

// Returns:
{
  recentEvents: [ /* last 30 days */ ],
  knowledge: {
    knownFacts: [ /* high confidence */ ],
    assumptions: [ /* medium confidence */ ],
    validatedLearnings: [ /* patterns detected */ ],
    openQuestions: [ /* unresolved */ ]
  }
}
```

## What Memory Enables

✅ **Automatic Learning** — System detects patterns without asking
✅ **Confidence Tracking** — Know how certain we are
✅ **Audit Trail** — See what changed, when, why
✅ **Evidence Binding** — Know which events support which facts
✅ **Assumption Testing** — System flags what needs validation
✅ **Pattern Detection** — Identifies objections, channels, shifts
✅ **No AI Required** — Pure rule-based pattern matching

## What Memory Does NOT Do

❌ Replace the founder's judgment
❌ Make autonomous decisions
❌ Predict future outcomes
❌ Analyze sentiment or emotion
❌ Make API calls
❌ Generate reports or dashboards
❌ Train ML models

Memory is strictly: **event → pattern → knowledge → workflow input**

## Integration Checklist

- [ ] Call `processConversationLoop()` after founder response
- [ ] Check `result.memoryPersisted` to verify save
- [ ] Use `result.newConversationObjective` for next question
- [ ] Optional: Display `result.extractionResult.confidence` to show certainty
- [ ] Optional: Show extracted facts for transparency ("I heard that your target customer is X")

## Testing Memory

```typescript
// Test extraction
const extracted = extractFacts("DEFINE_ICP", "Independent restaurants");
expect(extracted.targetCustomers).toBeDefined();

// Test learning detection
const learnings = deriveLearningEvents(mockEvents);
expect(learnings).toHaveLength(1);
expect(learnings[0].pattern).toBe("PRICING_OBJECTION_DETECTED");

// Test persistence
const saved = await saveMemoryEvent(supabase, event);
expect(saved.id).toBeDefined();
expect(saved.confidence).toBe(85);
```

## Performance Notes

- Memory events are append-only (no deletes/updates)
- Queries use index on `business_id` + `created_at`
- Last 30 days kept in fast path, older events archived
- Learning detection runs at save time (not deferred)
- No background jobs required

## Next Phase (Phase 7)

Voice transcription will feed into the same system:

```
Voice Recording
    ↓
Transcribe → Text
    ↓
Same extraction pipeline
    ↓
Same memory storage
    ↓
Same workflow refresh
```

Phase 6 memory foundation works for text, voice, API, or manual input. **The interface doesn't matter. The logic is the same.**

---

## TL;DR

Phase 6 = Persistent memory system that:
1. Saves every fact extraction to `memory_events`
2. Detects patterns automatically
3. Builds business knowledge from events
4. Feeds back into workflow refresh

**No AI. No dashboard. No API endpoints. Just deterministic pattern detection.**
