# Phase 8: Quick Reference

## What Phase 8 Does

Evaluates workforce capacity, assignments, and execution readiness.

```
Members + Work Items
    ↓
Evaluate
    ↓
Status, Readiness, Blockers, NextAction
```

## Main Function

```typescript
import { evaluateWorkforceState } from "@/lib/workforce";

const evaluation = evaluateWorkforceState(members, workItems, mission);

// Returns:
{
  state: { /* members, items organized by status */ },
  readinessFactors: { 
    hasMission, missionHasAction, hasAvailableMember, 
    hasRequiredCapability, hasReadyWorkItem 
  },
  executionBlockers: string[],
  memberBlockers: [{ memberId, reason }],
  workItemBlockers: [{ workItemId, reason }],
  nextActions: string[],
  overallStatus: "IDLE" | "READY" | "IN_PROGRESS" | "BLOCKED",
  readinessScore: 0-100
}
```

## Member Model

```typescript
interface WorkforceMember {
  id, businessId, name
  role: "CALLER" | "RESEARCHER" | "COPYWRITER" | "STRATEGIST" | "OPERATOR" | "CUSTOM"
  capabilities: string[] // ["cold_outreach", "follow_up", ...]
  status: "AVAILABLE" | "ASSIGNED" | "BUSY" | "BLOCKED" | "INACTIVE"
  assignedMissionId?, assignedTaskId?
  currentWorkload: number // 0-100
}
```

## Work Item Model

```typescript
interface WorkItem {
  id, missionId, businessId
  title, description
  type: "RESEARCH" | "CALLING" | "OUTREACH" | "FOLLOW_UP" | "ANALYSIS" | "ADMIN"
  status: "READY" | "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "DONE"
  assignedTo?: memberId
  blocker?: string
  requiredCapabilities: string[]
  priority: "low" | "medium" | "high"
}
```

## Status Progression

```
IDLE
 ↓ (member available + work ready)
READY
 ↓ (work assigned)
IN_PROGRESS
 ↓ (work done)
DONE

BLOCKED ← anytime (work blocked or member unavailable)
```

## Readiness Scoring

```
Score = sum of factors:
- Mission exists: +20
- Mission has clear action: +20
- Member available: +20
- Capability exists: +20
- Work item ready: +20

Total: 0-100
```

## Member Availability

```
Status:
- AVAILABLE: 100%
- ASSIGNED: 80%
- BUSY: 40%
- BLOCKED: 0%
- INACTIVE: 0%

Adjusted by workload:
availability = base × (1 - workload/100)
```

## Key Functions

### Core Evaluation

```typescript
evaluateWorkforceState(members, workItems, mission)  // Full evaluation
buildWorkforceState(members, workItems)              // Just state
```

### Readiness

```typescript
calculateWorkforceReadiness(factors)                 // 0-100
calculateTeamWorkload(members)                       // Avg workload %
calculateTeamCapacity(members)                       // Available %
canTeamHandleWorkload(members, hours)                // Can absorb?
```

### Capability

```typescript
memberHasCapability(member, capability)              // Boolean
memberHasAllCapabilities(member, capabilities)       // Boolean
findMembersWithCapability(members, capability)       // Member[]
getAvailableMembersWithCapability(members, cap)      // Member[]
```

### Blockers

```typescript
detectMemberBlockers(member)                         // String | null
detectWorkItemBlockers(item, members)                // String | null
deriveExecutionBlockers(state, members, items)       // String[]
```

### Summary

```typescript
buildWorkforceSummary(evaluation, members, items)    // Executive brief
buildWorkforceHealthCard(summary)                    // Status card
buildAssignmentSummaries(members, items)             // Per-member view
analyzeCapacity(available, demand)                   // Capacity analysis
buildWorkforcePortfolio(members, items)              // Team overview
calculateWorkforceMetrics(members, items)            // Key metrics
```

## Execution Blockers

```
1. No member available
2. No work item ready
3. Required capability missing
4. Work items blocked, no progress
5. Team capacity insufficient
```

## Next Action Priority

```
1. If blocked      → "Resolve blocker: {reason}"
2. If no member    → "Add {type} workforce member"
3. If no work      → "Create the next work item"
4. If ready, unassigned → "Assign {type} work"
5. If assigned, not started → "Start the assigned work"
6. If in progress  → "Continue executing"
```

## Display Functions

```typescript
formatWorkforceStatus(status)     // "Idle" | "Ready ✓" | "In Progress" | "Blocked ✗"
formatReadinessBadge(readiness)   // "Highly Ready" | "Mostly Ready" | "Not Ready"
formatCapacityBar(used, total)    // "[▓▓▓▓░░░░░░░░░░░░░░] 20%"
```

## Work Item Readiness

```typescript
isWorkItemReady(item)             // status=READY && !blocker
isWorkItemBlockedByCapability(item, teamCapabilities)  // Missing skill?
getCapabilityGap(item, teamCapabilities)  // String[] of missing skills
```

## Capacity Planning

```typescript
estimateCapacityNeeded(items)      // Total hours needed
estimateCapacityAvailable(members) // Total hours available
hasCapacityFor(members, items)     // Can team do this?
```

## At-Risk Detection

At-risk tasks are identified if:
- Assigned to overloaded member (workload ≥80%)
- Due soon but not started
- Blocked with no progress

## State Composition

```typescript
state = {
  availableMembers,
  assignedMembers,
  busyMembers,
  blockedMembers,
  readyWorkItems,
  assignedWorkItems,
  inProgressWorkItems,
  blockedWorkItems,
  completedWorkItems
}
```

## Readiness Factors

Each factor is boolean:
- hasMission: Mission exists
- missionHasAction: Mission has clear next action
- hasAvailableMember: At least one available
- hasRequiredCapability: Skill exists in team
- hasReadyWorkItem: At least one ready item

Score = sum of true factors × 20 (out of 100)

## Example: From Raw to Evaluation

```typescript
// 1. Set up
const members = [
  { id: "m1", name: "John", role: "CALLER", status: "AVAILABLE" }
];
const workItems = [
  { id: "w1", type: "CALLING", status: "READY", requiredCapabilities: ["calling"] }
];

// 2. Evaluate
const eval = evaluateWorkforceState(members, workItems, mission);
// → { readinessScore: 100, overallStatus: "READY", nextAction: "Start..." }

// 3. Build summary
const summary = buildWorkforceSummary(eval, members, workItems);
// → { status: "READY", readiness: 100 }

// 4. Check capacity
const capacity = analyzeCapacity(40, 4); // 40 hrs available, 4 hrs needed
// → { canHandle: true, cushion: 900 }
```

## Integration

Phase 8 **reads from:**
- Workforce members
- Work items
- Mission status (optional)

Phase 8 **doesn't modify:**
- Workflow stages
- Mission state
- Profile
- Memory

Workforce sits alongside mission. Not above, not below — parallel concern.

## No AI, No Automation

All evaluation is deterministic:
- Status: rule-based
- Readiness: formula-based
- Blockers: pattern-based
- Actions: priority list

No learning, no inference, no magic.

## Testing

```typescript
// Readiness scoring
expect(readiness(factors)).toBe(60);  // 3 of 5 factors

// Member availability
expect(availability(member)).toBeLessThan(100);  // Workload reduces it

// Blocker detection
expect(blockers.includes("No member available")).toBe(true);

// Next action
expect(action).toMatch(/Resolve|Add|Create|Assign|Start/);
```

---

## TL;DR

Phase 8 = Members + Work Items → Status, Readiness, Blockers, NextAction

**All deterministic. No AI. Pure business logic.**
