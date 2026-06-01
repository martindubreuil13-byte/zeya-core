# Work Orchestration Engine

## Overview

The Work Orchestration Engine is the coordinator layer that turns mission guidance into executable work.

It answers:
- **What work needs to be done?** (Work item generation)
- **Who should do it?** (Assignment planning)
- **What order should work happen in?** (Dependency sequencing)
- **What is blocked?** (Blocker detection)
- **What can start now?** (Readiness calculation)
- **What should happen next?** (Next action determination)

## Core Principles

**Deterministic**: No AI, no LLM, pure business logic based on mission state and workflow position.

**Non-Executing**: This engine plans work. It does not send messages, call anyone, or perform work.

**Executive-Ready**: Summaries are human-readable but not UI-specific.

**Dependency-Aware**: Work items sequence based on prerequisites and dependencies.

## Architecture

```
Work Orchestration Engine
├── Execution Plan Builder (execution-plan-builder.ts)
│   ├── Work item generation from mission state
│   ├── Dependency validation
│   ├── Work item sequencing
│   └── Status updates
├── Assignment Planner (assignment-planner.ts)
│   ├── Capability matching
│   ├── Availability checking
│   ├── Workload estimation
│   └── Assignment suggestion
├── Work Orchestration Engine (work-orchestration-engine.ts)
│   ├── Orchestration main entry point
│   ├── Blocker detection
│   ├── Readiness calculation
│   ├── Status determination
│   └── Next action determination
└── Orchestration Summary (orchestration-summary.ts)
    ├── Executive summary building
    ├── Status text generation
    ├── Blocker narrative
    ├── Assignment narrative
    └── Readiness breakdown
```

## Core Types

### ExecutionPlan

The main output of the orchestration engine.

```typescript
{
  id: string
  missionId: string
  businessId: string
  status: "DRAFT" | "READY" | "BLOCKED" | "IN_PROGRESS" | "COMPLETED"
  objective: string
  workItems: OrchestratedWorkItem[]
  assignments: PlannedAssignment[]
  blockers: OrchestrationBlocker[]
  nextAction: string
  readiness: number (0-100)
  createdAt: string
  updatedAt: string
}
```

### OrchestratedWorkItem

A unit of work that needs to be done.

```typescript
{
  id: string
  missionId: string
  title: string
  description: string
  category: "RESEARCH" | "OUTREACH" | "CALLING" | "FOLLOW_UP" | "ANALYSIS" | "FOUNDER_REVIEW" | "ADMIN"
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  status: "WAITING" | "READY" | "ASSIGNED" | "BLOCKED" | "DONE"
  requiredCapabilities: string[]
  dependsOn: string[] (work item IDs)
  suggestedAssigneeId?: string
  blocker?: string
  dependencyMet: boolean
}
```

### PlannedAssignment

Suggested assignment of work to a team member.

```typescript
{
  id: string
  workItemId: string
  assigneeId: string
  assigneeName: string
  role: string
  reason: string
  alternativeAssignees?: string[]
  status: "SUGGESTED" | "READY" | "BLOCKED" | "CONFIRMED"
  assigneeAvailability: number (0-100)
  assigneeCapacity: number (0-100 after assignment)
  capabilityMatch: number (0-100)
}
```

### OrchestrationBlocker

Something preventing execution.

```typescript
{
  id: string
  type: "MISSING_DATA" | "NO_CAPABILITY" | "NO_CAPACITY" | "DEPENDENCY_BLOCKED" | "MISSION_UNCLEAR" | "FOUNDER_DECISION_REQUIRED"
  message: string
  severity: "LOW" | "MEDIUM" | "HIGH"
  relatedWorkItemId?: string
  suggestedResolution: string
  isResolvable: boolean
}
```

## Work Item Generation

Work items are generated deterministically based on mission state and workflow position.

### Examples

**Scenario 1: No selected leads**
- Blocker: Founder needs to select priority prospects
- Status: BLOCKED

**Scenario 2: Selected leads, no brief**
- Work Item 1: "Prepare caller brief" [READY]
- Work Item 2: "Founder approves caller brief" [WAITING]
- Dependency: Item 2 depends on Item 1
- Status: BLOCKED (waiting for founder approval)

**Scenario 3: Brief prepared, ready to call**
- Work Item 1: "Contact prospects" [READY]
- Work Item 2: "Record call results" [WAITING]
- Dependency: Item 2 depends on Item 1
- Assignment: Suggest caller with "calling" capability
- Status: READY

**Scenario 4: Calling in progress**
- Work Item 1: "Analyze responses" [READY]
- Work Item 2: "Founder reviews findings" [WAITING]
- Status: READY

## Assignment Planning

Assignments are matched to workforce members based on:

1. **Required Capabilities**: Work item lists required skills (e.g., "calling", "research")
2. **Member Capabilities**: Each team member has capabilities they can do
3. **Availability**: Team member's current workload (0-100)
4. **Capacity**: After assignment, will they be overloaded?

### Example

```
Work Item: "Contact prospects"
  Required: ["calling"]

Candidate: Maya
  Capabilities: ["calling", "research"]
  Workload: 20%
  Available capacity: 80%

Result: Suggested assignment
  Reason: "Maya has calling capability and is available"
  Status: READY (workload < 70%)
```

## Blocker Detection

Blockers are detected across multiple dimensions:

- **Mission Clarity**: Mission not started or progress is 0
- **Business Blockers**: Business state indicates blocking reason
- **Capability Gaps**: No team member with required capabilities
- **Capacity Issues**: No available team member
- **Dependencies**: Work item depends on incomplete prerequisite
- **Founder Input**: Founder decision or review required
- **Data Gaps**: Required information missing (selected leads, brief, etc.)

## Readiness Calculation

Execution readiness is scored 0-100 based on:

| Factor | Points |
|--------|--------|
| Mission clarity (status ≠ NOT_STARTED) | 20 |
| Workflow not blocked | 20 |
| Work items ready | 20 |
| Workforce capability available | 20 |
| No critical blockers | 20 |

**Example**:
- Mission clear: 20 ✓
- No business blockers: 20 ✓
- 3 ready items of 4: 15
- Workforce ready: 20 ✓
- No critical blockers: 0 (founder review needed)
- **Total: 75%**

## Status Determination

Plan status is determined by:

| Status | When |
|--------|------|
| DRAFT | No work items generated yet, mission not started |
| BLOCKED | One or more critical blockers exist |
| READY | Work items exist and ready, no critical blockers |
| IN_PROGRESS | Some work items assigned or in progress |
| COMPLETED | All work items done |

## Next Action Determination

The orchestration engine determines the most important immediate action:

- **If critical blocker**: Resolve the blocker
- **If founder review needed**: Describe what founder needs to do
- **If work ready**: Assign next work item
- **If all done**: Complete and debrief

## Usage

```typescript
import { buildExecutionPlan, buildOrchestrationSummary } from "@/lib/orchestration";

// Build plan from current state
const plan = buildExecutionPlan(
  {
    missionEvaluation: {...},
    workforceEvaluation: {...},
    businessState: {...},
    executiveGuidance: {...},
    memoryContext: {...}
  },
  missionId,
  businessId
);

// Get executive summary
const summary = buildOrchestrationSummary(plan);

// Use in conversation
console.log(`Status: ${summary.status}`);
console.log(`Next: ${summary.nextAction}`);
console.log(`Blockers: ${summary.blockers.length}`);
```

## Integration Points

The orchestration engine integrates with:

1. **Mission Engine**: Mission status, progress, next action
2. **Workflow Brain**: Current stage, data completeness, blockers
3. **Workforce Engine**: Available members, capabilities, workload
4. **Executive Guidance**: Immediate action, urgency, priorities
5. **Memory System**: Selected leads, call briefs, results

## Test Scenarios

See `orchestration-examples.ts` for 5 test scenarios:

1. **No selected leads**: Foundation blocking stage
2. **No caller brief**: Preparation stage
3. **Ready to call**: Execution stage
4. **No caller available**: Workforce blocker
5. **Call results exist**: Analysis stage

Run: `npx ts-node lib/orchestration/orchestration-examples.ts`

## Success Criteria

The orchestration engine should answer:

✓ "I know what work needs to happen" → Work items with clear titles
✓ "In what order" → Dependencies and sequencing
✓ "Who should do it" → Assignment suggestions with reasoning
✓ "What is blocking execution" → Blocker list with resolutions
✓ "What can start now" → Ready work items
✓ "What should happen next" → Deterministic next action

## No-Go Areas

This engine does **NOT**:

- Send messages or calls
- Perform any work
- Access external APIs
- Write to database
- Automate anything
- Make assumptions beyond deterministic logic

The orchestration layer is planning only. Execution happens elsewhere.
