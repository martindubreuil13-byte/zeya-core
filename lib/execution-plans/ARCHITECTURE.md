# ExecutionPlan Layer Architecture (Phase 12-prep.2)

## Overview
ExecutionPlan is the operational planning layer between Mission/ExecutionRequest and WorkerBrief. It describes HOW Zeya intends to run the operation.

- **Mission**: WHAT to accomplish (business objective)
- **ExecutionPlan**: HOW to accomplish it (operational strategy)
- **WorkerBrief**: WHO does it and WHAT they need to know (worker-specific instructions)

## Flow

```
Mission / ExecutionRequest
        ↓
buildExecutionPlan()
        ↓
ExecutionPlan (READY status, contains ExecutionPlanSteps)
        ↓
dispatchExecutionPlan()
  ├─ createWorkerBriefsFromExecutionPlan()
  │   └─ buildWorkerBrief() for each step
  ├─ selectWorkerForBrief() for each brief
  ├─ dispatchWorkerBrief() for each brief (simulated)
  └─ aggregate results
        ↓
DispatchedExecutionPlan (with briefs, selections, dispatch results)
        ↓
buildExecutionPlanSummary()
        ↓
Human-readable summary
```

## Core Concepts

### ExecutionPlanMode
How the plan should be executed:

- **SINGLE**: One target only. Linear execution.
- **BATCH**: Multiple targets, execute all at once. Parallelizable in Phase 12B.
- **SEQUENTIAL**: Multiple targets, one after another. Steps have dependencies.
- **PARALLEL**: Multiple targets, concurrent. For Phase 12B+ with full async support.

### ExecutionPlanStep
Individual action within a plan. One per target, or one generic step if no targets.

Fields:
- `stepNumber`: Order in the plan (1-indexed)
- `workerType`: Type of worker (CALLER, RESEARCHER, etc.)
- `objective`: What to accomplish in this step
- `target`: Lead/prospect identifier
- `leadContext`: Specific context about this target
- `desiredOutcome`: What success looks like for this step
- `status`: READY → DISPATCHED → COMPLETED/FAILED
- `dependencies`: IDs of steps that must complete first (for SEQUENTIAL mode)

### ExecutionPlan
Complete operational plan for a mission.

Fields:
- `mode`: SINGLE, BATCH, SEQUENTIAL, PARALLEL
- `priority`: LOW, NORMAL, HIGH, URGENT (for scheduling and weighting)
- `plannedSteps`: Array of ExecutionPlanStep
- `assumptions`: What we're assuming to be true
- `risks`: Known risks and mitigation strategies
- `successCriteria`: How to measure overall success

## Components

### Builder (`execution-plan-builder.ts`)
`buildExecutionPlan(input)` creates a ready-to-dispatch plan:
- Validates required fields
- Defaults mode to SINGLE (no targets) or BATCH (multiple targets)
- Creates one ExecutionPlanStep per target, or one generic step
- All steps default to workerType CALLER
- Sets status to READY
- Generates timestamps and IDs

### To WorkerBriefs (`execution-plan-to-worker-briefs.ts`)
`createWorkerBriefsFromExecutionPlan(plan)` converts plan to briefs:
- For each planned step, creates a WorkerBrief
- Preserves missionId and executionRequestId
- Uses plan.companyContext
- Uses step.leadContext if available
- Uses step.objective and step.desiredOutcome
- Creates sensible default keyQuestions, objectionGuidance, escalationRules
- Includes dynamic variables (planId, stepId, stepNumber, target, mode, priority)

### Dispatcher (`execution-plan-dispatcher.ts`)
`dispatchExecutionPlan(plan)` executes the plan:
- Converts plan to WorkerBriefs
- Selects workers for each brief
- Simulates dispatch for each brief
- Aggregates results
- Returns DispatchedExecutionPlan with:
  - plan: The ExecutionPlan
  - briefs: Generated WorkerBriefs
  - workerSelections: Who was selected for each brief
  - dispatchResults: Simulated dispatch results
  - summary: Aggregate statistics

### Summary Builder (`execution-plan-summary.ts`)
`buildExecutionPlanSummary(plan, briefs, dispatchResults)` creates human-readable output:
- Plan metadata (id, title, status, priority, mode)
- Mission objectives
- List of workers and their targets
- Dispatch statistics
- Context-aware next steps (varies by mode)
- Assumptions and risks
- Success criteria

## Single Target Plan Example

```json
{
  "missionId": "mission_001",
  "title": "Initial DataFlow Outreach",
  "companyContext": "TechCorp is a B2B SaaS company",
  "missionObjective": "Qualify DataFlow Inc. as a potential customer",
  "desiredOutcome": "Schedule a 30-minute discovery call",
  "priority": "NORMAL",
  "mode": "SINGLE",
  "targets": [
    {
      "id": "lead-1",
      "name": "Sarah Chen",
      "phone": "+1-555-0100",
      "context": "VP of Operations at DataFlow Inc."
    }
  ],
  "successCriteria": "Call scheduled or strong objection identified"
}
```

Result:
- 1 ExecutionPlanStep
- 1 WorkerBrief (for Veya)
- Mode: SINGLE
- Next steps: "Wait for response from assigned worker"

## Multi-Target BATCH Plan Example

```json
{
  "missionId": "mission_002",
  "title": "Bulk Cold Outreach Wave 1",
  "companyContext": "TechCorp targeting mid-market SaaS companies",
  "missionObjective": "Reach out to all 50 leads and gauge interest",
  "desiredOutcome": "Gather initial interest and objection data",
  "priority": "HIGH",
  "targets": [
    { "id": "lead-1", "name": "Lead 1", "context": "Company A" },
    { "id": "lead-2", "name": "Lead 2", "context": "Company B" },
    ...
  ],
  "successCriteria": "50 attempts made, responses analyzed"
}
```

Result:
- 50 ExecutionPlanSteps
- 50 WorkerBriefs (all for Veya)
- Mode: BATCH
- Next steps: "Dispatch 50 briefs concurrently to workers"

## Multi-Target SEQUENTIAL Plan Example

```json
{
  "missionId": "mission_003",
  "title": "Follow-up Sequence",
  "companyContext": "TechCorp",
  "missionObjective": "Follow up with leads who showed interest",
  "desiredOutcome": "Advance to demo call",
  "targets": [
    { "id": "lead-1", "name": "Lead 1 - First Follow-up", "context": "..." },
    { "id": "lead-1-second", "name": "Lead 1 - Second Follow-up", "context": "..." },
    { "id": "lead-2", "name": "Lead 2 - First Follow-up", "context": "..." }
  ],
  "successCriteria": "All sequences completed, demos scheduled"
}
```

Result:
- Multiple ExecutionPlanSteps with dependencies
- Step 2 depends on Step 1, Step 3 depends on Step 2, etc.
- Mode: SEQUENTIAL
- Next steps: "Dispatch briefs sequentially, waiting for each to complete"

## Current State

### Implemented ✓
- ExecutionPlan types with all modes
- Builder with mode auto-detection
- Conversion to WorkerBriefs
- Simulated dispatch
- Summary generation
- API endpoint for testing

### Not Yet Implemented
- Twilio provider integration
- ElevenLabs voice synthesis
- Real async dispatch for BATCH/PARALLEL
- Step dependency resolution
- Worker capacity checking
- Call result aggregation
- Memory persistence

## API Usage

### POST /api/execution-plans/test-plan

Test the ExecutionPlan flow end-to-end.

Request:
```json
{
  "missionId": "mission_001",
  "title": "Test Plan",
  "companyContext": "TechCorp",
  "missionObjective": "Test multi-target execution",
  "desiredOutcome": "Validate architecture",
  "targets": [
    {
      "id": "lead-1",
      "name": "Test Lead 1",
      "phone": "+1-555-0100",
      "context": "Test context 1"
    },
    {
      "id": "lead-2",
      "name": "Test Lead 2",
      "phone": "+1-555-0101",
      "context": "Test context 2"
    }
  ],
  "successCriteria": "Both leads contacted"
}
```

Response:
```json
{
  "success": true,
  "plan": { ...ExecutionPlan with 2 steps... },
  "briefs": [ ...2 WorkerBriefs... ],
  "workerSelections": [ ...2 selections... ],
  "dispatchResults": [ ...2 results... ],
  "summary": { ...human-readable summary... }
}
```

## Phase Integration

### Phase 12A: Twilio Integration
When Twilio number is approved:
- ExecutionPlan modes become more meaningful
- BATCH mode can truly dispatch all at once
- dispatchWorkerBrief() becomes async
- Real phone calls initiated

### Phase 12B: ElevenLabs Integration
When voice synthesis is enabled:
- dynamicVariables passed to ElevenLabs for personalization
- Veya has natural voice for all calls
- Script templates become voice prompts

### Phase 12C: Aggregation & Memory
When memory persistence is complete:
- dispatchExecutionPlan() saves plan to database
- Dispatch results create MemoryEvents
- Zeya analyzes outcomes and adjusts strategy
- Loop closes: Mission → Plan → Execution → Learning → Adjusted Plan

## Design Principles

1. **No External Calls**: ExecutionPlan creates no Twilio, ElevenLabs, or database calls in Phase 12-prep. Pure in-memory planning.

2. **Mode Flexibility**: Same ExecutionPlan architecture handles SINGLE, BATCH, SEQUENTIAL, and future PARALLEL modes.

3. **Step-Based Execution**: Each target becomes a step with independent lifecycle (status, dependencies, scheduling).

4. **Assumptions & Risks**: Plans are explicit about assumptions and known risks, enabling better decision-making by Zeya.

5. **Default Values**: Sensible defaults for guidance (keyQuestions, objectionGuidance) so Zeya doesn't have to specify everything.

6. **Dynamic Variables**: planId, stepId, target, mode, priority included in WorkerBrief dynamicVariables for later provider use.

## File Structure

```
lib/execution-plans/
├── execution-plan-types.ts        # Core types
├── execution-plan-builder.ts      # buildExecutionPlan()
├── execution-plan-to-worker-briefs.ts  # createWorkerBriefsFromExecutionPlan()
├── execution-plan-dispatcher.ts   # dispatchExecutionPlan()
├── execution-plan-summary.ts      # buildExecutionPlanSummary()
├── index.ts                       # Public exports
└── ARCHITECTURE.md                # This file
```
