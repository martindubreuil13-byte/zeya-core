# Zeya Workflow Brain v1

Deterministic business state derivation engine. Single source of truth for workflow progression.

## Purpose

The Workflow Brain answers:

- **Where is the business currently?** → `currentStage`
- **How ready are we?** → `readinessScore`, `confidence`
- **What's blocking progress?** → `blockingReason`, `isBlocked`
- **What should happen next?** → `nextAction`, `currentPriority`, `recommendedConversationObjective`
- **What's missing?** → `missingInformation`, `dataCompleteness`

## Core Concepts

### WorkflowStage

Sequential gates representing the business's current position:

1. **ONBOARDING** — Business profile not started
2. **MISSION_DEFINITION** — No mission defined
3. **ICP_DEFINITION** — ICP or offer not defined
4. **LEAD_GENERATION** — No leads uploaded
5. **LEAD_REVIEW** — Leads uploaded but none selected
6. **CALL_PREPARATION** — Leads selected, preparing brief
7. **WORKFORCE_ASSIGNMENT** — Brief ready, assigning agent
8. **OUTREACH_EXECUTION** — Agent assigned, calls in progress
9. **RESULT_REVIEW** — Calls completed, reviewing results
10. **OPTIMIZATION** — Learning events derived, planning iteration

### BusinessState

Output object containing:

```typescript
{
  // Positioning
  currentStage: WorkflowStage
  readinessScore: 0-100        // Deterministic from data completeness
  confidence: 0-100             // How complete is our understanding?

  // Blockers
  blockingReason: string | null // Primary blocker (null if unblocked)
  isBlocked: boolean

  // Guidance
  currentPriority: string       // Most important task
  nextAction: string            // Immediate next step
  recommendedConversationObjective: string

  // Diagnostics
  missingInformation: string[]  // Machine-readable gaps
  stageHasData: boolean
  dataCompleteness: {           // Per-component readiness
    business: 0-100
    icp: 0-100
    leads: 0-100
    sales_motion: 0-100
    workforce: 0-100
    execution: 0-100
    learning: 0-100
  }
}
```

## Usage

### Basic Usage

```typescript
import { deriveBusinessState } from "@/lib/workflow";

const state = deriveBusinessState({
  businessName: "TechFlow",
  missionDetail: { ... },
  targetCustomers: "B2B SaaS",
  offer: "Reduce CAC",
  leadSummary: { total: 10, selected: 3 },
  // ... other fields
});

if (state.isBlocked) {
  console.log(`Blocked: ${state.blockingReason}`);
  console.log(`Next step: ${state.nextAction}`);
} else {
  console.log(`Current stage: ${state.currentStage}`);
}
```

### With Supabase

```typescript
import { deriveBusinessState } from "@/lib/workflow";
import { getFullBusinessContext } from "@/lib/workflow/build-business-state-from-db";

const context = await getFullBusinessContext(supabase, businessId);
const input = buildBusinessStateInput(context);
const state = deriveBusinessState(input);
```

### In API Handlers

```typescript
export async function GET(req: Request) {
  const businessId = getBusinessId(req);
  const context = await getFullBusinessContext(supabase, businessId);
  const state = deriveBusinessState(buildBusinessStateInput(context));

  return Response.json({ state, readinessPercent: state.readinessScore });
}
```

## Readiness Score Logic

Deterministic points-based system:

- Business name present: +10
- Business profile exists: +5
- Mission defined: +15
- Target customers defined: +10
- Offer defined: +10
- Pain points defined: +5
- 5+ leads uploaded: +10 (partial: +5)
- 3+ leads selected: +8 (partial: +4)
- Caller brief prepared: +10
- Agent assigned: +8
- 3+ calls completed: +12 (partial: +6)
- 3+ learning events: +7 (partial: +3)

**Maximum: 100**

## Confidence Score Logic

Confidence reflects understanding completeness:

- Baseline: 50
- Data breadth bonus: +0-20 (points for each data source)
- Depth bonus (stage-dependent): +0-20
- Gap penalty: -10 (if 3+ gaps exist)

**Range: 0-100**

High confidence signals:
- Multiple data sources aligned
- Few or no gaps in critical fields
- Call results or learning events exist

Low confidence signals:
- Sparse data
- Large gaps
- Early-stage (ONBOARDING, MISSION_DEFINITION)

## Stage Transitions

Stages advance sequentially. Regression is possible (e.g., if leads are deleted).

### Typical Happy Path

```
ONBOARDING
  ↓ (add business name)
MISSION_DEFINITION
  ↓ (define mission)
ICP_DEFINITION
  ↓ (define ICP & offer)
LEAD_GENERATION
  ↓ (upload leads)
LEAD_REVIEW
  ↓ (select leads)
CALL_PREPARATION
  ↓ (generate brief)
WORKFORCE_ASSIGNMENT
  ↓ (assign agent)
OUTREACH_EXECUTION
  ↓ (complete calls)
RESULT_REVIEW
  ↓ (extract learnings)
OPTIMIZATION
```

## Missing Information

Machine-readable list of gaps blocking progression:

```typescript
[
  "business_name",
  "mission",
  "target_customers",
  "offer",
  "pain_points",
  "leads",
  "selected_leads",
  "caller_brief",
  "assigned_agent",
  "call_results",
]
```

Used by downstream systems to:
- Guide conversation objectives
- Prioritize data collection
- Alert users to blockers
- Plan next session agenda

## Data Completeness

Per-component readiness scores (0-100):

- **business**: Profile, name, mission definition
- **icp**: Target segment, offer, pain points
- **leads**: Count and selection status
- **sales_motion**: Caller brief readiness
- **workforce**: Agent assignment status
- **execution**: Call count and outcomes
- **learning**: Learning event count and confidence

Use these to display progress bars, identify weak areas, or guide subsequent features (e.g., "Leads 40% ready").

## Future Integration Points

These systems will consume BusinessState:

1. **Executive Guidance Engine** — Recommend actions based on current stage
2. **Conversation Objective Engine** — Determine what to discuss next
3. **Briefing Room** — Highlight missing information and priorities
4. **Learning Layer** — Focus learning extraction on current mission stage
5. **Workforce Orchestration** — Route leads based on assignment status
6. **Founder Guidance** — Proactive recommendations for progression

## Example Outputs

See `examples.ts` for 10 complete example workflows showing:

1. Fresh onboarding (no data)
2. Mission definition stage
3. ICP definition stage
4. Lead generation stage
5. Lead review stage
6. Call preparation stage
7. Workforce assignment stage
8. Outreach execution stage
9. Result review stage
10. Optimization stage

## Testing

```bash
# Import and run examples to verify logic
import { exampleOnboardingState, exampleOptimizationState } from "@/lib/workflow";

console.log(exampleOnboardingState);
// {
//   currentStage: "ONBOARDING",
//   readinessScore: 0,
//   ...
// }
```

## Architecture Notes

- **Pure business logic** — No AI, no LLM calls, no external dependencies
- **Deterministic** — Same input always produces same output
- **No side effects** — Read-only, no database writes
- **Type-safe** — Fully typed inputs and outputs
- **Composable** — Can be used in API handlers, components, background jobs
- **Debuggable** — Clear stage gates and scoring rules

## Performance

- Single-pass evaluation
- No database queries (caller provides context)
- O(n) where n = number of learning events (typically 0-20)
- Safe for real-time endpoints
