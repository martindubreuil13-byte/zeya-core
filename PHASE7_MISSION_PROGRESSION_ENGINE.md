# Phase 7 — Mission Progression Engine

**Date:** 2026-05-31  
**Duration:** ~1.5 hours  
**Status:** ✅ **Complete and building successfully**

## Objective

Build outcome-awareness into Zeya. The Mission Progression Engine evaluates whether missions are succeeding, not just whether work is progressing.

**New Question:** Are we winning?

## Architecture

### Before Phase 7

```
Workflow (Phase 1)
    ↓
Guidance (Phase 2)
    ↓
Conversation (Phase 3)
    ↓
Memory (Phase 6)
    ↓
[Workflow continues, no outcome awareness]
```

### After Phase 7

```
Workflow (Phase 1)
    ↓
Guidance (Phase 2)
    ↓
Conversation (Phase 3)
    ↓
Memory (Phase 6)
    ↓
Mission Progression (Phase 7)
    ↓
[Understand mission success/failure]
```

## Core Concepts

### Mission ≠ Workflow Stage

**Workflow:** Process moving forward (ONBOARDING → OPTIMIZATION)

**Mission:** Hypothesis to validate ("Pricing sensitivity among freelancers")

A mission is a **testable hypothesis**, not a stage.

### Mission Status

```
NOT_STARTED   No evidence collected
    ↓
ACTIVE        Started, insufficient evidence
    ↓
VALIDATING    Evidence accumulating
    ↓
CONFIRMED     Hypothesis supported (or FAILED)
```

### Evidence

Evidence comes from:
- Call results (objections, successes)
- Memory events (learnings extracted)
- Conversation turns (founder feedback)
- System inferences (patterns detected)

Evidence has:
- Type: OBJECTION, SUCCESS, PATTERN, METRIC, FEEDBACK, LEARNING, TEST_RESULT, MARKET_SIGNAL
- Source: CALL_RESULT, CONVERSATION, MEMORY_EVENT, etc.
- Strength: weak, moderate, strong
- Frequency: how many times observed

## Files Created

### Types (`mission-types.ts`, 238 lines)

**Key Types:**

- **Mission** — id, title, hypothesis, status, progress, confidence, findings, openQuestions, risks
- **Evidence** — id, type, source, statement, strength, frequency, relatedEventIds
- **MissionEvaluation** — status, progress, confidence, evidenceBreakdown, findings, openQuestions, nextAction
- **MissionProgress** — progress%, stage, confidence%, confidenceFactors
- **MissionSummary** — Clean output for display
- **MissionHealth** — health score, reasons, recommendations

**Enums:**

- MissionStatus: NOT_STARTED | ACTIVE | VALIDATING | CONFIRMED | FAILED | PAUSED
- EvidenceType: OBJECTION | SUCCESS | PATTERN | METRIC | FEEDBACK | LEARNING | TEST_RESULT | MARKET_SIGNAL
- EvidenceSource: CALL_RESULT | CONVERSATION | MEMORY_EVENT | LEARNING_EVENT | FOUNDER_INPUT | SYSTEM_INFERENCE

### Progress Rules (`mission-progress.ts`, 333 lines)

**Deterministic Progress Calculation:**

```
0 evidence     → 0% progress
1-5 evidence   → 25% progress
6-10 evidence  → 50% progress
11-20 evidence → 75% progress
20+ evidence   → 100% progress
```

**Confidence Factors (all 0-100):**

- **evidenceQuantity** — More evidence = higher (5 points per evidence)
- **evidenceQuality** — Strong evidence scores higher than weak
- **evidenceDiversity** — Multiple types & sources score higher
- **consistency** — Supporting vs. contradicting ratio

**Overall Confidence** = 25% quantity + 35% quality + 20% diversity + 20% consistency

**Key Functions:**

- `calculateMissionProgress()` — Evidence count → 0-100
- `calculateMissionConfidence()` — Multi-factor confidence score
- `getEvidenceBreakdown()` — Supporting/contradicting/neutral split
- `analyzeEvidenceGaps()` — What's missing
- `assessMissionStrength()` — weak/moderate/strong assessment
- `applyTemporalWeighting()` — Recent evidence weighted higher

### Engine (`mission-engine.ts`, 340 lines)

**Core Evaluation:**

- `determineMissionStatus()` — Based on evidence breakdown and rules
- `deriveMissionOpenQuestions()` — What we still need to know
- `deriveMissionFindings()` — What we've learned
- `identifyMissionRisks()` — Potential blockers
- `determineMissionNextAction()` — What to do next
- `evaluateMission()` — Full evaluation in one call

**Status Determination Rules:**

```
No evidence              → NOT_STARTED
< 3 evidence           → ACTIVE
Mix of pos/neg         → VALIDATING
3+ supporting, 0 neg   → CONFIRMED
3+ contradicting       → FAILED
Ratio: contra > 2×supp → FAILED
```

**Open Questions Derivation:**

Questions come from:
- Evidence gaps (missing types or sources)
- Contradictory signals (why some yes, some no?)
- Unvalidated assumptions
- Success criteria validation
- Alternative hypotheses

**Risk Identification:**

Risks include:
- High objection rate vs. successes
- No recent evidence (momentum loss)
- Unvalidated blocking assumptions
- Low evidence diversity
- Contradicting evidence patterns

### Summary (`mission-summary.ts`, 375 lines)

**Clean Output for Display:**

- `buildMissionSummary()` — Executive summary of mission status
- `buildMissionCard()` — Compact status display
- `assessMissionHealth()` — Overall health score + reasons + recommendations
- `compareMissions()` — Multi-mission overview

**Health Assessment:**

```
healthScore 0-100 based on:
- Status (CONFIRMED: +40, VALIDATING: +20, ACTIVE: +10, etc.)
- Confidence (>70: +10, <30: -15)
- Evidence recency (<7 days: +10, none: -10)
- Evidence quality (strong: +10, weak: -10)

Result: healthy (70+) | at-risk (40-70) | critical (<40)
```

**Formatting Functions:**

- `formatProgressBar()` — Visual progress indicator
- `formatConfidenceBadge()` — Text confidence level
- `formatStatus()` — Human-readable status

## Integration Points

### Reads From

- **Phase 1:** Workflow stage (for context)
- **Phase 6:** Memory events and learnings
- **Call results:** Objections, successes
- **Conversations:** Founder feedback

### Does NOT Modify

- ✅ Phase 1: Workflow Brain
- ✅ Phase 2: Executive Guidance
- ✅ Phase 3: Conversation Objective
- ✅ Phase 4: Briefing Room UI
- ✅ Phase 5: Conversation Extraction
- ✅ Phase 6: Memory System

Mission sits **above** the workflow system. Workflow manages process. Mission manages outcomes.

## Example: Full Evaluation

### Setup

```typescript
const mission: Mission = {
  id: "mission_123",
  businessId: "biz_456",
  title: "Validate pricing sensitivity among freelancers",
  hypothesis: "Freelancers are more price-sensitive than agencies",
  status: "VALIDATING",
  progress: 0,
  confidence: 0,
  successCriteria: [
    "Freelancers cite pricing in >50% of objections",
    "Agencies cite other concerns more often"
  ],
  // ... other fields
};

const evidence: Evidence[] = [
  {
    id: "ev_1",
    missionId: "mission_123",
    type: "OBJECTION",
    source: "CALL_RESULT",
    statement: "Pricing is too high for freelancers",
    strength: "strong",
    frequency: 1,
    recordedAt: "2026-05-31T10:00:00Z",
    relatedEventIds: ["call_123"]
  },
  // ... 11 more evidence items
];
```

### Evaluation

```typescript
const evaluation = evaluateMission(mission, evidence);

// Returns:
{
  status: "VALIDATING",
  progress: 75,
  confidence: 78,
  evidenceCount: 12,
  evidenceBreakdown: {
    supporting: 9,      // Pricing objections
    contradicting: 3,   // Non-pricing objections
    neutral: 0
  },
  findings: [
    "Pricing objection appears in 9 evidence points",
    "Hypothesis about freelancer price-sensitivity well-supported"
  ],
  openQuestions: [
    "Would a free trial reduce pricing objections?",
    "Do agencies rate pricing differently?",
    "What is the price threshold for freelancers?"
  ],
  risks: [
    "Only 3 non-pricing objections (need more diversity)"
  ],
  nextBestAction: "Gather more evidence around trial offers",
  statusReason: "Evidence accumulating, validating hypothesis"
}
```

### Summary

```typescript
const summary = buildMissionSummary(mission, evidence);

// Returns clean output:
{
  title: "Validate pricing sensitivity among freelancers",
  status: "Validating",
  progress: 75,
  confidence: 78,
  supportingEvidence: 9,
  contradictingEvidence: 3,
  keyFinding: "Pricing objection appears in 9 evidence points",
  primaryRisk: "Only 3 non-pricing objections (need more diversity)",
  immediateAction: "Gather more evidence around trial offers",
  openQuestions: [
    "Would a free trial reduce pricing objections?",
    "Do agencies rate pricing differently?",
    "What is the price threshold for freelancers?"
  ],
  successProbability: "medium"
}
```

## Deterministic Rules (No AI)

### Progress

```
evidenceCount === 0        → progress = 0
1 ≤ evidenceCount ≤ 5      → progress = 25
6 ≤ evidenceCount ≤ 10     → progress = 50
11 ≤ evidenceCount ≤ 20    → progress = 75
evidenceCount ≥ 21         → progress = 100
```

### Confidence

```
confidence = 
  (evidenceQuantity × 0.25) +
  (evidenceQuality × 0.35) +
  (evidenceDiversity × 0.2) +
  (consistency × 0.2)
```

Where:
- evidenceQuantity = min(100, evidenceCount × 5)
- evidenceQuality = average strength score
- evidenceDiversity = type & source diversity
- consistency = (supporting / total) × 100

### Status

```
evidenceCount = 0                           → NOT_STARTED
evidenceCount < 3                           → ACTIVE
supporting ≥ 3 AND contradicting = 0        → CONFIRMED
contradicting ≥ 3 AND supporting = 0        → FAILED
contradicting > supporting × 2              → FAILED
Otherwise                                   → VALIDATING
```

### Health

```
healthScore = 50 (baseline)
  + status factor (-40 to +40)
  + confidence factor (-15 to +10)
  + recency factor (-10 to +10)
  + quality factor (-10 to +10)

healthy if healthScore ≥ 70
at-risk if 40 ≤ healthScore < 70
critical if healthScore < 40
```

## Build Status

✅ **TypeScript:** All checks passing  
✅ **Next.js:** Builds in 5.0 seconds  
✅ **No errors, no warnings**  
✅ **Ready for integration**

## Files Summary

| File | Lines | Purpose |
|------|-------|---------|
| mission-types.ts | 238 | Complete type definitions |
| mission-progress.ts | 333 | Progress and confidence calculation |
| mission-engine.ts | 340 | Mission evaluation logic |
| mission-summary.ts | 375 | Clean output building |
| index.ts | 4 | Central exports |
| **Total** | **1,290** | **Complete Phase 7** |

## Usage Examples

### Evaluate Single Mission

```typescript
import { evaluateMission, buildMissionSummary } from "@/lib/mission";

const evaluation = evaluateMission(mission, evidence);
console.log(evaluation.status);      // "VALIDATING"
console.log(evaluation.progress);    // 75
console.log(evaluation.confidence);  // 78

const summary = buildMissionSummary(mission, evidence);
console.log(summary.keyFinding);     // "Pricing objection..."
```

### Check Mission Health

```typescript
import { assessMissionHealth } from "@/lib/mission";

const health = assessMissionHealth(mission, evidence);
console.log(health.overallHealth);   // "healthy" | "at-risk" | "critical"
console.log(health.healthScore);     // 75
console.log(health.reasons);         // ["✓ Hypothesis well-validated", ...]
console.log(health.recommendations); // ["Continue gathering evidence", ...]
```

### Compare Multiple Missions

```typescript
import { compareMissions } from "@/lib/mission";

const comparison = compareMissions(
  missions.map(m => ({
    mission: m,
    evidence: getEvidenceForMission(m.id)
  }))
);

console.log(comparison.activeCount);    // 3
console.log(comparison.confirmedCount); // 1
console.log(comparison.topPriority);    // Mission with highest priority
console.log(comparison.atRiskMissions); // ["Mission A", "Mission B"]
```

### Get Open Questions

```typescript
import { deriveMissionOpenQuestions } from "@/lib/mission";

const questions = deriveMissionOpenQuestions(mission, evidence);
// Returns:
// [
//   "Would a free trial reduce pricing objections?",
//   "Do agencies rate pricing differently?",
//   "What is the price threshold for freelancers?"
// ]
```

## What Phase 7 Enables

✅ **Outcome Awareness** — Know if missions are succeeding
✅ **Evidence-Based** — Decisions backed by collected data
✅ **Deterministic** — No AI, pure rules-based evaluation
✅ **Risk Identification** — See potential blockers early
✅ **Question Derivation** — System identifies unknowns
✅ **Progress Tracking** — Visual indicators of mission health
✅ **Confidence Scoring** — Know how certain we are
✅ **Finding Extraction** — Key learnings surfaced automatically

## What Phase 7 Does NOT Do

❌ Make autonomous decisions based on mission status
❌ Automatically pause/cancel missions
❌ Predict mission success probability (though it can show trajectory)
❌ Use machine learning or predictive models
❌ Require AI or LLM calls
❌ Modify workflow stages
❌ Create new missions automatically
❌ Assign tasks or work items

Phase 7 is **evaluation + awareness**, not **action + automation**.

## Integration Checklist

- [x] Type definitions complete (Mission, Evidence, Evaluation)
- [x] Progress calculation deterministic
- [x] Confidence scoring multi-factor
- [x] Status determination rules finalized
- [x] Open question derivation working
- [x] Risk identification implemented
- [x] Finding extraction automated
- [x] Summary building clean
- [x] Health assessment scoring
- [x] Multi-mission comparison
- [x] All exports clean
- [x] TypeScript passing
- [x] Build passing

## Next Steps

Phase 7 foundation is complete. Future phases will:

1. **Phase 8:** Integrate mission evaluation into briefing room UI
2. **Phase 9:** Mission-driven task assignment (workforce)
3. **Phase 10:** Learning summaries from mission outcomes
4. **Phase 11:** Multi-mission strategy and sequencing

## Summary

Phase 7 transforms Zeya from a process engine into an outcome engine.

**Before Phase 7:**
- Zeya knows what stage you're in
- Zeya knows what to ask
- Zeya remembers what happened

**After Phase 7:**
- Zeya knows if your mission is succeeding
- Zeya knows why with evidence
- Zeya knows what to do next
- Zeya surfaces unknowns to resolve

**The system now understands:** Are we winning?
