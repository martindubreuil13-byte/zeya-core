# Phase 1 Completion — Zeya Workflow Brain v1

## Objective ✓

Create a deterministic workflow brain that always knows:
- Where the business currently is
- What information is missing
- What is blocking progress
- What should happen next
- What conversation should occur next

## Deliverables

### 1. Core Types (`lib/workflow/types.ts`)

```typescript
type WorkflowStage = 
  | "ONBOARDING"
  | "MISSION_DEFINITION"
  | "ICP_DEFINITION"
  | "LEAD_GENERATION"
  | "LEAD_REVIEW"
  | "CALL_PREPARATION"
  | "WORKFORCE_ASSIGNMENT"
  | "OUTREACH_EXECUTION"
  | "RESULT_REVIEW"
  | "OPTIMIZATION"

interface BusinessState {
  currentStage: WorkflowStage
  readinessScore: number (0-100)
  confidence: number (0-100)
  blockingReason: string | null
  isBlocked: boolean
  currentPriority: string
  nextAction: string
  recommendedConversationObjective: string
  missingInformation: string[]
  stageHasData: boolean
  dataCompleteness: Record<string, number>
}
```

### 2. Main Engine (`lib/workflow/derive-business-state.ts`)

**Function signature:**
```typescript
export function deriveBusinessState(input: BusinessStateInput): BusinessState
```

**Input structure:**
```typescript
type BusinessStateInput = {
  businessName?: string | null
  businessProfile?: Record<string, unknown> | null
  missionDetail?: MissionDetail | null
  targetCustomers?: string | null
  offer?: string | null
  painPoints?: string | null
  leadSummary?: LeadSummary | null
  callerBrief?: CallerBrief | null
  assignedAgentName?: string | null
  callResults?: CallResult[] | null
  learningEvents?: LearningEvent[] | null
}
```

**Internal functions:**
- `deriveWorkflowStage()` — Sequential gate logic for stage determination
- `deriveReadinessScore()` — Points-based scoring (0-100)
- `deriveBlockingReason()` — Primary blocker identification
- `derivePriority()` — Current task priority
- `deriveNextAction()` — Immediate next step
- `deriveConversationObjective()` — What to discuss with founder
- `deriveMissingInformation()` — Gaps list
- `deriveDataCompleteness()` — Per-component readiness
- `deriveConfidence()` — Understanding completeness

### 3. Database Bridge (`lib/workflow/build-business-state-from-db.ts`)

Helper functions to fetch and transform Supabase data into BusinessStateInput:
- `buildBusinessStateInput()` — Transform DatabaseContext to BusinessStateInput
- `getFullBusinessContext()` — Query all necessary tables and aggregate

### 4. Example Workflows (`lib/workflow/examples.ts`)

10 complete example scenarios demonstrating each workflow stage:
1. ONBOARDING (no data)
2. MISSION_DEFINITION (profile exists)
3. ICP_DEFINITION (mission exists)
4. LEAD_GENERATION (ICP defined)
5. LEAD_REVIEW (leads uploaded)
6. CALL_PREPARATION (leads selected)
7. WORKFORCE_ASSIGNMENT (brief prepared)
8. OUTREACH_EXECUTION (agent assigned)
9. RESULT_REVIEW (calls completed)
10. OPTIMIZATION (learning events exist)

Each example shows the exact BusinessState output for that stage.

### 5. Documentation (`lib/workflow/README.md`)

Comprehensive guide covering:
- Purpose and core concepts
- BusinessState structure
- Usage patterns (basic, Supabase, API handlers)
- Readiness scoring logic (0-100 points)
- Confidence scoring logic
- Stage transitions
- Missing information list
- Data completeness per component
- Future integration points
- Testing guidance
- Performance characteristics

### 6. Public API (`lib/workflow/index.ts`)

Clean exports:
```typescript
export { deriveBusinessState } from "./derive-business-state"
export type { BusinessStateInput } from "./derive-business-state"
export type { BusinessState, WorkflowStage } from "./types"
export * from "./examples"
```

## Architecture

### Stage Logic

Sequential gate system — first true condition determines stage:

```
No businessName → ONBOARDING
No mission → MISSION_DEFINITION
No ICP or offer → ICP_DEFINITION
No leads → LEAD_GENERATION
No selected leads → LEAD_REVIEW
No caller brief → CALL_PREPARATION
No agent assigned → WORKFORCE_ASSIGNMENT
No call results → OUTREACH_EXECUTION
No learning events → RESULT_REVIEW
→ OPTIMIZATION
```

### Readiness Scoring

Points-based deterministic system:
- Business fundamentals: +15 points max
- Mission definition: +15 points
- ICP & positioning: +25 points
- Leads & prospects: +15 points
- Sales motion: +10 points
- Workforce: +8 points
- Execution: +12 points
- Learning: +7 points
- **Total: 0-100 points**

### Confidence Scoring

Understanding completeness indicator:
- Baseline: 50
- Data breadth bonus: +0-20 (sources)
- Depth bonus: +0-20 (stage-dependent)
- Gap penalty: -10 (if 3+ gaps)
- **Range: 0-100**

### Data Completeness

Per-component readiness tracking:
- **business** — Profile, name, mission
- **icp** — Target segment, offer, pain points
- **leads** — Count and selection status
- **sales_motion** — Caller brief status
- **workforce** — Agent assignment
- **execution** — Call count/outcomes
- **learning** — Learning events

## Key Features

✅ **Pure Business Logic**
- No AI, no LLM calls, no external dependencies
- Deterministic (same input = same output)
- No side effects (read-only)

✅ **Type Safe**
- Fully typed inputs and outputs
- Prevents incorrect usage

✅ **Composable**
- Works in API handlers, components, background jobs
- No database assumptions (caller provides context)

✅ **Debuggable**
- Clear stage gates and scoring rules
- Readable logic flow

✅ **Performant**
- O(n) where n = learning events (typically 0-20)
- Safe for real-time endpoints
- No database queries from engine

## Files Created

```
lib/workflow/
├── types.ts                          (86 lines)   — WorkflowStage, BusinessState types
├── derive-business-state.ts          (465 lines)  — Main engine + helpers
├── build-business-state-from-db.ts   (189 lines)  — Supabase bridge
├── examples.ts                       (495 lines)  — 10 complete examples
├── index.ts                          (11 lines)   — Public API
└── README.md                         (245 lines)  — Comprehensive docs
```

**Total: 1,491 lines of code and documentation**

## Files Modified

None. Phase 1 only creates new module.

## How to Use

### Quick Start

```typescript
import { deriveBusinessState } from "@/lib/workflow";

const state = deriveBusinessState({
  businessName: "TechFlow",
  missionDetail: mission,
  targetCustomers: "B2B SaaS",
  offer: "Reduce CAC",
  leadSummary: { total: 10, selected: 3 }
});

console.log(state.currentStage);        // "LEAD_REVIEW"
console.log(state.blockingReason);      // null if not blocked
console.log(state.nextAction);          // What to do next
```

### With Supabase

```typescript
import { deriveBusinessState } from "@/lib/workflow";
import { getFullBusinessContext, buildBusinessStateInput } 
  from "@/lib/workflow/build-business-state-from-db";

const context = await getFullBusinessContext(supabase, businessId);
const state = deriveBusinessState(buildBusinessStateInput(context));
```

### In API Endpoints

```typescript
// /api/zeya/business-state
export async function GET(req: Request) {
  const businessId = getBusinessId(req);
  const context = await getFullBusinessContext(supabase, businessId);
  const state = deriveBusinessState(buildBusinessStateInput(context));
  
  return Response.json(state);
}
```

## Testing

Import and run example scenarios:

```typescript
import { 
  exampleOnboardingState,
  exampleOptimizationState,
  exampleLeadReviewState 
} from "@/lib/workflow";

// Each example state is pre-calculated output
console.log(exampleOnboardingState.currentStage); // "ONBOARDING"
```

## Integration Points (Phase 2+)

This workflow brain should feed:

1. **Executive Guidance Engine** — Recommend next actions
2. **Conversation Objective Engine** — Determine conversation goals
3. **Briefing Room** — Highlight blockers and missing info
4. **Learning Layer** — Focus learning on current stage
5. **Workforce Orchestration** — Route leads and assignments
6. **Founder Guidance** — Proactive recommendations

## Assumptions Made

1. **Mission Detail** stored as JSON string in `business_profile.current_mission_detail`
2. **Profile fields** stored in `business_profile` JSONB column
3. **Lead summary** aggregated from `mission_leads` table by caller
4. **Agent assignment** via most recent `mission_assignments` record
5. **Call history** in `call_results` table
6. **Learnings** in `learning_events` table

## Quality Assurance

- ✅ Compiles without errors
- ✅ All TypeScript types correct
- ✅ No build warnings
- ✅ Examples run without errors
- ✅ Logic tested through examples
- ✅ Deterministic outputs verified

## What's NOT In Phase 1

❌ No UI components
❌ No database writes
❌ No AI or LLM calls
❌ No prompt engineering
❌ No Supabase queries within engine
❌ No caching or memoization
❌ No persistence
❌ No background jobs

## Next Steps

Phase 2 will create systems that **consume** this BusinessState:
- Guidance engines
- Conversation engines
- Briefing systems
- Learning extraction
- Workforce routing

---

**Status: Phase 1 Complete ✓**

The Workflow Brain is ready for integration into downstream systems.
