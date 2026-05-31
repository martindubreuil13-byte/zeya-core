# Phase 3 Completion — Zeya Conversation Objective Engine

**Date:** 2026-05-31  
**Status:** ✅ **Complete and building successfully**

## Objective ✓

Build the Conversation Objective Engine that determines what Zeya should talk about next based on BusinessState and ExecutiveGuidance.

- Phase 1 answers: "Where are we?" → BusinessState
- Phase 2 answers: "What should we do?" → ExecutiveGuidance
- Phase 3 answers: "What should Zeya talk about?" → ConversationObjective

## Core Design

**Architectural Constraint:** Conversation Objective consumes ONLY BusinessState and ExecutiveGuidance.

It does NOT access:
- businessProfile
- mission
- leads
- callerBrief
- assignments
- callResults
- learningEvents

**Why:** Clean separation of concerns. No duplication of workflow logic.

## Deliverables

### 1. ConversationObjectiveType Union

```typescript
type ConversationObjectiveType =
  | "COLLECT_BUSINESS_CONTEXT"   // ONBOARDING
  | "DEFINE_MISSION"              // MISSION_DEFINITION
  | "DEFINE_ICP"                  // ICP_DEFINITION
  | "REQUEST_LEADS"               // LEAD_GENERATION
  | "REVIEW_LEADS"                // LEAD_REVIEW
  | "PREPARE_CALLER_BRIEF"        // CALL_PREPARATION
  | "ASSIGN_WORKFORCE"            // WORKFORCE_ASSIGNMENT
  | "REQUEST_CALL_RESULTS"        // OUTREACH_EXECUTION
  | "REVIEW_RESULTS"              // RESULT_REVIEW
  | "OPTIMIZE_WORKFLOW"           // OPTIMIZATION
```

### 2. ConversationObjective Type

```typescript
interface ConversationObjective {
  objectiveType: ConversationObjectiveType
  title: string                        // Conversation title
  openingLine: string                  // How to open
  primaryQuestion: string | null       // One key question
  tone: "DIRECT" | "SUPPORTIVE" | "EXECUTIVE"
  informationNeeded: string[]          // What's needed
  expectedFounderResponse: string      // What answer looks like
  completionCriteria: string           // What success looks like
  followUpAction: string               // What's next
  urgency: "LOW" | "MEDIUM" | "HIGH"  // From ExecutiveGuidance
}
```

### 3. Main Engine Function

```typescript
export function determineNextConversationObjective(
  input: ConversationObjectiveInput
): ConversationObjective
```

Pure function that:
- Takes BusinessState and ExecutiveGuidance
- Dispatches to stage-specific builder
- Returns complete ConversationObjective
- Deterministic (same input → same output)

### 4. Stage-Specific Objective Builders

10 deterministic builders, one for each workflow stage:

```
deriveOnboardingObjective()
deriveMissionDefinitionObjective()
deriveICPDefinitionObjective()
deriveLeadGenerationObjective()
deriveLeadReviewObjective()
deriveCallPreparationObjective()
deriveWorkforceAssignmentObjective()
deriveOutreachExecutionObjective()
deriveResultReviewObjective()
deriveOptimizationObjective()
```

Each returns complete ConversationObjective with stage-appropriate messaging.

### 5. Tone Derivation

Deterministic tone calculation:

- **SUPPORTIVE:** ONBOARDING only (relationship building)
- **DIRECT:** Blocked stages (MISSION, ICP, REVIEW, BRIEF, ASSIGNMENT)
- **EXECUTIVE:** Execution stages (GENERATION, OUTREACH, RESULTS, OPTIMIZATION)

Not based on emotion. Pure stage-based logic.

### 6. Example Outputs

10 complete examples showing ConversationObjective for each stage:

- objectiveOnboarding → COLLECT_BUSINESS_CONTEXT
- objectiveMissionDefinition → DEFINE_MISSION
- objectiveICPDefinition → DEFINE_ICP
- objectiveLeadGeneration → REQUEST_LEADS
- objectiveLeadReview → REVIEW_LEADS
- objectiveCallPreparation → PREPARE_CALLER_BRIEF
- objectiveWorkforceAssignment → ASSIGN_WORKFORCE
- objectiveOutreachExecution → REQUEST_CALL_RESULTS
- objectiveResultReview → REVIEW_RESULTS
- objectiveOptimization → OPTIMIZE_WORKFLOW

### 7. Documentation

Comprehensive guide covering:
- Architecture and design principles
- Field meanings and examples
- Usage patterns
- Tone derivation
- Integration points
- Testing guidance

## Files Created

```
lib/workflow/
├── conversation-objective-types.ts       (35 lines)   ConversationObjective + Type
├── determine-next-conversation-objective.ts (408 lines) Engine + 10 builders
├── conversation-objective-examples.ts    (215 lines)  10 complete examples
└── CONVERSATION_OBJECTIVE.md             (380 lines)  User guide
```

**Total: ~1,038 lines**

## Files Modified

```
lib/workflow/index.ts                     Updated exports for Phase 3
```

## Architecture Chain

Complete orchestration pipeline:

```
Raw Data
    ↓
getFullBusinessContext() [async database layer]
    ↓
buildBusinessStateInput() [pure transformation]
    ↓
deriveBusinessState() [Phase 1: Reality]
    ↓
deriveExecutiveGuidance() [Phase 2: Interpretation]
    ↓
determineNextConversationObjective() [Phase 3: Dialogue Focus]
    ↓
[Conversation Engine, UI, Voice System, Notifications]
```

## Example Output

**Stage:** LEAD_REVIEW  
**State:** 12 leads uploaded, 0 selected  
**Guidance:** Select priority prospects

**Conversation Objective returned:**

```json
{
  "objectiveType": "REVIEW_LEADS",
  "title": "Select priority prospects",
  "openingLine": "We have prospects ready, but outreach should not start until the best prospects are selected.",
  "primaryQuestion": "Which prospects should we prioritize first?",
  "tone": "DIRECT",
  "informationNeeded": ["selected_leads", "lead_priority"],
  "expectedFounderResponse": "The founder reviews prospects and selects 3-5 of the strongest matches for the target profile.",
  "completionCriteria": "At least 3 selected leads are saved (or all available if fewer than 3).",
  "followUpAction": "Prepare caller brief.",
  "urgency": "MEDIUM"
}
```

**What this enables:**
- Conversation system knows what to discuss
- Knows how to open the conversation
- Knows the one key question to ask
- Knows what a good answer looks like
- Knows when the conversation is complete

## Key Characteristics

✅ **Pure function** — No side effects, no database access  
✅ **Deterministic** — Same input always produces same objective  
✅ **No duplication** — Consumes only BusinessState and ExecutiveGuidance  
✅ **Stage-driven** — Objective depends entirely on currentStage  
✅ **Actionable** — Every field guides a specific action  
✅ **Single question** — Focused on the most important ask  
✅ **Tone-aware** — Matches stage and urgency  
✅ **No AI/LLM** — Purely rule-based business logic  

## Quality Verification

- ✅ TypeScript compilation passes
- ✅ Project builds successfully  
- ✅ All 10 stages have examples
- ✅ No breaking changes to Phase 1 or 2
- ✅ Follows architectural constraint (BusinessState + ExecutiveGuidance only)
- ✅ Deterministic outputs verified

## Not a Chat Engine

**Conversation Objective Engine does NOT:**
- Generate dialogue
- Build conversation flows
- Create LLM prompts
- Handle back-and-forth exchanges
- Manage conversation history

**It DOES:**
- Determine what should be discussed
- Suggest how to open the conversation
- Identify the key question to ask
- Define what completion looks like
- Set the appropriate tone

## What This Enables

With Conversation Objective:

1. **Briefing Room UI** — Display "What to discuss next" with opening line
2. **Conversation System** — Know what to talk about before generating dialogue
3. **Voice Agent** — Have clear objective before speaking
4. **Notifications** — Alert founder with specific conversation focus
5. **Workflow Orchestration** — Route objectives to conversation systems

## Usage Example

```typescript
import { 
  deriveBusinessState, 
  deriveExecutiveGuidance,
  determineNextConversationObjective,
  buildBusinessStateInput,
  getFullBusinessContext
} from "@/lib/workflow"

// Get data
const context = await getFullBusinessContext(supabase, businessId)

// Phase 1: Reality
const state = deriveBusinessState(buildBusinessStateInput(context))

// Phase 2: Interpretation
const guidance = deriveExecutiveGuidance(state)

// Phase 3: Dialogue Planning
const objective = determineNextConversationObjective({
  businessState: state,
  executiveGuidance: guidance
})

// Use in conversation system
return {
  what_stage: state.currentStage,
  what_to_do: guidance.objective,
  what_to_talk_about: objective.title,
  how_to_open: objective.openingLine,
  key_question: objective.primaryQuestion,
  tone_to_use: objective.tone,
  when_done: objective.completionCriteria
}
```

## Assumptions Made

1. **Tone is stage-based** — Not emotional, deterministic from stage
2. **One question per stage** — Focus on the most useful question
3. **Urgency inherited** — Comes from ExecutiveGuidance unless overridden
4. **Sequential progression** — Follows 10-stage workflow from Phase 1
5. **All guidance predetermined** — No AI generation, pure business rules

## No Breaking Changes

- Phase 1 (Workflow Brain) remains untouched
- Phase 2 (Executive Guidance) remains untouched
- New module doesn't modify existing systems
- All type exports added cleanly
- Backward compatible

## Deliverables Summary

| Deliverable | Status | Notes |
|-------------|--------|-------|
| ConversationObjectiveType | ✅ Complete | 10-value union type |
| ConversationObjective type | ✅ Complete | 9 fields, fully typed |
| determineNextConversationObjective() | ✅ Complete | Pure function, deterministic |
| 10 objective builders | ✅ Complete | One for each stage |
| Tone derivation logic | ✅ Complete | SUPPORTIVE/DIRECT/EXECUTIVE |
| Example outputs | ✅ Complete | All 10 stages documented |
| Documentation | ✅ Complete | CONVERSATION_OBJECTIVE.md |
| Build verification | ✅ Passing | TypeScript and Next.js build |

---

## Architecture Completeness

The Zeya Orchestration Stack is now complete with three layers:

1. **Phase 1: Workflow Brain** — Determines reality (currentStage, readiness, blockers)
2. **Phase 2: Executive Guidance** — Interprets guidance (objective, request, urgency)
3. **Phase 3: Conversation Objective** — Plans dialogue (what to discuss, how to ask, tone)

These three layers form the foundation for all downstream systems:
- Conversation engines
- Voice systems
- Briefing room UI
- Notifications
- Workflow orchestration

**Phase 3 is complete and ready for Phase 4+ systems.**

The Conversation Objective Engine provides deterministic dialogue planning for any system that consumes it.
