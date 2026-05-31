# Zeya Executive Guidance Engine v1

Interprets BusinessState into executive-level direction and strategy.

## Architecture

**Phase 1 answers:** "Where are we?"  
**Phase 2 answers:** "What should we do about it?"

Executive Guidance Engine consumes BusinessState and transforms it into actionable direction.

## Core Concept

BusinessState describes reality (current stage, readiness, blockers, missing info).

ExecutiveGuidance interprets that reality into strategy (objective, founder request, workforce direction, urgency, success definition).

### Architectural Constraint

Executive Guidance **must consume ONLY BusinessState.**

It must NOT access:
- businessProfile
- mission
- leads
- leadSummary
- callerBrief
- assignments
- callResults
- learningEvents

**Why:** The Workflow Brain owns reality. Executive Guidance owns interpretation. No duplication of business logic.

## ExecutiveGuidance Type

```typescript
interface ExecutiveGuidance {
  // Context
  summary: string              // Short explanation of situation
  objective: string             // What we're trying to accomplish
  rationale: string             // Why it matters

  // Requests
  founderRequest: string | null // What we need from founder
  founderQuestion: string | null // Single best question to ask

  // Operations
  workforceDirection: string | null // What workforce should do

  // Metrics
  urgency: "LOW" | "MEDIUM" | "HIGH"  // Based on stage and blockers
  successDefinition: string    // What success looks like
  nextMilestone: string        // What comes after success
}
```

## Field Meanings

### summary
Short, direct explanation of current situation.

Examples:
- "No business profile exists. Starting from zero."
- "Prospects have been generated but not yet reviewed."
- "Calls completed. Results ready for analysis."

### objective
What Zeya is trying to accomplish **right now**.

Examples:
- "Establish business context and foundation."
- "Select priority prospects for outreach."
- "Execute outreach to prospects. Gather call outcomes."

### rationale
Why this objective matters to business progression.

Examples:
- "All downstream workflow depends on basic business understanding."
- "Not all leads are equal. Selecting the best fit improves conversion."
- "Execution is where theory meets reality. Outcomes provide feedback."

### founderRequest
What Zeya needs from the founder to progress.

Examples:
- "Provide basic business information."
- "Review and select priority prospects."
- "Monitor progress and provide course corrections."

**Can be null** if stage requires no founder input (e.g., active execution).

### founderQuestion
Single most useful question to ask the founder.

**Must be:**
- One question only
- Short and direct
- Simple English
- Global audience friendly
- Actionable

Examples:
- "What does your business do, and who do you help?"
- "Which prospects are your strongest matches for this mission?"
- "What surprised you? What pattern did you notice in the responses?"

**Can be null** if stage has no clear question.

### workforceDirection
What Zeya's workforce should be doing right now.

Examples:
- "No workforce assignment required."
- "Prepare outreach materials and messaging guidelines."
- "Execute approved outreach sequence. Log outcomes for each call."
- "Document and archive all learnings from this mission."

**Can be null** if stage has no workforce assignment.

### urgency
One of: `"LOW"`, `"MEDIUM"`, `"HIGH"`

Based on:
- Early stages (ONBOARDING, MISSION, ICP) = HIGH (blocking all downstream)
- Middle stages (LEADS, BRIEF, ASSIGNMENT, EXECUTION) = MEDIUM (in-flight work)
- Late stages (REVIEW, OPTIMIZATION) = LOW (analysis and iteration)

NOT based on emotion or assumptions. Deterministic from stage.

### successDefinition
What must happen to complete the current objective.

Examples:
- "Business profile completed with name, offer, and target customer."
- "At least 3-5 prospects marked as selected and ready for outreach."
- "At least 3-5 calls completed with outcomes logged."

### nextMilestone
What comes after success (next stage).

Examples:
- "Mission definition"
- "Lead generation"
- "Caller brief preparation"
- "Outreach execution"

## Usage

### Basic Usage

```typescript
import { deriveBusinessState, deriveExecutiveGuidance } from "@/lib/workflow"

const state = deriveBusinessState({
  businessName: "TechFlow",
  missionDetail: mission,
  // ... other inputs
})

const guidance = deriveExecutiveGuidance(state)

console.log(guidance.summary)        // What's happening
console.log(guidance.objective)      // What we're doing
console.log(guidance.founderRequest) // What we need
console.log(guidance.urgency)        // How important
```

### In API Handler

```typescript
export async function GET(req: Request) {
  const state = deriveBusinessState(...)
  const guidance = deriveExecutiveGuidance(state)
  
  return Response.json({
    stage: state.currentStage,
    guidance: guidance,
    blocker: state.blockingReason,
    readiness: state.readinessScore
  })
}
```

### With Supabase Integration

```typescript
import { 
  deriveBusinessState, 
  deriveExecutiveGuidance,
  buildBusinessStateInput,
  getFullBusinessContext
} from "@/lib/workflow"

const context = await getFullBusinessContext(supabase, businessId)
const state = deriveBusinessState(buildBusinessStateInput(context))
const guidance = deriveExecutiveGuidance(state)
```

## Stage Mapping

Executive Guidance provides deterministic output for all 10 workflow stages:

| Stage | Urgency | Owner | Next |
|-------|---------|-------|------|
| ONBOARDING | HIGH | Founder | Mission |
| MISSION_DEFINITION | HIGH | Founder | ICP |
| ICP_DEFINITION | HIGH | Founder | Leads |
| LEAD_GENERATION | MEDIUM | Founder | Review |
| LEAD_REVIEW | MEDIUM | Founder | Brief |
| CALL_PREPARATION | MEDIUM | Founder+Workforce | Assignment |
| WORKFORCE_ASSIGNMENT | MEDIUM | Founder | Execution |
| OUTREACH_EXECUTION | MEDIUM | Workforce | Review |
| RESULT_REVIEW | MEDIUM | Founder+Workforce | Optimization |
| OPTIMIZATION | LOW | Founder | Next Mission |

## Examples

See `executive-guidance-examples.ts` for complete outputs for all 10 stages.

Example LEAD_REVIEW guidance:

```typescript
{
  summary: "Multiple prospects uploaded but not yet reviewed. Selection pending.",
  objective: "Select priority prospects for outreach.",
  rationale: "Not all leads are equal. Selecting the best fit improves conversion and accelerates momentum.",
  founderRequest: "Review and select priority prospects.",
  founderQuestion: "Which prospects are your strongest matches for this mission?",
  workforceDirection: null,
  urgency: "MEDIUM",
  successDefinition: "At least 3-5 prospects marked as selected and ready for outreach.",
  nextMilestone: "Caller brief preparation",
}
```

## Tone and Language

This engine generates **executive reasoning**, not chatbot copy.

Should sound like:
- A Sales Development Executive
- Direct and practical
- Short sentences
- Global English
- Easy to understand

Should NOT sound like:
- A chatbot assistant
- Marketing language
- AI speak ("I'd be happy to help!")
- Jargon
- Consultant-speak

## Design Principles

1. **Deterministic** — Same BusinessState always produces same ExecutiveGuidance
2. **Pure function** — No side effects, no database access, no API calls
3. **No duplication** — Only interprets BusinessState, doesn't re-evaluate workflow
4. **Stage-driven** — Guidance depends entirely on currentStage
5. **Actionable** — Every field guides a specific decision or action
6. **Owner-aware** — Distinguishes founder requests from workforce direction
7. **Milestone-focused** — Always identifies next objective after success

## Integration Points

Executive Guidance should feed into:

1. **Briefing Room UI** — Display summary, objective, urgency visually
2. **Conversation Engine** — Use founderQuestion and founderRequest to guide dialogue
3. **API responses** — Include guidance in workflow status endpoints
4. **Founder notifications** — Send guidance when stage changes
5. **Workforce dashboards** — Show workforceDirection to assigned agents

## Testing

Import examples and verify outputs:

```typescript
import { 
  guidanceOnboarding,
  guidanceMissionDefinition,
  guidanceOptimization,
  stateLeadReview,
  guidanceLeadReview
} from "@/lib/workflow/executive-guidance-examples"

console.log(guidanceOnboarding.urgency)    // "HIGH"
console.log(guidanceLeadReview.objective)  // "Select priority prospects for outreach."
console.log(guidanceOptimization.urgency)  // "LOW"
```

## No AI or LLM

This engine is purely deterministic business logic.

- No Claude API calls
- No OpenAI calls
- No prompts
- No embeddings
- No reasoning
- No generation

Guidance is **predetermined for each stage** based on business rules, not AI evaluation.

## Performance

- Pure function, no I/O
- Single-pass evaluation
- ~1-2ms execution time
- Safe for real-time endpoints
- No caching needed

## What's Next

Phase 3 will build systems that consume ExecutiveGuidance:

- Conversation Objective Engine (uses founderQuestion and founderRequest)
- Briefing Room Integration (displays guidance visually)
- Founder Notifications (alerts with urgency and next milestone)
- Workflow Orchestration (routes guidance to UI and systems)
