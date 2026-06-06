# WorkerBrief Runtime Architecture (Phase 12-prep)

## Overview
The WorkerBrief architecture enables Zeya to generate mission-specific instructions and dispatch them to worker agents (starting with Veya). This bridges Zeya's strategic intelligence with worker execution.

## Flow

```
Mission / ExecutionRequest
        ↓
buildWorkerBrief()
        ↓
WorkerBrief (READY status)
        ↓
selectWorkerForBrief()
        ↓
Worker selected (e.g., Veya for CALLER type)
        ↓
dispatchWorkerBrief()
        ↓
DispatchResult (SIMULATED status)
        ↓
buildMemoryEvent() [future integration]
        ↓
buildWorkerBriefSummary()
        ↓
Human-readable summary with next steps
```

## Components

### WorkerBrief Type (`worker-brief-types.ts`)
Core data structure representing a mission-specific brief:
- **id**: Unique identifier
- **missionId**: Parent mission
- **workerType**: Type of worker (CALLER, RESEARCHER, OUTREACH, SCHEDULER, ANALYST)
- **workerName**: Assigned worker name (e.g., "Veya" for CALLER)
- **status**: DRAFT → READY → DISPATCHED → COMPLETED/FAILED
- **companyContext**: Business context for the worker
- **leadContext**: Optional specific information about the prospect
- **objective**: What the worker should accomplish
- **desiredOutcome**: What success looks like
- **keyQuestions**: Questions to explore
- **objectionGuidance**: How to handle common objections
- **escalationRules**: When to escalate
- **successCriteria**: How to measure success
- **toneGuidance**: Optional personality guidance
- **dynamicVariables**: Key-value store for runtime substitution (for ElevenLabs, Twilio, etc.)

### Builder (`worker-brief-builder.ts`)
`buildWorkerBrief(input)` creates a ready-to-dispatch brief:
- Validates required fields
- Assigns worker name based on worker type
- Sets status to READY
- Builds dynamicVariables from brief fields
- Generates timestamps and ID

### Worker Selection (`worker-selector.ts`)
`selectWorkerForBrief(brief)` chooses which worker to dispatch to:
- CALLER → Veya ✓ (implemented)
- RESEARCHER → Nova (placeholder)
- OUTREACH → Echo (placeholder)
- SCHEDULER → Sage (placeholder)
- ANALYST → Iris (placeholder)

### Dispatcher (`worker-dispatcher.ts`)
`dispatchWorkerBrief(brief)` simulates dispatch:
- Returns DispatchResult with status: SIMULATED (no real providers yet)
- Includes human-readable message about what will happen
- Ready for future Twilio/ElevenLabs integration

### Summary Builder (`worker-brief-summary.ts`)
`buildWorkerBriefSummary(brief, dispatchResult)` creates human-readable summary:
- Brief ID, worker, type
- Objective and desired outcome
- Success criteria
- Dispatch status
- Next steps (contextual to worker type)

## Current State

### Implemented ✓
- WorkerBrief types and validation
- Builder with dynamic variables support
- Worker selector (CALLER → Veya)
- Simulated dispatch (no external calls)
- Summary generation
- API endpoint for testing

### Not Yet Implemented
- Twilio phone number integration
- ElevenLabs voice synthesis
- Call transcripts
- Memory event persistence
- Worker response handling
- Zeya orchestration layer

## API Usage

### POST /api/workers/test-brief
Test the WorkerBrief flow end-to-end.

Request:
```json
{
  "missionId": "mission_001",
  "companyContext": "TechCorp is a B2B SaaS company...",
  "leadContext": "Sarah Chen, VP of Operations at DataFlow Inc.",
  "objective": "Qualify DataFlow as a potential customer",
  "desiredOutcome": "Schedule a 30-minute discovery call",
  "keyQuestions": ["How many people work with workflows?", "..."],
  "objectionGuidance": ["If happy with current system, explore what would change that"],
  "escalationRules": ["If strong interest, escalate to sales"],
  "successCriteria": "Either a scheduled call or clear qualification data"
}
```

Response:
```json
{
  "success": true,
  "brief": { ...WorkerBrief... },
  "workerSelection": { workerName, workerType, selected, reason },
  "dispatchResult": { briefId, workerName, workerType, status: "SIMULATED", message },
  "summary": { ...human-readable summary... }
}
```

## Integration Points (Phase 12+)

### ElevenLabs Integration
When implemented:
- `dynamicVariables` will be passed to ElevenLabs for voice personalization
- Variables like `workerName`, `objective`, `companyContext` become template variables
- Voice synthesis uses these values for natural-sounding calls

### Twilio Integration
When implemented:
- Phone number registered and approved
- `dispatchWorkerBrief()` will call Twilio API
- Status will change from SIMULATED to DISPATCHED
- Call result will be captured

### Memory Event Creation
When implemented:
- After dispatch, `buildMemoryEventsFromDispatch()` creates MemoryEvent
- Events track execution outcomes for Zeya's learning
- Zeya analyzes patterns and updates strategy

### Zeya Orchestration
When implemented:
- Zeya will generate WorkerBrief as part of mission planning
- Zeya will wait for dispatch result
- Zeya will analyze outcome and iterate strategy
- Multiple worker types can be chained

## No External Calls
This architecture makes **no actual external calls**:
- No Twilio
- No ElevenLabs
- No database writes
- All data is in-memory during Phase 12-prep

This is intentional — validates the architecture without provider dependencies.

## Key Design Decisions

1. **Dynamic Variables**: Rather than hardcoding values for ElevenLabs/Twilio, we collect them in `dynamicVariables` as a flexible key-value store. This allows future providers to access exactly what they need.

2. **Worker Names**: Pre-defined names (Veya, Nova, Echo, Sage, Iris) create personality and context. Workers become team members, not abstract functions.

3. **Simulated Dispatch**: No provider dependency. This lets us validate the entire flow without credentials or API keys.

4. **Status Progression**: DRAFT → READY → DISPATCHED → COMPLETED/FAILED allows clear state tracking and avoids conflicting dispatches.

5. **Guidance Over Control**: KeyQuestions, objectionGuidance, escalationRules give workers autonomy within guardrails. Workers aren't robots reading scripts.

## Future Enhancements

- Worker feedback and learning loops
- Multi-turn worker interactions (worker responds, Zeya evaluates, sends follow-up)
- Worker team assignments (multiple workers on one mission)
- Priority and scheduling
- Retry logic with exponential backoff
- Worker capacity and availability tracking
