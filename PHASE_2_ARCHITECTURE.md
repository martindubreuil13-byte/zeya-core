# Phase 2: Experience → Dispatch → Workforce Pipeline

## Overview

Phase 2 connects the visitor Experience layer to the existing workforce architecture, creating a complete pipeline from initial contact through dispatch execution and call outcome tracking.

**Goal:** A visitor completes the Zeya experience and produces a fully operational dispatch package connected to the existing workforce architecture, ready for Telnyx execution.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    VISITOR EXPERIENCE                           │
│  /experience                                                     │
│  - Voice conversation                                           │
│  - Visitor name capture                                         │
│  - Offer capture                                                │
│  - Buyer capture                                                │
│  - Phone capture                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DISPATCH CREATION                             │
│  createDispatchInSupabase()                                      │
│  - Creates dispatch record (status: draft)                       │
│  - Links to user_id for RLS                                     │
│  - Stores visitor, phone, business context                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              WORKER BRIEF GENERATION                            │
│  generateWorkerBrief()                                           │
│  - Creates worker_briefs record                                 │
│  - Embeds key questions, objection guidance, tone               │
│  - Links to dispatch via worker_brief_id                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           EXECUTION PACKAGE GENERATION                          │
│  buildExecutionPackage()                                         │
│  - Standardized contract between Dispatch and Telnyx            │
│  - Contains all context needed for outbound call                │
│  - Status: ready_for_execution = true                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DISPATCH LIFECYCLE                             │
│  transitionDispatchStatus()                                      │
│  draft → queued → calling → answered → completed                │
│  - Each transition creates dispatch_event (audit log)           │
│  - Uses RPC function for atomic updates                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TELNYX ADAPTER                                 │
│  lib/dispatch/adapters/telnyx.ts                                │
│  - createOutboundCall() - initiates call                        │
│  - handleCallAnswered() - prospect picks up                     │
│  - handleCallCompleted() - call ends                            │
│  - handleNoAnswer() - no answer timeout                         │
│  - handleCallFailed() - call failed to place                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 CALL OUTCOME CREATION                           │
│  call_outcomes table                                             │
│  - Stores prospect interaction result                           │
│  - Links to worker_brief_id, dispatch_id                        │
│  - Captures sentiment, objections, next_action                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 MEMORY EVENT CREATION                           │
│  memory_events table                                             │
│  - Stores learnings from call                                   │
│  - Links outcome back to business profile                       │
│  - Enables future adaptation                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema Changes

### New Tables

**dispatch_events** - Immutable event log for dispatch lifecycle
```
id                UUID PRIMARY KEY
dispatch_id       TEXT (references dispatches)
user_id           UUID (references auth.users)
event_type        TEXT (created|queued|calling|answered|no_answer|completed|failed|rescheduled)
message           TEXT
metadata          JSONB
created_at        TIMESTAMPTZ (immutable)
```

### Extended Tables

**dispatches** - Added linkage to workforce layer
```
+ worker_brief_id   TEXT (references worker_briefs)
+ call_outcome_id   UUID (references call_outcomes)
```

**worker_briefs** - Already exists, used as-is
```
id, mission_id, business_id, target_name, target_phone
objective, desired_outcome, company_context, lead_context
key_questions, objection_guidance, escalation_rules
tone_guidance, success_criteria
dynamic_variables, created_at, updated_at
```

**call_outcomes** - Already exists, links to dispatches
```
(existing columns)
+ worker_brief_id      TEXT (added in previous migration)
+ conversation_id      TEXT
+ mission_id           TEXT
+ business_id          UUID
+ target_name          TEXT
+ target_phone         TEXT
```

**memory_events** - Already exists, links to dispatches
```
(existing columns)
+ worker_brief_id      TEXT
+ conversation_id      TEXT
+ outcome_id           TEXT
```

## Core Functions

### Phase 2A: Dispatch Integration

**createDispatchInSupabase()**
- Creates dispatch record with status "draft"
- Inputs: user_id, dispatch_id, visitor_name, phone_number, business_offer, target_buyer, agent_brief
- Returns: dispatch record or null on error
- Automatically creates dispatch_event ("created")

### Phase 2B: Worker Brief Generation

**generateWorkerBrief()**
- Auto-generates WorkerBrief from experience context
- Inputs: businessId, visitorName, businessOffer, targetBuyer, agentBrief, dispatchId
- Returns: {id, mission_id, business_id, objective}
- Creates worker_briefs record with key_questions, objection_guidance, escalation_rules

**linkDispatchToWorkerBrief()**
- Links dispatch record to worker brief
- Updates dispatches.worker_brief_id

### Phase 2C: Execution Package

**buildExecutionPackage()**
- Creates standardized contract for Telnyx
- Inputs: ExecutionPackageInput (dispatch_id, visitor_name, phone_number, etc)
- Returns: TelnyxExecutionPackage with execution_status: "ready"
- No provider-specific logic inside package

**validateExecutionPackage()**
- Validates all required fields present
- Validates phone number format (includes country code)
- Returns: {valid: boolean, errors: string[]}

### Phase 2D: Telnyx Adapter

**validateTelnyxConfiguration()**
- Checks TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_FROM_NUMBER
- Returns: {valid: boolean, missing: string[]}

**createOutboundCall()**
- Currently: Returns mock response with proper structure
- Future: Integrates with Telnyx API to place actual call
- Input: TelnyxExecutionPackage
- Output: OutboundCallResponse {call_control_id, call_session_id, status}

**handleCallAnswered(), handleCallCompleted(), handleNoAnswer(), handleCallFailed()**
- Webhook handlers for Telnyx events
- Update dispatch status via dispatch_lifecycle
- Currently: Stub implementations

**handleWebhook()**
- Main entry point for Telnyx webhooks
- Routes events to appropriate handlers

### Phase 2E: Dispatch Lifecycle

**transitionDispatchStatus()**
- Atomic update: Changes dispatch status + creates dispatch_event
- Uses RPC function: update_dispatch_with_event()
- Every transition is logged as an immutable event

**queueDispatch()**
- Transition: draft → queued

**startDispatchExecution()**
- Transition: queued → calling

**markDispatchAnswered()**
- Transition: calling → answered

**markDispatchNoAnswer()**
- Transition: calling → no_answer

**completeDispatch()**
- Transition: * → completed
- Links call_outcome_id to dispatch

**failDispatch()**
- Transition: * → failed

**getDispatchContext(), getDispatchEvents()**
- Query functions for monitoring and debugging

### Phase 2F: Call Outcome Integration

Uses existing **call_outcomes** table (not created - reused).

When execution finishes:
1. Create call_outcomes record with outcome_type, sentiment, summary
2. Link to dispatch via call_outcome_id
3. Link to worker_brief_id for context
4. Update dispatch status to "completed"

### Phase 2G: Memory Foundation

Uses existing **memory_events** table (not created - reused).

After call completion:
1. Extract learnings from call outcome
2. Create memory_event records with source: "CALL_RESULT"
3. Link to business_id for learning persistence
4. Link to worker_brief_id for context

### Phase 2H: Dispatch Monitor

**DispatchMonitor** React component
- Location: /components/dispatch/DispatchMonitor.tsx
- Displays all dispatches for a user
- Filters by status (draft, queued, calling, answered, completed, failed)
- Shows dispatch_id, visitor_name, phone_number, status, timing
- Polls every 5 seconds for live updates
- Color-coded by status

**Monitor Page**
- Location: /app/monitor/page.tsx
- Authentication required
- Renders DispatchMonitor component

## End-to-End Flow Example

### Step 1: Visitor Completes Experience
```
Visitor visits /experience
- Says name: "Martin"
- Says offer: "Lead generation platform"
- Says buyer: "Freelancers and agencies"
- Zeya emits: [ACTION]{"type":"transition","next":"collect_phone"}[/ACTION]
```

### Step 2: Phone Captured
```
Visitor enters phone: "+1 555 123 4567"
Clicks "Confirm"
```

### Step 3: Dispatch Created
```
createDispatchInSupabase() called with:
{
  user_id: "auth_uuid",
  dispatch_id: "dispatch_1718368000_abc123",
  visitor_name: "Martin",
  phone_number: "+1 555 123 4567",
  business_offer: "Lead generation platform",
  target_buyer: "Freelancers and agencies",
  agent_brief: {...}
}

Result: dispatches record created
- status: "draft"
- created_at: now()
- dispatch_event created: {"event_type": "created"}
```

### Step 4: Worker Brief Generated
```
generateWorkerBrief() called with experience context

Result: worker_briefs record created
- id: "brief_1718368000_xyz789"
- mission_id: "experience_dispatch_1718368000_abc123"
- key_questions: ["What is the main challenge...?", ...]
- objection_guidance: [{objection: "...", response: "..."}]
- escalation_rules: [...]
- tone_guidance: "Be warm and conversational..."
```

### Step 5: Dispatch Linked to Brief
```
linkDispatchToWorkerBrief() called

Result: dispatches.worker_brief_id = "brief_1718368000_xyz789"
```

### Step 6: Execution Package Built
```
buildExecutionPackage() called

Result: TelnyxExecutionPackage
{
  dispatch_id: "dispatch_1718368000_abc123",
  visitor_name: "Martin",
  phone_number: "+1 555 123 4567",
  business_offer: "Lead generation platform",
  target_buyer: "Freelancers and agencies",
  agent_brief: {...},
  execution_status: "ready",
  ready_for_execution: true,
  metadata: {
    created_at: "2026-06-13T...",
    source: "experience_conversation",
    worker_brief_id: "brief_1718368000_xyz789"
  }
}
```

### Step 7: Operator Queues Dispatch
```
queueDispatch() called
- Transition: draft → queued
- dispatch_event created: {"event_type": "queued"}
```

### Step 8: Telnyx Initiates Call
```
createOutboundCall() called with execution_package
- Telnyx places outbound call to "+1 555 123 4567"
- Returns: call_control_id, call_session_id
- startDispatchExecution() transitions: queued → calling
- dispatch_event created: {"event_type": "calling", metadata: {call_control_id: "..."}}
```

### Step 9: Call Answered
```
Telnyx webhook: POST /api/webhooks/telnyx
{type: "call.answered", call_control_id: "..."}

handleCallAnswered() called
- markDispatchAnswered() transitions: calling → answered
- dispatch_event created: {"event_type": "answered"}
- Agent briefing begins
```

### Step 10: Call Completed
```
Telnyx webhook: POST /api/webhooks/telnyx
{type: "call.hangup", call_control_id: "...", duration: 287, transcript: "..."}

handleCallCompleted() called
- Create call_outcomes record:
  {
    worker_brief_id: "brief_1718368000_xyz789",
    target_name: "Martin",
    target_phone: "+1 555 123 4567",
    outcome_type: "completed",
    sentiment: "positive",
    summary: "Prospect interested in demo",
    call_duration_seconds: 287,
    transcript: "...",
    ...
  }
- completeDispatch() called:
  - Transition: answered → completed
  - dispatches.call_outcome_id = outcome_uuid
  - dispatch_event created: {"event_type": "completed"}
```

### Step 11: Memory Event Created
```
After call completion, extract learnings:
- Create memory_event:
  {
    business_id: auth_uuid,
    type: "CALL_RESULT",
    category: "CALL_RESULTS",
    source: "CALL_RESULT",
    worker_brief_id: "brief_1718368000_xyz789",
    newValue: {
      prospect: "Lead gen platform founder",
      interest: "high",
      next_action: "demo_scheduled"
    },
    confidence: 90
  }
```

### Step 12: Monitor Visibility
```
Operator views /monitor page
- Sees dispatch in table:
  {
    dispatch_id: "dispatch_1718368000_abc123",
    visitor_name: "Martin",
    phone_number: "+1 555 123 4567",
    status: "completed",
    created_at: "2026-06-13 08:00:00",
    updated_at: "2026-06-13 08:04:47"
  }
- Click to see full audit trail of dispatch_events
```

## Files Created

1. **supabase/migrations/20260613_dispatch_lifecycle.sql**
   - dispatch_events table
   - extend dispatches (worker_brief_id, call_outcome_id)
   - RPC functions (update_dispatch_with_event, get_dispatch_context)

2. **lib/dispatch/dispatch-lifecycle.ts**
   - transitionDispatchStatus()
   - queueDispatch(), startDispatchExecution(), etc.
   - getDispatchContext(), getDispatchEvents()

3. **lib/dispatch/worker-brief-generator.ts**
   - generateWorkerBrief()
   - linkDispatchToWorkerBrief()
   - updateWorkerBriefWithPhone()

4. **lib/dispatch/execution-package.ts**
   - buildExecutionPackage()
   - validateExecutionPackage()
   - addProviderConfiguration()
   - summarizeExecutionPackage()

5. **lib/dispatch/adapters/telnyx.ts**
   - Telnyx integration (architecture only)
   - validateTelnyxConfiguration()
   - createOutboundCall()
   - handleCallAnswered/Completed/NoAnswer/Failed()
   - handleWebhook()

6. **app/api/webhooks/telnyx/route.ts**
   - POST /api/webhooks/telnyx
   - Routes Telnyx events to adapter

7. **components/dispatch/DispatchMonitor.tsx**
   - React component for dispatch visualization
   - Real-time updates via polling
   - Status filtering and color coding

8. **app/monitor/page.tsx**
   - Dispatch monitor page
   - Authentication required

## Files Modified

1. **app/experience/page.tsx**
   - Import generateWorkerBrief, linkDispatchToWorkerBrief
   - Import buildExecutionPackage
   - Call generateWorkerBrief() after dispatch creation
   - Call linkDispatchToWorkerBrief() after brief creation
   - Build execution package for logging/future dispatch

2. **lib/dispatch/types.ts**
   - Add "draft" to DispatchStatus
   - Add worker_brief_id to TelnyxExecutionPackage.metadata
   - Add from_number to telnyx_config

## Success Criteria

✅ Visitor completes Experience
✅ Dispatch record created with status "draft"
✅ dispatch_event ("created") recorded
✅ Worker brief generated automatically
✅ Dispatch linked to worker brief
✅ Execution package generated (ready_for_execution = true)
✅ All pieces connected via foreign keys
✅ Dispatch visible in monitor at /monitor
✅ Status transitions work atomically
✅ Audit trail complete (dispatch_events)
✅ Call outcomes linkable to dispatch
✅ Memory events linkable to dispatch

## Next Steps (After Phase 2)

1. **Phase 3A: Operator Controls**
   - Button to queue dispatch from monitor
   - Button to cancel dispatch
   - Manual status override with audit

2. **Phase 3B: Telnyx Integration**
   - Implement actual createOutboundCall() with API calls
   - Implement webhook handlers with real status updates
   - Handle retry logic for no answer

3. **Phase 3C: Call Outcome Attachment**
   - Agent can mark outcome type (qualified, not interested, follow up)
   - Store sentiment analysis
   - Extract key insights

4. **Phase 3D: Learning Loop**
   - Analyze patterns across calls
   - Adjust worker brief based on learnings
   - Track what messaging works best

## Environment Variables Required

```
TELNYX_API_KEY=
TELNYX_CONNECTION_ID=
TELNYX_FROM_NUMBER=+1...
```

For development/testing, these are optional - adapter returns mock responses.
