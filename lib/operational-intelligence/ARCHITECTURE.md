# Operational Intelligence Layer Architecture (Phase 12-prep.3)

## Overview
The Operational Intelligence Layer converts business context, mission context, and target context into mission-specific execution guidance. It solves the problem of generic WorkerBriefs by injecting domain-specific intelligence.

**Problem**: Phase 12-prep.2 produced structurally correct briefs with generic coaching questions.
**Solution**: Add intelligence layer that infers mission intent and generates mission-specific questions.

## Flow

```
Business Context + Mission Context + Target Context
        ↓
analyzeOperationalMission()
        ↓
OperationalIntelligenceAnalysis
  ├─ Inferred Intent (SALES_FOLLOW_UP, REACTIVATION, etc.)
  ├─ Confidence (HIGH, MEDIUM, LOW)
  ├─ Inferred Trigger, Audience, BusinessModel
  ├─ Key Talking Points
  ├─ Mission-Specific Questions
  ├─ Objection Guidance
  ├─ Escalation Rules
  ├─ Inferred Pain Points
  └─ Recommendations (tone, worker type)
        ↓
buildExecutionPlanFromOperationalAnalysis()
        ↓
ExecutionPlan (with analysis assumptions/risks/criteria)
        ↓
createWorkerBriefsFromOperationalAnalysis()
        ↓
WorkerBriefs (with mission-specific guidance + dynamic variables)
        ↓
selectWorkerForBrief() → Veya
        ↓
dispatchWorkerBrief() → SIMULATED
        ↓
buildOperationalDispatchSummary()
        ↓
Human-readable summary with provider integration notes
```

## Intent Inference

Deterministic rules parse mission context to infer intent:

### SALES_FOLLOW_UP
- Keywords: "free trial", "downloaded", "not upgraded", "follow up"
- Example: "Follow up with users who downloaded free leads but have not upgraded"
- Questions: Did you try it? Were results relevant? What stopped you?
- Tone: Friendly, curious, solution-oriented
- Generated for: ALPA free-trial follow-up, lead download follow-ups

### REACTIVATION
- Keywords: "inactive", "past customer", "reactivate", "reconnect"
- Example: "Re-engage lapsed customers"
- Questions: How long since you used us? What changed? Would it help to know what's new?
- Tone: Warm, understanding, forward-looking

### QUALIFICATION
- Keywords: "qualify", "qualification"
- Example: "Determine if prospect fits ICP"
- Questions: Tell me about your current process. What's the main challenge? Timeline?
- Tone: Professional, discovery-focused

### BOOKING
- Keywords: "book", "schedule", "appointment"
- Example: "Schedule discovery call with qualified lead"
- Questions: What day/time works? Who should be on the call? What should we cover?
- Tone: Efficient, helpful, action-oriented

### GENERAL
- No specific keywords matched
- Uses baseline coaching questions
- Confidence: MEDIUM

## Key Components

### Analyzer (`operational-intelligence-analyzer.ts`)
`analyzeOperationalMission(input)` infers intent and generates guidance:
- Deterministic intent inference from context
- Intent-specific question generation
- Objection guidance tailored to scenario
- Escalation rules for common situations
- Pain point inference
- Assumes HIGH confidence when intent clearly inferred

**Output**: OperationalIntelligenceAnalysis with:
- intent: Inferred mission intent
- confidence: How certain the inference is
- keyTalkingPoints: Main points to address
- keyQuestions: Mission-specific questions
- objectionGuidance: How to handle objections
- escalationRules: When to escalate
- inferredPainPoints: Target's likely challenges
- recommendations: Tone and worker type

### Plan Builder (`operational-plan-builder.ts`)
`buildExecutionPlanFromOperationalAnalysis(input)` wraps existing buildExecutionPlan:
- Calls existing builder with input parameters
- Overrides assumptions, risks, successCriteria from analysis
- Preserves mode auto-detection and target handling
- Returns complete ExecutionPlan with intelligence-backed strategy

### Brief Builder (`operational-brief-builder.ts`)
`createWorkerBriefsFromOperationalAnalysis(plan, analysis)` uses analysis guidance:
- For each ExecutionPlanStep, creates WorkerBrief
- Uses analysis.keyQuestions (NOT generic defaults)
- Uses analysis.objectionGuidance (NOT generic defaults)
- Uses analysis.escalationRules (NOT generic defaults)
- Includes analysis intelligence in dynamicVariables:
  - intent, confidence, inferredTrigger, inferredAudience
  - keyTalkingPoints, inferredPainPoints
  - planId, stepId, stepNumber, target, mode, priority

### Dispatcher (`operational-dispatcher.ts`)
`dispatchOperationalMission(input)` orchestrates full flow:
1. analyzeOperationalMission() → OperationalIntelligenceAnalysis
2. buildExecutionPlanFromOperationalAnalysis() → ExecutionPlan
3. createWorkerBriefsFromOperationalAnalysis() → WorkerBriefs
4. selectWorkerForBrief() for each brief → Veya selected
5. dispatchWorkerBrief() for each → SIMULATED dispatch
6. Aggregate results and statistics

Returns DispatchedOperationalMission with analysis, plan, briefs, selections, results, and summary.

### Summary (`operational-summary.ts`)
`buildOperationalDispatchSummary()` creates human-readable output:
- Mission intent and confidence
- Inferred trigger, audience, business model
- Key talking points and pain points
- Recommended tone
- Plan summary (mode, total steps)
- Execution summary (worker, dispatch status)
- Next steps (context-aware based on mode)
- Assumptions and risks
- Provider integration notes (Twilio, ElevenLabs, Memory)

## Example: ALPA Free Trial Follow-up

**Input:**
```json
{
  "missionId": "alpa-trial-followup-001",
  "companyContext": "ALPA is a lead generation platform for freelancers, agencies, small business owners",
  "missionContext": "Follow up with users who downloaded free leads but have not upgraded",
  "targetContext": "Downloaded 25 free leads three days ago",
  "desiredOutcome": "Understand objections and book a discovery call",
  "targets": [
    { "id": "lead-1", "name": "Example Agency Owner", "context": "Downloaded 25 free leads three days ago." },
    { "id": "lead-2", "name": "Example Freelancer", "context": "Used the free search but never exported leads." }
  ]
}
```

**Analysis Output:**
```
intent: SALES_FOLLOW_UP
confidence: HIGH
inferredTrigger: "Lead download"
inferredAudience: "Agency owners and freelancers looking for leads"
keyTalkingPoints: [
  "Value delivered by ALPA (leads, time savings)",
  "Specific benefits for their business model (agency scaling)",
  "Success stories from similar business owners",
  "Limited time offer or next steps"
]
keyQuestions: [
  "Did you get a chance to review and use what you downloaded?",
  "Were the leads relevant to your business?",
  "Did you find any leads or opportunities that worked out?",
  "What's your current process for finding new clients or leads?",
  "What would need to be different for you to move forward?"
]
objectionGuidance: [
  "Not enough time: 'I understand you're busy. This is designed to save time. Would 5 minutes to show results help?'",
  "Unsure about quality: 'Let's talk about which types of leads matter to you. I can show if we deliver on that.'",
  "Price/budget: 'Many started small and scaled up once they saw results. Want to test limited basis first?'",
  ...
]
escalationRules: [
  "If they express strong buying interest or ask about pricing → escalate to sales",
  "If they request a demo or trial → offer immediate scheduling",
  "If they mention team-wide usage → escalate to account manager",
  ...
]
```

**WorkerBriefs Generated:** 2 briefs (one per target)
- Both include SALES_FOLLOW_UP-specific questions
- Both include ALPA-specific objection handling
- dynamicVariables include:
  - intent: "SALES_FOLLOW_UP"
  - inferredTrigger: "Lead download"
  - keyTalkingPoints: "Value delivered... | Specific benefits... | Success stories..."
  - inferredPainPoints: "Not finding enough qualified leads | Lead generation taking too much time..."

**Result:** Veya receives SDR-specific questions, not coaching questions ✓

## Dynamic Variables for Providers

WorkerBrief dynamicVariables now include operational intelligence:

```javascript
{
  // Existing operational context
  planId: "plan_...",
  stepId: "step_...",
  stepNumber: 1,
  target: "Example Agency Owner",
  mode: "BATCH",
  priority: "NORMAL",
  
  // NEW: Operational intelligence
  intent: "SALES_FOLLOW_UP",
  confidence: "HIGH",
  inferredTrigger: "Lead download",
  inferredAudience: "Agency owners, freelancers",
  inferredBusinessModel: "B2B lead generation",
  keyTalkingPoints: "Value delivered | Benefits | Success stories | Next steps",
  inferredPainPoints: "Not finding leads | Time/cost | Scaling | Uncertain ROI | No system | Overwhelmed",
}
```

These are available for:
- **Twilio**: Use in call routing, queue assignment
- **ElevenLabs**: Feed into prompt templating, voice personalization
- **Logging**: Track what intelligence was provided
- **Analysis**: Understand which guidance led to conversions

## Bug Fix

Fixed ExecutionPlanSummary to show correct workerName:
- Was: Always showed "Unassigned" even when Veya was selected
- Now: Gets workerName from corresponding WorkerBrief if available
- Result: Summary now correctly shows "Veya" when CALLER briefs are dispatched

## Assumptions & Risks Built Into Analysis

Each analysis includes:

**Assumptions:**
- Target has capacity to take a call
- Inferred pain point is relevant
- Target would benefit from conversation

**Risks:**
- Target may not remember downloading/trying
- Decision makers may not be available
- Call may be interrupted by urgent business

These feed into ExecutionPlan and become visible in summary.

## Provider Integration Path

### Phase 12A: Twilio
- Phone numbers approved
- dynamicVariables passed to Twilio (intent, trigger for routing)
- Real calls initiated, recordings captured

### Phase 12B: ElevenLabs
- dynamicVariables (intent, painPoints, talkingPoints) feed voice synthesis
- Veya gets natural voice with intent-aware delivery
- Script templates become voice prompts

### Phase 12C: Memory & Zeya Loop
- Call results create MemoryEvents
- Include analysis intent and inferred audience in events
- Zeya analyzes what worked (e.g., "SALES_FOLLOW_UP with 20% conversion")
- Adjusts future analyses and briefing based on learning
- Loop: Mission → Analysis → Plan → Execution → Learning → Better Analysis

## Current State

✓ Deterministic intent inference
✓ Mission-specific guidance generation
✓ Analysis integration with ExecutionPlan
✓ Analysis integration with WorkerBrief
✓ dynamicVariables populated with intelligence
✓ Orchestrated dispatch flow
✓ Human-readable summary with provider notes
✓ No Twilio/ElevenLabs calls
✓ All in-memory, deterministic

## Files

```
lib/operational-intelligence/
├── operational-intelligence-types.ts      # Core types
├── operational-intelligence-analyzer.ts   # analyzeOperationalMission()
├── operational-plan-builder.ts            # buildExecutionPlanFromOperationalAnalysis()
├── operational-brief-builder.ts           # createWorkerBriefsFromOperationalAnalysis()
├── operational-dispatcher.ts              # dispatchOperationalMission()
├── operational-summary.ts                 # buildOperationalDispatchSummary()
├── index.ts                               # Public exports
└── ARCHITECTURE.md                        # This file

app/api/operational-intelligence/
└── test-dispatch/
    └── route.ts                           # POST /api/operational-intelligence/test-dispatch
```

## API Usage

### POST /api/operational-intelligence/test-dispatch

Test full operational intelligence flow.

**Request:**
```json
{
  "missionId": "mission-001",
  "title": "Free Trial Follow-up",
  "companyContext": "ALPA lead generation platform",
  "missionContext": "Follow up with users who downloaded free leads but have not upgraded",
  "desiredOutcome": "Understand objections and book a discovery call",
  "targets": [
    {
      "id": "lead-1",
      "name": "Jane Doe",
      "phone": "+1234567890",
      "context": "Downloaded 25 leads 3 days ago, never exported"
    }
  ]
}
```

**Response** includes:
- `analysis`: OperationalIntelligenceAnalysis (intent, guidance, pain points)
- `plan`: ExecutionPlan (with analysis assumptions/risks)
- `briefs`: WorkerBriefs (with mission-specific questions)
- `workerSelections`: Veya selected
- `dispatchResults`: Simulated dispatch results
- `summary`: Human-readable output with next steps

## Design Principles

1. **Deterministic**: No machine learning, no APIs needed for inference
2. **Contextual**: Guidance varies by intent
3. **Enriched Variables**: dynamicVariables include intelligence for later use
4. **Provider-Ready**: Variables structured for Twilio/ElevenLabs consumption
5. **Auditable**: Assumptions and risks explicit in every analysis
6. **Composable**: Works with existing ExecutionPlan and WorkerBrief layers

## What Changed

- ✓ Added Operational Intelligence layer
- ✓ Mission-specific questions now generated (not generic)
- ✓ ALPA free trial follow-up generates SDR-style guidance
- ✓ Fixed ExecutionPlanSummary workerName bug
- ✓ dynamicVariables include operational intelligence
- ✓ Assumptions and risks feed into plan and summary
- ✓ Summary shows Veya correctly
- ✓ No external calls made
