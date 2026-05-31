# Zeya Architecture: Phases 1–6

**Complete Voice-First AI BDE Platform Foundation**

## System Overview

Zeya is a deterministic, conversation-driven system that transforms founder responses into memory, which drives workflow progression automatically.

```
Founder Response
    ↓
Extract Facts (Phase 5)
    ↓
Create Memory Events (Phase 6)
    ↓
Business State (Phase 1)
    ↓
Executive Guidance (Phase 2)
    ↓
Conversation Objective (Phase 3)
    ↓
UI Rendering (Phase 4)
    ↓
[Next Question]
```

## Phase 1: Workflow Brain (`derive-business-state.ts`)

**What:** Deterministic stage progression and readiness scoring.

**Input:** Business data (profile, calls, learnings)

**Output:** BusinessState with currentStage, readinessScore, confidence, blockingReason, priority, nextAction

**Functions:**
- `deriveWorkflowStage()` — Sequential gate logic (ONBOARDING → OPTIMIZATION, 10 stages)
- `deriveReadinessScore()` — Points-based: business (10), mission (15), ICP (25), leads (15), sales (10), workforce (8), execution (12), learning (7)
- `deriveBlockingReason()` — Why progress is blocked
- `derivePriority()` — Current focus area
- `deriveNextAction()` — What to do next
- `deriveConfidence()` — How certain we are (0-100)
- `deriveDataCompleteness()` — What's missing (0-100)

**Pure Functions:** No AI, no database access, no side effects.

**Deterministic:** Same input = same output, always.

## Phase 2: Executive Guidance (`derive-executive-guidance.ts`)

**What:** Human-centered interpretation of workflow state.

**Input:** BusinessState

**Output:** ExecutiveGuidance with summary, objective, rationale, workforceDirection, urgency, successDefinition, nextMilestone

**Functions:**
- 10 stage-specific builders (one per stage)
- Each returns human-readable guidance

**Principle:** Make the workflow feel like an experienced operator is guiding the founder.

## Phase 3: Conversation Objective (`determine-next-conversation-objective.ts`)

**What:** Determine what Zeya should ask next.

**Input:** BusinessState, ExecutiveGuidance

**Output:** ConversationObjective with question, tone, expectedResponse, completionCriteria

**Functions:**
- 10 stage-specific objective builders
- Each returns a complete question strategy

**Tone Derivation:**
- SUPPORTIVE — Onboarding, building confidence
- DIRECT — Blocked stages, needs clarity
- EXECUTIVE — Execution stages, rapid progression

## Phase 4: Briefing Room UI (`ZeyaBriefingRoom.tsx` + `zeya-operating-view.ts`)

**What:** Conversation-first interface that puts response input at center.

**Design Principles:**
1. Response input is the primary interaction
2. Transcript shows conversation history
3. Briefing hidden by default ("Show briefing" toggle)
4. Metrics visible only when expanded

**Components:**
- OperatingViewSection — Conversation interface with response textarea
- BriefSection — Collapsed briefing panel
- formatUrgencyBadge() — Map urgency to visual status
- formatMissingInfoForBriefing() — "I need:" pattern vs "Missing:"

**Philosophy:** "The interaction is the product." Not a dashboard. A conversation.

## Phase 5: Conversation Extraction (`conversation-state-engine.ts`)

**What:** Convert founder responses into profile updates and memory events.

**Input:** ConversationResponseInput with businessState, guidance, objective, founderResponse

**Output:** ExtractionResult with extractedFacts, profileUpdates, memoryEvents, workflowNeedsRefresh, confidence

**Extraction Rules (by objective type):**

| Question Type | Pattern | Extract |
|---|---|---|
| COLLECT_BUSINESS_CONTEXT | "we help..." | businessDescription |
| DEFINE_MISSION | Any response | missionOutcome |
| DEFINE_ICP | Any response | targetCustomers |
| REQUEST_LEADS | Any response | leadSourceStrategy |
| REVIEW_LEADS | Any response | selectedProspectCriteria |
| PREPARE_CALLER_BRIEF | Any response | callerInstructions |
| REVIEW_RESULTS | Objections | callPatterns, objections |
| OPTIMIZE_WORKFLOW | Any response | optimizationSuggestion |

**Confidence Scoring:**
```
Baseline: 50
+ Facts: +10 per fact
+ Long (>100 chars): +15
+ Long (>200 chars): +10 more
+ Direct pattern: +10
= Final (max 100)
```

**Key Principle:** No LLM. Pure pattern matching. Deterministic.

## Phase 6: Persistent Memory (`memory-engine.ts` + `memory-persistence.ts`)

**What:** Transform raw events into actionable business knowledge.

**Input:** MemoryEvent[] (from Phase 5 extraction)

**Output:** BusinessKnowledge with knownFacts, assumptions, validatedLearnings, openQuestions

**Memory vs. Profile:**
- **Profile** = current truth (what the business is now)
- **Memory** = history of truth (how we got here)

**Learning Patterns (4 built-in):**
1. PRICING_OBJECTION_DETECTED (2+ pricing mentions)
2. ICP_CLARIFICATION (target customer changed)
3. ACQUISITION_CHANNEL_IDENTIFIED (lead source established)
4. COMMON_OBJECTION_PATTERN (same objection 3+ times)

**Functions:**
- `deriveLearningEvents()` — Pattern detection
- `buildBusinessKnowledge()` — Event → facts/assumptions/learnings
- `saveMemoryEvent()` — Persist to Supabase
- `getMemoryContextForWorkflow()` — Retrieve for workflow refresh

**Database:** Uses existing `memory_events` table. No migrations.

## Integration: The Complete Loop

### Conversation Handling

```typescript
const input: ConversationLoopInput = {
  supabase,
  businessId,
  businessState,        // Phase 1 output
  executiveGuidance,    // Phase 2 output
  conversationObjective,// Phase 3 output
  founderResponse,      // User input
  previousProfile
};

const result = await processConversationLoop(input);

// Results contain:
result.extractionResult       // Phase 5: facts extracted
result.memoryPersisted        // Phase 6: saved to database
result.newBusinessState       // Phase 1: recalculated
result.newExecutiveGuidance   // Phase 2: reinterpreted
result.newConversationObjective // Phase 3: next question
```

### Database Flow

```
founder_response
    ↓
(Phase 5) Extract facts
    ↓
(Phase 6) Create memory_events
    ↓
(Phase 1) Read businesses, mission_leads, memory_events
    ↓
(Phase 1) Recalculate stage, readiness, priority
    ↓
(Phase 2) Generate guidance
    ↓
(Phase 3) Determine next question
    ↓
(Phase 4) Render to UI
```

## File Structure

### Workflow Brain (Core Logic)

```
lib/workflow/
├── types.ts                              # BusinessState interface
├── derive-business-state.ts              # Phase 1: stage, readiness, confidence
├── derive-executive-guidance.ts          # Phase 2: human interpretation
├── determine-next-conversation-objective.ts # Phase 3: next question
├── conversation-objective-types.ts       # ConversationObjective types
├── conversation-state-engine.ts          # Phase 5: extract facts
├── conversation-memory-workflow-loop.ts  # Orchestration (5+6)
├── build-business-state-from-db.ts       # Database reading
└── index.ts                              # Exports
```

### Memory System

```
lib/memory/
├── memory-types.ts                       # Type definitions
├── memory-engine.ts                      # Phase 6: learning extraction
├── memory-persistence.ts                 # Phase 6: database persistence
└── index.ts                              # Exports
```

### UI Layer

```
components/briefing-room/
├── ZeyaBriefingRoom.tsx                  # Phase 4: main component
└── lib/briefing-room/
    └── zeya-operating-view.ts            # Phase 4: orchestration view
```

## Key Design Decisions

### 1. Deterministic Pipeline

No AI/LLM in core business logic. Pure functions. Same input = same output.

**Why:** Debuggable, testable, predictable, auditable.

### 2. Separation of Concerns

- Phase 1: What stage are we in?
- Phase 2: What should we do?
- Phase 3: What should we talk about?
- Phase 4: How should we present it?
- Phase 5: What did the founder say?
- Phase 6: What did we learn?

**Why:** Each phase is testable independently. Easy to improve one without breaking others.

### 3. Conversation-First UI

Response input is the primary interaction. Metrics are secondary.

**Why:** Reflects that "the interaction is the product." User should feel like talking to an operator, not using software.

### 4. Memory as History

Memory records everything. Profile records current state. They're different.

**Why:** System can learn from patterns without polluting current truth. Can answer "how did we get here?" not just "where are we?"

### 5. No API Proliferation

No new API endpoints for memory queries, workflow state, etc. All logic is in-process.

**Why:** Faster, simpler, fewer moving parts. API layer only for data mutations (save call results, update profile).

## Workflow Stages (Phase 1)

```
ONBOARDING
    ↓ business description established
MISSION_DEFINITION
    ↓ mission objective defined
ICP_DEFINITION
    ↓ target customer profiled
LEAD_SOURCING
    ↓ prospects identified
LEAD_REVIEW
    ↓ prospects selected
CALL_PREPARATION
    ↓ caller briefed
SALES_EXECUTION
    ↓ calls scheduled
RESULT_REVIEW
    ↓ learnings captured
OPTIMIZATION
    ↓ system refined
SCALING
    ↓ ready to grow
```

Each stage has gate conditions (reads of profile fields).

## Readiness Scoring (Phase 1)

```
Business Fundamentals:    10 points
Mission Definition:       15 points
ICP Definition:           25 points (largest block)
Leads Identification:     15 points
Sales Motion:             10 points
Workforce Assigned:        8 points
Execution Ready:          12 points
Learning Recorded:         7 points
                         ─────────
Total:                   100 points
```

0-20 = Onboarding, 20-40 = Planning, 40-60 = Execution, 60-80 = Optimization, 80-100 = Scaling

## What Makes This "Voice-First"

**Not** about voice input/output (that's Phase 7+).

**About:**
1. Conversation-driven (not form-driven)
2. Natural progression (not dashboard navigation)
3. Operator feeling (not software feeling)
4. Response-focused (not metric-focused)

Voice will work naturally on top of this because the system thinks conversationally, not dashboardishly.

## Extensibility

### Adding a New Learning Pattern

In `memory-engine.ts`:

```typescript
const LEARNING_PATTERNS: LearningPattern[] = [
  // existing patterns...
  {
    pattern: "YOUR_NEW_PATTERN",
    category: "RELEVANT_CATEGORY",
    trigger: (events) => {
      // Return true if pattern detected
    },
    extract: (events) => ({
      pattern: "YOUR_NEW_PATTERN",
      description: "...",
      implication: "...",
      confidence: ...,
      relatedEvents: ...
    }),
    confidence: ...
  }
];
```

### Adding a New Conversation Objective

In `determine-next-conversation-objective.ts`:

```typescript
function deriveYourObjective(input: ConversationObjectiveInput): ConversationObjective {
  return {
    objectiveType: "YOUR_OBJECTIVE_TYPE",
    title: "...",
    primaryQuestion: "...",
    tone: "SUPPORTIVE" | "DIRECT" | "EXECUTIVE",
    // ... other fields
  };
}
```

### Adding a New Extraction Rule

In `conversation-state-engine.ts`:

```typescript
function extractFromYourContext(response: string): ExtractedFacts {
  // Pattern matching logic
  return {
    yourField: "extracted value"
  };
}

// Register in extractFacts():
case "YOUR_OBJECTIVE_TYPE":
  return extractFromYourContext(response);
```

## Testing Strategy

### Phase 1: Unit Test Each Stage Gate

```typescript
const state = deriveBusinessState(input);
expect(state.currentStage).toBe("MISSION_DEFINITION");
expect(state.blockingReason).toBe("mission not defined");
```

### Phase 5: Test Extraction Rules

```typescript
const result = processConversationResponse(
  { ...input, founderResponse: "We help restaurants..." },
  profile
);
expect(result.extractedFacts.businessDescription).toContain("restaurants");
expect(result.confidence).toBeGreaterThan(50);
```

### Phase 6: Test Learning Detection

```typescript
const learnings = deriveLearningEvents(events);
expect(learnings).toContainEqual(
  expect.objectContaining({
    pattern: "PRICING_OBJECTION_DETECTED"
  })
);
```

### Integration: Test Full Loop

```typescript
const result = await processConversationLoop({
  supabase,
  businessId: "test-123",
  businessState,
  executiveGuidance,
  conversationObjective,
  founderResponse: "We help restaurants...",
  previousProfile: {}
});

expect(result.newBusinessState.currentStage).not.toBe(businessState.currentStage);
expect(result.memoryPersisted).toBe(true);
```

## What's Complete

✅ Phase 1: Workflow Brain (deterministic stage logic)
✅ Phase 2: Executive Guidance (human interpretation)
✅ Phase 3: Conversation Objective (next question determination)
✅ Phase 4: Briefing Room UI (conversation-first interface)
✅ Phase 5: Conversation Extraction (fact extraction, no LLM)
✅ Phase 6: Persistent Memory (learning, knowledge synthesis)

## What's Next

❌ Phase 7: Voice Input → Transcription → Extraction
❌ Phase 8: Autonomous Call Coordinator
❌ Phase 9: Workforce Orchestration
❌ Phase 10: Learning Summaries & Growth Insights

## Build Status

✅ **TypeScript:** All phases pass type checking
✅ **Next.js:** Builds in ~5s
✅ **No errors, no warnings**
✅ **Ready for Phase 7 (voice)**

## Summary

Zeya is now a complete conversation-driven system:

1. **Phase 1** knows what stage you're in
2. **Phase 2** knows what to do
3. **Phase 3** knows what to ask
4. **Phase 4** knows how to present it
5. **Phase 5** understands what you said
6. **Phase 6** remembers what happened

**The next interaction will use all this context to ask the right question and move forward.**

No LLM. No dashboard. No magic. Just deterministic business logic with conversation as the interface.
