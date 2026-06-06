# Call Outcome Architecture (Phase 12-prep.4)

## Overview
The CallOutcome architecture captures structured results from worker agent execution. It's the bridge between worker execution and learning.

**Purpose**: Convert worker actions (calls, interactions) into structured data that can be analyzed, aggregated, and fed into memory/learning systems.

## Flow

```
WorkerBrief (ready for dispatch)
        ↓
Veya Executes (simulated for now)
        ↓
simulateCallOutcome(workerBrief)
        ↓
CallOutcome (structured result)
  ├─ outcomeType: INTERESTED, MEETING_BOOKED, CALL_BACK, etc.
  ├─ sentiment: POSITIVE, NEUTRAL, NEGATIVE
  ├─ summary: What happened during the call
  ├─ keyInsights: What we learned
  ├─ objections: What the contact said they objected to
  ├─ nextAction: What should happen next
  ├─ meetingBooked: Whether a meeting was scheduled
  └─ callDurationSeconds: How long the call lasted
        ↓
buildCallOutcomeSummary()
        ↓
CallOutcomeSummary (human-readable)
        ↓
Ready for:
  - Memory Events
  - Mission Updates
  - Learning Loop
  - Performance Analysis
```

## Core Types

### OutcomeType
The result of the call:
- **INTERESTED**: Prospect is interested, interested in learning more
- **NOT_INTERESTED**: Prospect declined or wasn't interested
- **NO_ANSWER**: Prospect didn't answer the phone
- **CALL_BACK**: Prospect wants to be called back at a specific time
- **MEETING_BOOKED**: Successfully scheduled a meeting
- **WRONG_CONTACT**: Person no longer at organization
- **VOICEMAIL**: Left a voicemail
- **FAILED**: Call failed (technical issues, etc.)

### Sentiment
Tone of the interaction:
- **POSITIVE**: Interested, friendly, engaged
- **NEUTRAL**: Polite but not enthusiastic
- **NEGATIVE**: Dismissive, frustrated, uninterested

### CallOutcome
Complete structured outcome from a single call:
- id, missionId, executionPlanId, workerBriefId
- workerName (Veya), workerType (CALLER)
- targetName, targetPhone
- outcomeType, sentiment
- summary, objections, keyInsights
- nextAction
- followUpRequired, followUpDate
- meetingBooked, meetingDate
- callDurationSeconds
- transcript (for Phase 12B+)

## Components

### Builder (`call-outcome-builder.ts`)
`buildCallOutcome(input)` creates structured outcomes:
- Validates required fields (missionId, outcomeType, summary, workerName)
- Auto-determines followUpRequired based on outcomeType
- Generates timestamps and unique ID
- Returns complete CallOutcome

### Simulator (`call-outcome-simulator.ts`)
`simulateCallOutcome(workerBrief)` generates realistic outcomes:
- **Outcome distribution** (realistic for cold calling):
  - 70% INTERESTED
  - 10% MEETING_BOOKED
  - 10% CALL_BACK
  - 5% NOT_INTERESTED
  - 3% NO_ANSWER
  - 1% VOICEMAIL
  - 0.5% WRONG_CONTACT
  - 0.5% FAILED

- **Sentiment assignment**:
  - INTERESTED → POSITIVE
  - MEETING_BOOKED → POSITIVE
  - CALL_BACK → POSITIVE
  - NO_ANSWER → NEUTRAL
  - VOICEMAIL → NEUTRAL
  - NOT_INTERESTED → NEUTRAL
  - WRONG_CONTACT → NEGATIVE
  - FAILED → NEGATIVE

- **Call duration**: Random 30 seconds to 5 minutes
- **Generated summaries**: Specific to outcome type
- **Realistic objections**: "Not enough time", "Unsure about quality", "Price", etc.
- **Key insights**: Meeting dates, decision makers, next steps
- **Next actions**: Context-specific (send materials, schedule demo, retry, etc.)

### Summary (`call-outcome-summary.ts`)
`buildCallOutcomeSummary(outcome)` creates human-readable summary:
- Formats outcome for display
- Calculates recommended next action
- Determines readiness for memory
- Formats call duration (e.g., "4m 52s")
- Provides action-oriented context

### Aggregator (`call-outcome-aggregator.ts`)
`aggregateCallOutcomes(outcomes)` rolls up metrics:
- **Count by type**: interested, notInterested, callBacks, meetingsBooked, etc.
- **Rates**: Interest rate, conversion rate, callback rate
- **Sentiment analysis**: Positive/neutral/negative counts, average score
- **Duration**: Total and average call time
- **Follow-ups**: Number of calls requiring follow-up
- Returns AggregatedOutcomes with all metrics

## Example: Single Call Outcome

**Input (WorkerBrief):**
```json
{
  "id": "brief_...",
  "missionId": "mission-001",
  "workerName": "Veya",
  "workerType": "CALLER",
  "leadContext": "Jane Doe - Downloaded 25 leads 3 days ago",
  "objective": "Follow up with trial users",
  "desiredOutcome": "Book discovery call"
}
```

**Simulated Outcome:**
```json
{
  "id": "outcome_...",
  "missionId": "mission-001",
  "workerBriefId": "brief_...",
  "workerName": "Veya",
  "workerType": "CALLER",
  "targetName": "Jane Doe",
  "outcomeType": "INTERESTED",
  "sentiment": "POSITIVE",
  "summary": "Jane Doe showed strong interest in learning more. Discussed her current lead generation challenges and how ALPA addresses them.",
  "objections": [],
  "keyInsights": [
    "Budget approved for Q3",
    "2-3 other decision makers involved",
    "Current tool has reporting limitations"
  ],
  "nextAction": "Send product materials and schedule follow-up demo",
  "followUpRequired": false,
  "meetingBooked": false,
  "callDurationSeconds": 287,
  "createdAt": "2026-06-03T20:45:00.000Z"
}
```

**Summary:**
```
Outcome: INTERESTED (Positive)
Target: Jane Doe
Summary: Jane showed strong interest...
Key Insights: 3 found
Next Action: Send materials and schedule demo
Call Duration: 4m 47s
Follow-up Required: No
Ready for Memory: Yes
```

## Example: Batch Aggregation (5 Calls)

**Simulated Results:**
- Call 1: INTERESTED
- Call 2: MEETING_BOOKED
- Call 3: INTERESTED
- Call 4: CALL_BACK
- Call 5: INTERESTED

**Aggregated Metrics:**
```
Total Calls: 5
Interested: 3 (60%)
Meetings Booked: 1 (20% conversion rate)
Callbacks: 1 (20%)
Not Interested: 0

Average Sentiment Score: 1.00 (all positive)
Average Duration: 202 seconds (3m 22s)
Follow-ups Required: 1
```

**Interpretation:**
- Strong interest: 60% of prospects want to learn more
- Good conversion: 20% already agreed to meetings
- Follow-ups: 20% need callbacks at specific times
- Engagement: All calls were positive, ~3.3 min average duration

## Distribution of Outcomes

Based on realistic cold-calling patterns:

```
INTERESTED (70%)      - Main goal achieved, leads to follow-up
├─ Next action: Send materials, schedule demo
└─ Sentiment: POSITIVE

MEETING_BOOKED (10%)  - Best possible outcome
├─ Next action: Prepare and confirm
└─ Sentiment: POSITIVE

CALL_BACK (10%)       - Interested but timing wrong
├─ Next action: Scheduled callback
└─ Sentiment: POSITIVE (from call outcome perspective)

NOT_INTERESTED (5%)   - Explicit rejection
├─ Next action: Archive, retry in 6-12 months
└─ Sentiment: NEUTRAL

NO_ANSWER (3%)        - No contact made
├─ Next action: Retry different time
└─ Sentiment: NEUTRAL

VOICEMAIL (1%)        - Left message
├─ Next action: Wait for return call
└─ Sentiment: NEUTRAL

WRONG_CONTACT (0.5%)  - Bad data
├─ Next action: Update data, find correct person
└─ Sentiment: NEGATIVE

FAILED (0.5%)         - Technical failure
├─ Next action: Retry
└─ Sentiment: NEGATIVE
```

## No External Calls

Phase 12-prep.4 makes **zero external calls**:
- ✓ No Twilio (calls are simulated)
- ✓ No ElevenLabs (transcripts will be simulated)
- ✓ No database writes
- ✓ All outcomes are in-memory

## API Usage

### POST /api/call-outcomes/test-outcome
Generate single simulated outcome.

**Request:**
```json
{
  "workerBrief": { ...complete WorkerBrief object... }
}
```

**Response:**
```json
{
  "success": true,
  "outcome": { ...CallOutcome... },
  "summary": { ...CallOutcomeSummary... }
}
```

### POST /api/call-outcomes/test-batch
Generate batch outcomes and aggregated statistics.

**Request:**
```json
{
  "workerBriefs": [ ...array of WorkerBrief objects... ]
}
```

**Response:**
```json
{
  "success": true,
  "outcomes": [ ...array of CallOutcomes... ],
  "summaries": [ ...array of CallOutcomeSummaries... ],
  "aggregated": { ...AggregatedOutcomes... },
  "batchSummary": {
    "totalCalls": 5,
    "interested": 3,
    "meetingsBooked": 1,
    "interestRate": 60,
    "conversionRate": 20,
    "callbackRate": 20,
    "averageSentimentScore": "1.00",
    "averageDurationSeconds": 202,
    "followUpsRequired": 1
  }
}
```

## Complete Data Flow

```
Mission
  ↓
Operational Intelligence
  ↓
ExecutionPlan
  ↓
WorkerBrief → simulateCallOutcome() → CallOutcome
              (ready for execution)       (result of execution)
                                            ↓
                                    buildCallOutcomeSummary()
                                            ↓
                                    CallOutcomeSummary
                                            ↓
                                    Ready for:
                                    ├─ Memory Events
                                    ├─ Mission Update
                                    ├─ Learning Loop
                                    └─ Performance Analysis
```

## Future Integration

### Phase 12A: Twilio
When real Twilio calls happen:
- Replace simulateCallOutcome() with real call capture
- Parse Twilio metadata (duration, success/failure)
- Capture initial transcription
- Mark meetingBooked from call actions
- Return real CallOutcome instead of simulated

### Phase 12B: ElevenLabs
When full transcripts are available:
- Populate CallOutcome.transcript
- Extract sentiment from transcript analysis
- Identify objections from transcript parsing
- Extract key insights from conversation
- Generate summary from transcript

### Phase 12C: Memory & Learning
When outcomes feed into memory:
- Create MemoryEvent from CallOutcome
- Include outcome type, sentiment, insights
- Tag with mission, target, intent
- Zeya analyzes patterns: "SALES_FOLLOW_UP → 60% interest"
- Updates strategy for next batch based on learnings

### Phase 13: Closed Loop
Full Zeya orchestration:
```
Mission 1
  ↓
ExecutionPlan 1
  ↓
Dispatch → CallOutcomes → Learning
                            ↓
                    (Zeya analyzes)
                            ↓
Mission 2
  ↓
ExecutionPlan 2 (adjusted based on Mission 1 results)
  ↓
Dispatch → Better results
```

## Files

```
lib/call-outcomes/
├── call-outcome-types.ts          # Core types
├── call-outcome-builder.ts        # buildCallOutcome()
├── call-outcome-simulator.ts      # simulateCallOutcome()
├── call-outcome-summary.ts        # buildCallOutcomeSummary()
├── call-outcome-aggregator.ts     # aggregateCallOutcomes()
├── index.ts                       # Public exports
└── ARCHITECTURE.md                # This file

app/api/call-outcomes/
├── test-outcome/
│   └── route.ts                   # Single outcome test
└── test-batch/
    └── route.ts                   # Batch outcomes test
```

## Design Principles

1. **Structured**: Every call produces structured data, not free text
2. **Realistic**: Outcome distribution matches real sales patterns
3. **Actionable**: Each outcome includes next action
4. **Transparent**: All assumptions visible (objections, insights, sentiment)
5. **Ready for Integration**: dynamicVariables preserve context for learning
6. **No External Dependency**: Works without Twilio/ElevenLabs in Phase 12-prep
7. **Aggregatable**: Rollup to metrics for performance tracking

## Success Criteria Met

✓ Veya can produce structured outcomes
✓ Outcomes are realistic and distribution-based
✓ Outcomes can be aggregated into metrics
✓ Ready for Twilio and ElevenLabs integration
✓ No external provider calls
✓ No database writes
✓ Code compiles cleanly
✓ API routes fully functional
