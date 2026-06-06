# Zeya Phase 12-prep Complete: WorkerBrief + ExecutionPlan Architecture

## Overview
Phase 12-prep has established the complete operational layer between Mission and Worker execution:
1. **Phase 12-prep.1**: WorkerBrief Runtime Architecture
2. **Phase 12-prep.2**: ExecutionPlan Layer

Together these enable Zeya to plan, orchestrate, and dispatch worker operations without external provider dependencies.

## Complete Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Mission / ExecutionRequest                                          │
│ (Business objective: "Qualify these 50 leads")                      │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│ buildExecutionPlan()          [lib/execution-plans]                 │
│ ├─ Validate required fields                                         │
│ ├─ Auto-detect mode (SINGLE/BATCH/SEQUENTIAL)                       │
│ ├─ Create ExecutionPlanStep per target (or generic)                 │
│ └─ Set status: READY                                                │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│ ExecutionPlan                                                        │
│ ├─ id: plan_1234_abc                                                │
│ ├─ title: "Bulk Cold Outreach Wave 1"                               │
│ ├─ mode: BATCH (50 targets)                                         │
│ ├─ status: READY                                                    │
│ ├─ plannedSteps: [50 ExecutionPlanSteps]                            │
│ ├─ assumptions: ["Open rates 20%", "Response time < 24h"]           │
│ ├─ risks: ["Do Not Call compliance", "Gatekeeper screening"]        │
│ └─ successCriteria: "50 attempts, analyze objections"               │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│ dispatchExecutionPlan()       [lib/execution-plans]                 │
│                                                                      │
│ For each ExecutionPlanStep:                                         │
│   ├─ createWorkerBriefsFromExecutionPlan()                          │
│   │  └─ buildWorkerBrief() [lib/workers]                            │
│   │     ├─ Populate from plan context                               │
│   │     ├─ Create dynamicVariables                                  │
│   │     └─ Set status: READY                                        │
│   │                                                                  │
│   ├─ selectWorkerForBrief()   [lib/workers]                         │
│   │  └─ CALLER → Veya (selected)                                    │
│   │                                                                  │
│   └─ dispatchWorkerBrief()    [lib/workers]                         │
│      └─ Status: SIMULATED (no real Twilio/ElevenLabs yet)           │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│ DispatchedExecutionPlan                                              │
│ ├─ plan: ExecutionPlan                                              │
│ ├─ briefs: [50 WorkerBriefs]                                        │
│ ├─ workerSelections: [50 selections for Veya]                       │
│ ├─ dispatchResults: [50 simulated results]                          │
│ └─ summary:                                                          │
│    ├─ totalSteps: 50                                                │
│    ├─ totalBriefs: 50                                               │
│    ├─ successfulDispatches: 50                                      │
│    ├─ dispatchedAt: 2026-06-03T20:30:00Z                            │
│    └─ nextSteps: "Dispatch 50 briefs concurrently..."               │
└──────────────────────┬──────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│ buildExecutionPlanSummary()   [lib/execution-plans]                 │
│                                                                      │
│ Returns human-readable summary:                                     │
│ ├─ Plan metadata (title, status, priority, mode)                    │
│ ├─ Mission objectives                                               │
│ ├─ Workers assigned (all Veya for CALLER steps)                     │
│ ├─ Dispatch statistics                                              │
│ ├─ Next steps (mode-aware)                                          │
│ ├─ Assumptions and risks                                            │
│ └─ Success criteria                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Architecture Layers

### Layer 1: ExecutionPlan (Operational Strategy)
**File**: `lib/execution-plans/`

Describes HOW Zeya intends to run the operation:
- **Mode**: SINGLE, BATCH, SEQUENTIAL, or PARALLEL
- **Priority**: LOW, NORMAL, HIGH, URGENT
- **Steps**: One per target (or generic)
- **Assumptions & Risks**: Explicit strategy assumptions
- **Success Criteria**: How to measure success

Key functions:
- `buildExecutionPlan()` — Create plan from mission context
- `dispatchExecutionPlan()` — Execute plan by creating briefs and dispatching
- `buildExecutionPlanSummary()` — Human-readable plan summary

### Layer 2: WorkerBrief (Worker Instructions)
**File**: `lib/workers/`

Describes WHAT the worker needs to know:
- **Objective**: What to accomplish
- **Context**: Company and lead context
- **Guidance**: Key questions, objection handling, escalation rules
- **Dynamic Variables**: For ElevenLabs/Twilio substitution
- **Success Criteria**: How to know success

Key functions:
- `buildWorkerBrief()` — Create brief for a specific worker
- `selectWorkerForBrief()` — Choose worker (Veya for CALLER)
- `dispatchWorkerBrief()` — Simulate dispatch
- `buildWorkerBriefSummary()` — Human-readable brief summary

## Files Created

### WorkerBrief (Phase 12-prep.1)
```
lib/workers/
├── worker-brief-types.ts          # WorkerBrief, WorkerDispatchResult types
├── worker-brief-builder.ts        # buildWorkerBrief()
├── worker-selector.ts             # selectWorkerForBrief()
├── worker-dispatcher.ts           # dispatchWorkerBrief()
├── worker-brief-summary.ts        # buildWorkerBriefSummary()
├── index.ts                       # Public exports
└── ARCHITECTURE.md                # WorkerBrief architecture guide

app/api/workers/
└── test-brief/
    └── route.ts                   # POST /api/workers/test-brief
```

### ExecutionPlan (Phase 12-prep.2)
```
lib/execution-plans/
├── execution-plan-types.ts        # ExecutionPlan, ExecutionPlanStep types
├── execution-plan-builder.ts      # buildExecutionPlan()
├── execution-plan-to-worker-briefs.ts  # createWorkerBriefsFromExecutionPlan()
├── execution-plan-dispatcher.ts   # dispatchExecutionPlan()
├── execution-plan-summary.ts      # buildExecutionPlanSummary()
├── index.ts                       # Public exports
└── ARCHITECTURE.md                # ExecutionPlan architecture guide

app/api/execution-plans/
└── test-plan/
    └── route.ts                   # POST /api/execution-plans/test-plan
```

## API Endpoints

### POST /api/execution-plans/test-plan
Test the complete flow end-to-end.

**Request**:
```json
{
  "missionId": "mission_001",
  "title": "Test Multi-Target Outreach",
  "companyContext": "TechCorp is a B2B SaaS company",
  "missionObjective": "Qualify 3 leads as potential customers",
  "desiredOutcome": "Schedule discovery calls",
  "targets": [
    {
      "id": "lead-1",
      "name": "Sarah Chen",
      "phone": "+1-555-0100",
      "context": "VP of Operations at DataFlow Inc."
    },
    {
      "id": "lead-2",
      "name": "Mark Johnson",
      "phone": "+1-555-0101",
      "context": "CTO at ProcessFlow"
    },
    {
      "id": "lead-3",
      "name": "Lisa Wong",
      "phone": "+1-555-0102",
      "context": "Operations Manager at WorkAutomation"
    }
  ],
  "priority": "HIGH",
  "successCriteria": "All 3 leads attempted, 2+ calls scheduled"
}
```

**Response** includes:
- `plan`: ExecutionPlan with 3 steps
- `briefs`: 3 WorkerBriefs (one per target)
- `workerSelections`: 3 selections (all Veya)
- `dispatchResults`: 3 simulated dispatch results
- `summary`: Human-readable summary

### POST /api/workers/test-brief
Test single WorkerBrief creation and dispatch.

## Modes Explained

### SINGLE Mode
Single target, linear execution.
- One ExecutionPlanStep
- One WorkerBrief
- Example: "Call Sarah Chen to qualify DataFlow Inc."

### BATCH Mode
Multiple targets, all dispatched at once.
- N ExecutionPlanSteps
- N WorkerBriefs
- All can execute concurrently (Phase 12A+)
- Example: "Call all 50 leads this week"

### SEQUENTIAL Mode
Multiple targets, one after another.
- N ExecutionPlanSteps with dependencies
- N WorkerBriefs
- Step 2 waits for Step 1 to complete
- Example: "Follow-up sequence: initial call, then follow-up if interested"

### PARALLEL Mode
Multiple targets, true concurrent execution.
- Planned for Phase 12B+
- Requires async dispatch and result aggregation

## Current Capabilities

✓ Plan creation (SINGLE, BATCH, SEQUENTIAL modes)
✓ Auto-detection of mode from targets
✓ WorkerBrief generation from plan steps
✓ Worker selection (CALLER → Veya)
✓ Simulated dispatch (no external calls)
✓ Summary generation (human-readable)
✓ Dynamic variables for future providers
✓ TypeScript with full type safety
✓ Validation and error handling
✓ API endpoints for testing

## Coming in Phase 12A (Twilio)

When Twilio phone number is approved:
- Real phone numbers can be assigned
- `dispatchWorkerBrief()` becomes async
- BATCH mode truly dispatches concurrently
- Call results captured and stored
- Status progresses: DISPATCHED → COMPLETED/FAILED

## Coming in Phase 12B (ElevenLabs)

When voice synthesis is ready:
- `dynamicVariables` passed to ElevenLabs
- Veya gets natural voice for all calls
- Script templates become voice prompts
- Dynamic personalization per target

## Coming in Phase 12C (Memory & Zeya Orchestration)

When full system is integrated:
- ExecutionPlan persisted to database
- Dispatch results create MemoryEvents
- Zeya analyzes outcomes
- Zeya adjusts strategy based on learning
- Loop closes: Mission → Plan → Execution → Learning → New Plan

## No External Calls
Phase 12-prep makes **zero external calls**:
- ✓ No Twilio
- ✓ No ElevenLabs
- ✓ No database writes
- ✓ No API calls to external services

All processing is in-memory, enabling full architecture validation without provider dependencies.

## Design Principles

1. **Separation of Concerns**
   - ExecutionPlan = Strategy (HOW)
   - WorkerBrief = Tactics (WHAT the worker does)
   - Worker Agent = Execution (WHO does it)

2. **Mode Flexibility**
   - Same architecture handles 1 target (SINGLE) or 1000 targets (BATCH)
   - Sequential dependencies optional

3. **Provider Independence**
   - No Twilio/ElevenLabs dependency in Phase 12-prep
   - dynamicVariables enable easy provider integration later

4. **Smart Defaults**
   - Sensible keyQuestions, objectionGuidance, escalationRules
   - Zeya doesn't need to specify everything

5. **Auditability**
   - Explicit assumptions and risks in every plan
   - Clear success criteria
   - Human-readable summaries

## Testing the Architecture

### Single Target (SINGLE mode)
```bash
curl -X POST http://localhost:3000/api/execution-plans/test-plan \
  -H "Content-Type: application/json" \
  -d '{
    "missionId": "m1",
    "title": "Single Lead Test",
    "companyContext": "TechCorp",
    "missionObjective": "Qualify Lead A",
    "desiredOutcome": "Schedule call",
    "targets": [{"id": "lead-1", "name": "John Doe", "context": "Test"}],
    "successCriteria": "Call scheduled"
  }'
```

### Multiple Targets (BATCH mode)
```bash
curl -X POST http://localhost:3000/api/execution-plans/test-plan \
  -H "Content-Type: application/json" \
  -d '{
    "missionId": "m2",
    "title": "Bulk Outreach",
    "companyContext": "TechCorp",
    "missionObjective": "Contact 5 leads",
    "desiredOutcome": "Gauge interest",
    "targets": [
      {"id": "lead-1", "name": "Person A", "context": "Company A"},
      {"id": "lead-2", "name": "Person B", "context": "Company B"},
      {"id": "lead-3", "name": "Person C", "context": "Company C"},
      {"id": "lead-4", "name": "Person D", "context": "Company D"},
      {"id": "lead-5", "name": "Person E", "context": "Company E"}
    ],
    "successCriteria": "5 attempts completed"
  }'
```

## Next Steps

1. **Phase 12A**: Twilio integration → Real phone dispatch
2. **Phase 12B**: ElevenLabs integration → Voice synthesis
3. **Phase 12C**: Memory persistence → Full Zeya orchestration loop
4. **Phase 13**: Multi-worker orchestration → Teams of agents

## Summary

**Phase 12-prep is complete**: Zeya has a full operational planning and worker orchestration layer. The architecture validates end-to-end without external dependencies, ready for provider integration in Phase 12A.

The gap between Mission and Worker Execution has been closed with two clean, composable layers:
- **ExecutionPlan**: Strategy and mode (how to run the operation)
- **WorkerBrief**: Instructions and context (what the worker needs to know)

All code compiles, all tests pass, all endpoints work.
