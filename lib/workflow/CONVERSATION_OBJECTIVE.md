# Zeya Conversation Objective Engine v1

Determines what Zeya should talk about next based on workflow state and guidance.

## Architecture

**Phase 1:** "Where are we?" → BusinessState  
**Phase 2:** "What should we do?" → ExecutiveGuidance  
**Phase 3:** "What should Zeya talk about?" → ConversationObjective

## Core Concept

The Conversation Objective Engine is a deterministic planning layer that decides:

- What to discuss with the founder next
- What question to ask
- How to open the conversation
- What information is needed
- What completion looks like
- What tone to use

This is **NOT** a chat engine. It does **NOT** generate dialogue.

It is a **planning layer** that determines what should be discussed and how to frame it.

## Architectural Constraint

Conversation Objective consumes **ONLY:**
- BusinessState (from Phase 1)
- ExecutiveGuidance (from Phase 2)

It does NOT access:
- businessProfile
- mission
- leads
- callerBrief
- assignments
- callResults
- learningEvents

**Why:** Clean separation of concerns. Workflow Brain owns reality. Executive Guidance owns interpretation. Conversation Objective owns dialogue planning.

## ConversationObjective Type

```typescript
interface ConversationObjective {
  // Identification
  objectiveType: ConversationObjectiveType  // Machine-readable category
  title: string                             // Short conversation title

  // Dialogue
  openingLine: string                       // How to start the conversation
  primaryQuestion: string | null            // One most important question
  tone: "DIRECT" | "SUPPORTIVE" | "EXECUTIVE"

  // Requirements
  informationNeeded: string[]               // What's needed from founder
  expectedFounderResponse: string           // What answer looks like

  // Completion
  completionCriteria: string                // What must happen
  followUpAction: string                    // What's next

  // Context
  urgency: "LOW" | "MEDIUM" | "HIGH"       // From ExecutiveGuidance
}
```

## ConversationObjectiveType

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

## Field Meanings

### objectiveType
Machine-readable conversation category. Maps directly to workflow stage.

### title
Short, specific title for this conversation.

Examples:
- "Establish business foundation"
- "Select priority prospects"
- "Plan next iteration"

### openingLine
How Zeya should open the conversation. Should sound executive, not chatty.

Examples:
- "I understand the business basics. Now I need the sales mission."
- "We have prospects ready, but outreach should not start until the best prospects are selected."
- "We have enough feedback to improve the next sales cycle."

### primaryQuestion
The ONE most important question Zeya should ask.

**Constraints:**
- Single question only
- Short and direct
- Simple English
- Global audience friendly
- Actionable

Examples:
- "What does the business do, and who does it serve?"
- "Which prospects should we prioritize first?"
- "What pattern do you see in the responses?"

**Can be null** if stage has no clear question needed.

### tone
One of: `"DIRECT"`, `"SUPPORTIVE"`, `"EXECUTIVE"`

**SUPPORTIVE:**
- ONBOARDING stage only
- First conversation, learning phase
- Warm but professional

**DIRECT:**
- Stages with blockers (MISSION, ICP, LEAD_REVIEW, BRIEF, ASSIGNMENT)
- Something is blocking, needs clarity
- Matter-of-fact, no fluff

**EXECUTIVE:**
- Stages with execution (LEAD_GENERATION, OUTREACH, REVIEW, OPTIMIZATION)
- Professional, efficient
- Results-focused

### informationNeeded
Machine-readable list of what Zeya needs from founder.

Examples:
- `["business_name", "business_description", "target_audience"]`
- `["selected_leads", "lead_priority"]`
- `["call_outcomes", "prospect_responses", "objections_encountered"]`

### expectedFounderResponse
Plain English description of what a good answer looks like.

Examples:
- "The founder provides basic business information: name, what they do, and who they serve."
- "The founder reviews prospects and selects 3-5 of the strongest matches."
- "The founder reviews results and identifies what worked, what didn't, and what surprised them."

### completionCriteria
What must happen for this conversation objective to be complete.

Examples:
- "Business profile exists with name, offer, and target customer."
- "At least 3 selected leads are saved."
- "Results are reviewed and key findings are identified."

### followUpAction
What happens after this objective is complete. Often the next stage.

Examples:
- "Move to mission definition."
- "Review and select leads."
- "Prepare caller brief."

### urgency
Inherited from ExecutiveGuidance unless there's a deterministic reason to adjust.

Values: `"LOW"`, `"MEDIUM"`, `"HIGH"`

## Usage

### Basic Usage

```typescript
import { 
  deriveBusinessState, 
  deriveExecutiveGuidance,
  determineNextConversationObjective 
} from "@/lib/workflow"

const state = deriveBusinessState({...})
const guidance = deriveExecutiveGuidance(state)
const objective = determineNextConversationObjective({
  businessState: state,
  executiveGuidance: guidance
})

console.log(objective.title)          // "Select priority prospects"
console.log(objective.openingLine)    // "We have prospects ready..."
console.log(objective.primaryQuestion) // "Which prospects should we prioritize?"
console.log(objective.tone)           // "DIRECT"
console.log(objective.urgency)        // "MEDIUM"
```

### In API Handler

```typescript
export async function GET(req: Request) {
  const state = deriveBusinessState(...)
  const guidance = deriveExecutiveGuidance(state)
  const objective = determineNextConversationObjective({
    businessState: state,
    executiveGuidance: guidance
  })
  
  return Response.json({
    stage: state.currentStage,
    objective: objective,
    guidance: guidance
  })
}
```

### With Full Pipeline

```typescript
import { 
  deriveBusinessState, 
  deriveExecutiveGuidance,
  determineNextConversationObjective,
  buildBusinessStateInput,
  getFullBusinessContext
} from "@/lib/workflow"

// Get data from database
const context = await getFullBusinessContext(supabase, businessId)

// Phase 1: Determine reality
const state = deriveBusinessState(buildBusinessStateInput(context))

// Phase 2: Interpret guidance
const guidance = deriveExecutiveGuidance(state)

// Phase 3: Plan conversation
const objective = determineNextConversationObjective({
  businessState: state,
  executiveGuidance: guidance
})

// Use in UI or conversation system
return {
  what_we_know: state.currentStage,
  what_we_should_do: guidance.objective,
  what_to_talk_about: objective.title,
  opening: objective.openingLine,
  question: objective.primaryQuestion
}
```

## Stage Mapping

Conversation Objective provides deterministic outputs for all 10 workflow stages:

| Stage | Type | Tone | Opening | Question |
|-------|------|------|---------|----------|
| ONBOARDING | COLLECT_BUSINESS_CONTEXT | SUPPORTIVE | "I need to understand the business..." | "What does the business do?" |
| MISSION_DEFINITION | DEFINE_MISSION | DIRECT | "I understand the basics. Now I need the mission." | "What outcome should this mission create?" |
| ICP_DEFINITION | DEFINE_ICP | DIRECT | "I need a clear target customer..." | "Who is the best-fit customer?" |
| LEAD_GENERATION | REQUEST_LEADS | EXECUTIVE | "We know who to target..." | "Where will you source prospects?" |
| LEAD_REVIEW | REVIEW_LEADS | DIRECT | "We have prospects, but selection needed..." | "Which prospects should we prioritize?" |
| CALL_PREPARATION | PREPARE_CALLER_BRIEF | DIRECT | "Before assigning workforce..." | "What should the caller know?" |
| WORKFORCE_ASSIGNMENT | ASSIGN_WORKFORCE | DIRECT | "The mission is prepared..." | "Who should handle this mission?" |
| OUTREACH_EXECUTION | REQUEST_CALL_RESULTS | EXECUTIVE | "Outreach is now active..." | "What happened during the calls?" |
| RESULT_REVIEW | REVIEW_RESULTS | EXECUTIVE | "We have outreach results..." | "What pattern do you see?" |
| OPTIMIZATION | OPTIMIZE_WORKFLOW | EXECUTIVE | "We have enough feedback..." | "What should we change?" |

## Examples

See `conversation-objective-examples.ts` for complete outputs for all 10 stages.

Example LEAD_REVIEW objective:

```typescript
{
  objectiveType: "REVIEW_LEADS",
  title: "Select priority prospects",
  openingLine: "We have prospects ready, but outreach should not start until the best prospects are selected.",
  primaryQuestion: "Which prospects should we prioritize first?",
  tone: "DIRECT",
  informationNeeded: ["selected_leads", "lead_priority"],
  expectedFounderResponse: "The founder reviews prospects and selects 3-5 of the strongest matches for the target profile.",
  completionCriteria: "At least 3 selected leads are saved (or all available if fewer than 3).",
  followUpAction: "Prepare caller brief.",
  urgency: "MEDIUM",
}
```

## Tone Derivation

**SUPPORTIVE:**
- ONBOARDING only
- First conversation, relationship building
- "I need to understand..."

**DIRECT:**
- Blocked stages (missing mission, ICP, selections, brief, assignment)
- Something is in the way
- Matter-of-fact, no padding
- "Before we proceed..."

**EXECUTIVE:**
- Execution and optimization (leads, outreach, results, optimization)
- Professional, results-focused
- "Now that we have X, let's..."

## Design Principles

1. **Deterministic** — Same BusinessState + ExecutiveGuidance → same objective
2. **Pure function** — No side effects, no database access, no API calls
3. **No duplication** — Consumes only BusinessState and ExecutiveGuidance
4. **Stage-driven** — Objective depends entirely on currentStage
5. **Actionable** — Every field guides a specific action
6. **Single question** — Focus on the most important ask
7. **Tone-aware** — Matches stage and urgency

## Not a Chat Engine

This does NOT:
- Generate dialogue
- Build conversation flows
- Create prompts for LLMs
- Handle back-and-forth exchanges
- Manage conversation history

This DOES:
- Determine what should be discussed
- Suggest how to open the conversation
- Identify the key question to ask
- Define what completion looks like
- Set the appropriate tone

## Testing

Import examples and verify outputs:

```typescript
import { 
  objectiveOnboarding,
  objectiveMissionDefinition,
  objectiveLeadReview,
  objectiveOptimization
} from "@/lib/workflow/conversation-objective-examples"

console.log(objectiveOnboarding.tone)      // "SUPPORTIVE"
console.log(objectiveMissionDefinition.tone) // "DIRECT"
console.log(objectiveLeadReview.urgency)   // "MEDIUM"
console.log(objectiveOptimization.urgency) // "LOW"
```

## Performance

- Pure function, no I/O
- Single-pass evaluation
- ~1-2ms execution time
- Safe for real-time endpoints
- No caching needed

## Next Integration Points

Phase 4 and beyond will consume ConversationObjective:

- **Conversation Engine** — Generate actual dialogue from objectives
- **Briefing Room UI** — Display "what to talk about next"
- **Founder Notifications** — Alert founder with objective and question
- **Voice System** — Inform voice agent what to discuss
- **Workflow Orchestration** — Route objectives to conversation systems

## Why This Layer

Without Conversation Objective, the conversation system must:
- Know the workflow stage
- Know the business state
- Interpret guidance
- Decide what to discuss
- Build opening lines and questions

With Conversation Objective, the conversation system gets a complete plan:
- **What** to discuss
- **How** to open it
- **What** to ask
- **What** completion looks like
- **What** tone to use

This separation keeps conversation logic clean and maintainable.
