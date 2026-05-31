# Phase 2 Completion — Zeya Executive Guidance Engine

**Date:** 2026-05-31  
**Status:** ✅ **Complete and building successfully**

## Objective ✓

Build the Executive Guidance Engine that interprets BusinessState into executive-level direction.

- Phase 1 answers: "Where are we?"
- Phase 2 answers: "What should we do about it?"

## Core Design

**Architectural Constraint:** Executive Guidance consumes ONLY BusinessState.

It does NOT access:
- businessProfile
- mission
- leads
- callerBrief
- assignments
- callResults
- learningEvents

**Why:** Workflow Brain owns reality. Executive Guidance owns interpretation. No duplication of logic.

## Deliverables

### 1. ExecutiveGuidance Type (`derive-executive-guidance.ts`)

```typescript
interface ExecutiveGuidance {
  summary: string                      // Situation explanation
  objective: string                    // What we're trying to accomplish
  rationale: string                    // Why it matters
  founderRequest: string | null        // What we need from founder
  founderQuestion: string | null       // Single best question to ask
  workforceDirection: string | null    // What workforce should do
  urgency: "LOW" | "MEDIUM" | "HIGH"  // Based on stage
  successDefinition: string            // What success looks like
  nextMilestone: string                // What comes next
}
```

### 2. Main Engine Function

```typescript
export function deriveExecutiveGuidance(state: BusinessState): ExecutiveGuidance
```

Pure function that:
- Takes BusinessState as input
- Dispatches to stage-specific guidance builder
- Returns complete ExecutiveGuidance object
- Deterministic (same input → same output)

### 3. Stage-Specific Guidance Builders

10 deterministic builders, one for each workflow stage:

```
deriveOnboardingGuidance()
deriveMissionDefinitionGuidance()
deriveICPDefinitionGuidance()
deriveLeadGenerationGuidance()
deriveLeadReviewGuidance()
deriveCallPreparationGuidance()
deriveWorkforceAssignmentGuidance()
deriveOutreachExecutionGuidance()
deriveResultReviewGuidance()
deriveOptimizationGuidance()
```

Each returns complete ExecutiveGuidance with stage-appropriate messaging.

### 4. Urgency Derivation

Deterministic urgency calculation:

- **HIGH:** ONBOARDING, MISSION_DEFINITION, ICP_DEFINITION (blocking all downstream)
- **MEDIUM:** LEAD_GENERATION, LEAD_REVIEW, CALL_PREPARATION, WORKFORCE_ASSIGNMENT, OUTREACH_EXECUTION (in-flight work)
- **LOW:** RESULT_REVIEW, OPTIMIZATION (analysis and iteration)

Not based on emotion or assumptions. Pure stage-based logic.

### 5. Example Outputs (`executive-guidance-examples.ts`)

10 complete examples showing ExecutiveGuidance for each stage:

- stateOnboarding → guidanceOnboarding
- stateMissionDefinition → guidanceMissionDefinition
- stateICPDefinition → guidanceICPDefinition
- stateLeadGeneration → guidanceLeadGeneration
- stateLeadReview → guidanceLeadReview
- stateCallPreparation → guidanceCallPreparation
- stateWorkforceAssignment → guidanceWorkforceAssignment
- stateOutreachExecution → guidanceOutreachExecution
- stateResultReview → guidanceResultReview
- stateOptimization → guidanceOptimization

### 6. Documentation (`EXECUTIVE_GUIDANCE.md`)

Comprehensive guide covering:
- Architecture and design principles
- Field meanings and examples
- Usage patterns
- Integration points
- Testing guidance
- Tone and language guidelines

## Files Created

```
lib/workflow/
├── derive-executive-guidance.ts        (263 lines)  Engine + stage builders
├── executive-guidance-examples.ts      (387 lines)  10 complete examples
└── EXECUTIVE_GUIDANCE.md               (280 lines)  User guide
```

**Total: ~930 lines**

## Files Modified

```
lib/workflow/
└── index.ts                             Updated exports for Phase 2
```

## Architecture Summary

### Input → Output

```
BusinessState (from Phase 1)
    ↓
deriveExecutiveGuidance()
    ↓
ExecutiveGuidance
    ↓
[UI, Conversation Engine, Founder Notifications]
```

### Stage Dispatch Pattern

```typescript
function deriveGuidanceByStage(state: BusinessState): ExecutiveGuidance {
  const stageGuidance: Record<WorkflowStage, (s: BusinessState) => ExecutiveGuidance> = {
    ONBOARDING: deriveOnboardingGuidance,
    MISSION_DEFINITION: deriveMissionDefinitionGuidance,
    // ... 8 more stages
  }
  
  const guidanceBuilder = stageGuidance[state.currentStage]
  return guidanceBuilder(state)
}
```

Each stage builder returns predetermined guidance based on business rules, not AI.

## Example Output

**Stage:** LEAD_REVIEW  
**State:** 12 leads uploaded, 0 selected

**Guidance returned:**

```json
{
  "summary": "Multiple prospects uploaded but not yet reviewed. Selection pending.",
  "objective": "Select priority prospects for outreach.",
  "rationale": "Not all leads are equal. Selecting the best fit improves conversion and accelerates momentum.",
  "founderRequest": "Review and select priority prospects.",
  "founderQuestion": "Which prospects are your strongest matches for this mission?",
  "workforceDirection": null,
  "urgency": "MEDIUM",
  "successDefinition": "At least 3-5 prospects marked as selected and ready for outreach.",
  "nextMilestone": "Caller brief preparation"
}
```

## Key Characteristics

✅ **Pure function** — No side effects, no database access  
✅ **Deterministic** — Same BusinessState always produces same guidance  
✅ **Stage-driven** — Guidance depends entirely on currentStage  
✅ **No duplication** — Consumes only BusinessState, doesn't re-evaluate workflow  
✅ **Actionable** — Every field guides a specific decision  
✅ **Owner-aware** — Distinguishes founder vs workforce requests  
✅ **Milestone-focused** — Always identifies next objective  
✅ **No AI/LLM** — Purely deterministic business logic  

## Quality Verification

- ✅ TypeScript compilation passes
- ✅ Project builds successfully  
- ✅ All 10 stages have examples
- ✅ No breaking changes to Phase 1
- ✅ Follows architectural constraint (BusinessState only)
- ✅ Deterministic outputs verified

## Integration Ready

Executive Guidance is ready for Phase 3 consumers:

1. **Briefing Room UI** — Display summary, objective, urgency
2. **Conversation Objective Engine** — Use founderQuestion and founderRequest
3. **API responses** — Include guidance in workflow status endpoints
4. **Founder notifications** — Alert with urgency and milestone
5. **Workforce dashboards** — Show workforceDirection to agents

## Usage Example

```typescript
import { 
  deriveBusinessState, 
  deriveExecutiveGuidance,
  buildBusinessStateInput,
  getFullBusinessContext
} from "@/lib/workflow"

// Get business context from database
const context = await getFullBusinessContext(supabase, businessId)

// Build input for workflow brain
const input = buildBusinessStateInput(context)

// Get business state (Phase 1)
const state = deriveBusinessState(input)

// Get executive guidance (Phase 2)
const guidance = deriveExecutiveGuidance(state)

// Use guidance in API or UI
return {
  currentStage: state.currentStage,
  guidance: guidance,
  readiness: state.readinessScore,
  blocker: state.blockingReason
}
```

## Assumptions Made

1. **Urgency is stage-based** — Not emotional, deterministic from stage
2. **All guidance is predetermined** — No AI generation, no evaluation
3. **One question per stage** — Focus on the most useful question
4. **Same founder request pattern throughout** — Consistent language and tone
5. **Next milestone is always the next stage** — Sequential progression assumed

## No Breaking Changes

- Phase 1 (Workflow Brain) remains untouched
- New module doesn't modify existing systems
- All type exports added cleanly
- Backward compatible

## Next Steps

Phase 3 will consume ExecutiveGuidance:
- Conversation Objective Engine (derive dialog from guidance)
- Briefing Room integration (display guidance visually)
- Founder notifications (surface urgency and next steps)
- Workflow orchestration (route guidance to systems)

## Deliverables Summary

| Deliverable | Status | Notes |
|-------------|--------|-------|
| ExecutiveGuidance type | ✅ Complete | 8 fields, fully typed |
| deriveExecutiveGuidance() | ✅ Complete | Pure function, deterministic |
| 10 stage builders | ✅ Complete | One for each workflow stage |
| Example outputs | ✅ Complete | All 10 stages documented |
| Documentation | ✅ Complete | EXECUTIVE_GUIDANCE.md |
| Build verification | ✅ Passing | TypeScript and Next.js build |

---

**Phase 2 is complete and ready for Phase 3.**

The Executive Guidance Engine transforms BusinessState into actionable direction.
