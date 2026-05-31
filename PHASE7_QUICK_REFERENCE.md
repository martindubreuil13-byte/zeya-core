# Phase 7: Quick Reference

## What Phase 7 Does

Evaluates whether missions are succeeding using evidence-based deterministic rules.

```
Mission + Evidence
    ↓
Evaluate
    ↓
Status, Progress, Confidence, Findings, OpenQuestions, Risks, NextAction
```

## Main Function

```typescript
import { evaluateMission } from "@/lib/mission";

const evaluation = evaluateMission(mission, evidence);

// Returns:
{
  status: "VALIDATING" | "CONFIRMED" | "FAILED" | etc,
  progress: number (0-100),
  confidence: number (0-100),
  evidenceCount: number,
  evidenceBreakdown: { supporting, contradicting, neutral },
  findings: string[],
  openQuestions: string[],
  risks: string[],
  nextBestAction: string,
  statusReason: string
}
```

## Mission Model

```typescript
interface Mission {
  id: string
  businessId: string
  title: string
  hypothesis: string
  status: MissionStatus
  progress: number
  confidence: number
  successCriteria: string[]
  targetOutcome: string
  blockingAssumptions: string[]
  findings: string[]
  openQuestions: string[]
  risks: string[]
  priority: "low" | "medium" | "high"
}
```

## Status Progression

```
NOT_STARTED → ACTIVE → VALIDATING → CONFIRMED
                    ↓
                  FAILED
                    
                  PAUSED (anytime)
```

### Rules

| Status | Condition |
|--------|-----------|
| NOT_STARTED | No evidence |
| ACTIVE | <3 evidence |
| VALIDATING | Mixed supporting/contradicting |
| CONFIRMED | 3+ supporting, 0 contradicting |
| FAILED | 3+ contradicting, OR contradicting > 2× supporting |
| PAUSED | User paused it |

## Evidence Model

```typescript
interface Evidence {
  id: string
  missionId: string
  type: EvidenceType
  source: EvidenceSource
  statement: string
  strength: "weak" | "moderate" | "strong"
  frequency: number
  recordedAt: string
  relatedEventIds: string[]
}
```

### Evidence Types

- **OBJECTION** — Customer mentioned concern
- **SUCCESS** — Customer showed positive signal
- **PATTERN** — Observed in multiple conversations
- **METRIC** — Quantitative result
- **FEEDBACK** — Direct founder input
- **LEARNING** — System-derived insight
- **TEST_RESULT** — Outcome of deliberate test
- **MARKET_SIGNAL** — External market data

### Evidence Sources

- CALL_RESULT
- CONVERSATION
- MEMORY_EVENT
- LEARNING_EVENT
- FOUNDER_INPUT
- SYSTEM_INFERENCE

## Progress Calculation

```
0 evidence     → 0%
1-5 evidence   → 25%
6-10 evidence  → 50%
11-20 evidence → 75%
20+ evidence   → 100%
```

## Confidence Scoring

```
confidence = 
  (quantity × 0.25) +
  (quality × 0.35) +
  (diversity × 0.2) +
  (consistency × 0.2)

Where:
- quantity = min(100, count × 5)
- quality = average strength score
- diversity = type & source variety
- consistency = supporting % of total
```

## Key Functions

### Core Evaluation

```typescript
evaluateMission(mission, evidence)          // Full evaluation
determineMissionStatus(mission, evidence)   // Just status
```

### Derivation

```typescript
deriveMissionOpenQuestions(mission, evidence)  // What we need to know
deriveMissionFindings(mission, evidence)       // What we learned
identifyMissionRisks(mission, evidence)        // Potential blockers
determineMissionNextAction(mission, evidence)  // What to do next
```

### Summary Building

```typescript
buildMissionSummary(mission, evidence)      // Executive summary
assessMissionHealth(mission, evidence)       // Health score + reasons
buildMissionCard(mission, evidence)          // Compact display
compareMissions([...])                       // Multi-mission view
```

### Progress Calculation

```typescript
calculateMissionProgress(evidence)           // 0-100
calculateMissionConfidence(evidence)         // 0-100
getEvidenceBreakdown(evidence)               // supporting/contradicting/neutral
analyzeEvidenceGaps(evidence, criteria)      // What's missing
```

## Open Questions Derivation

Questions are automatically created from:

1. **Evidence gaps** — Missing types or sources
2. **Contradictions** — Why some yes, some no?
3. **Assumptions** — Which ones are blocking?
4. **Success criteria** — Have we validated each?
5. **Alternative hypotheses** — What else could explain this?

## Risk Identification

Risks are automatically identified from:

1. **High objection ratio** — More negative than positive
2. **No recent activity** — Momentum loss
3. **Unvalidated assumptions** — Critical unknowns
4. **Low diversity** — Evidence only from one source
5. **Contradicting patterns** — Evidence conflicts

## Health Assessment

```typescript
const health = assessMissionHealth(mission, evidence);

// Returns:
{
  overallHealth: "healthy" | "at-risk" | "critical",
  healthScore: number (0-100),
  reasons: string[],
  recommendations: string[]
}
```

### Scoring

```
healthScore = 50 (baseline)
  + status factor (-40 to +40)
    - CONFIRMED: +40
    - VALIDATING: +20
    - ACTIVE: +10
    - NOT_STARTED: -20
    - FAILED: -40
  + confidence factor (-15 to +10)
    - >70: +10
    - <30: -15
  + recency factor (-10 to +10)
    - Recent evidence: +10
    - No recent: -10
  + quality factor (-10 to +10)

Ranges:
- 70+ = healthy
- 40-70 = at-risk
- <40 = critical
```

## Display Functions

```typescript
formatProgressBar(progress)     // "█████░░░░░░░░░░░░░░ 25%"
formatConfidenceBadge(conf)     // "High Confidence" | "Low Confidence"
formatStatus(status)            // "Validating" | "Confirmed ✓" | etc
buildMissionCard(...)           // Compact status card
```

## Multi-Mission Summary

```typescript
const comparison = compareMissions([
  { mission: m1, evidence: e1 },
  { mission: m2, evidence: e2 },
  // ...
]);

// Returns:
{
  activeCount: number,
  confirmedCount: number,
  failedCount: number,
  averageProgress: number,
  averageConfidence: number,
  topPriority: MissionSummary | null,
  atRiskMissions: string[]
}
```

## Evidence Collection

Evidence comes from:

1. **Call Results** → Objections, successes
2. **Conversations** → Founder feedback
3. **Memory Events** → Extracted learnings
4. **Learning Events** → Pattern detection
5. **Manual Input** → Founder enters directly

## Example: From Raw to Summary

```typescript
// 1. Collect evidence
const evidence = [
  { type: "OBJECTION", strength: "strong", frequency: 3 },
  { type: "OBJECTION", strength: "moderate", frequency: 2 },
  { type: "SUCCESS", strength: "strong", frequency: 1 }
];

// 2. Evaluate
const eval = evaluateMission(mission, evidence);
// → { status: "VALIDATING", progress: 50, confidence: 65 }

// 3. Get summary
const summary = buildMissionSummary(mission, evidence);
// → { 
//     status: "Validating",
//     progress: 50,
//     confidence: 65,
//     keyFinding: "Objections appearing frequently",
//     immediateAction: "Address identified objections"
//   }

// 4. Check health
const health = assessMissionHealth(mission, evidence);
// → { overallHealth: "at-risk", healthScore: 55 }
```

## Integration Points

Phase 7 **reads from:**
- Workflow stage (Phase 1) - for context
- Memory events (Phase 6) - for learnings
- Call results - for objections/successes
- Conversations - for founder feedback

Phase 7 **does NOT modify:**
- Workflow stages
- Memory
- Profile
- Any other phase

Mission sits **above** the workflow. It evaluates outcomes, not process.

## No AI, No LLM

All evaluation is deterministic:
- Progress: fixed formula
- Confidence: multi-factor calculation
- Status: rule-based decision
- Findings: pattern extraction
- Risks: gap analysis
- Questions: template-based derivation

No machine learning, no neural networks, no language models.

## Testing Examples

```typescript
// Test progress
expect(calculateMissionProgress([e1, e2])).toBe(25);  // 1-5 evidence

// Test confidence
const conf = calculateMissionConfidence([strong, moderate, weak]);
expect(conf).toBeGreaterThan(50);

// Test status
const status = determineMissionStatus(mission, [success, success]);
expect(status).toBe("VALIDATING");

// Test evaluation
const eval = evaluateMission(mission, evidence);
expect(eval.status).toBeDefined();
expect(eval.progress >= 0 && eval.progress <= 100).toBe(true);
```

---

## TL;DR

Phase 7 = Evidence → Status, Progress, Confidence, Findings, Risks, Questions

**All deterministic. No AI. Pure business logic.**
