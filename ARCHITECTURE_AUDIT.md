# Zeya Architecture Audit Report

**Date**: June 3, 2026  
**Scope**: Full system audit against product vision  
**Status**: NOT COMMITTED (Phase 12-prep.1-4 not yet in main)

---

## Executive Summary

**Vision Alignment**: ✗ PARTIALLY ALIGNED
- The Phase 12-prep layers (WorkerBrief, ExecutionPlan, Operational Intelligence, CallOutcome) correctly implement the intended "Zeya as operator, Veya as executor" split
- BUT: These layers are completely isolated from the existing Zeya system
- **Critical Issue**: They exist in parallel, not integrated

**Readiness for Twilio**: ✗ NOT READY
- Call outcome capture layer is solid
- But no bridge to receive real Twilio payloads
- No phone number management
- No webhook receiver for post-call events

**Risk Level**: 🔴 HIGH (architectural duplication, disconnected systems)

---

## 1. Architecture Map

### Layer 1: Business Onboarding & Context
**Files**:
- `/lib/onboarding/onboarding-memory.ts` - Captures founder context
- `/lib/onboarding/onboarding-prompt.ts` - Conversation prompts

**Status**: Implemented, uses real-time conversation  
**Flows to**: Workflow state engine, Memory

---

### Layer 2: Business Memory & Learning
**Files**:
- `/lib/memory/memory-types.ts` - Core MemoryEvent type
- `/lib/memory/memory-engine.ts` - Memory operations
- `/lib/memory/memory-persistence.ts` - Supabase persistence
- `/lib/memory/extract-business-memory.ts` - Extract facts from conversations
- `/lib/memory/extract-operational-memory.ts` - Extract operational insights

**Status**: Well-designed, Supabase-integrated  
**Gap**: No code currently creates MemoryEvents from CallOutcomes (my Phase 12-prep.4 outcome)

---

### Layer 3: Mission Definition & Tracking
**Files**:
- `/lib/mission/mission-types.ts` - Mission with hypothesis-validation model
- `/lib/mission/mission-engine.ts` - Mission orchestration
- `/lib/mission/mission-progress.ts` - Track mission progress

**Status**: Implemented with good evidence-based tracking  
**Gap**: No link from Mission → ExecutionPlan creation

---

### Layer 4: Execution Planning (PRE-EXISTING)
**Files**:
- `/lib/orchestration/orchestration-types.ts` - ExecutionPlan, WorkItems, Assignments
- `/lib/orchestration/work-orchestration-engine.ts` - Orchestration engine
- `/lib/execution/execution-types.ts` - ExecutionChannel, ExecutionRequest

**Status**: Implemented in /lib/orchestration/  
**Problem**: ⚠️ DUPLICATION - I created new ExecutionPlan in /lib/execution-plans/

---

### Layer 5: Operational Intelligence (NEW - Phase 12-prep.3)
**Files**:
- `/lib/operational-intelligence/operational-intelligence-analyzer.ts` - Intent inference
- `/lib/operational-intelligence/operational-plan-builder.ts` - Creates ExecutionPlan from analysis
- `/lib/operational-intelligence/operational-brief-builder.ts` - Creates WorkerBriefs from plan

**Status**: Implemented, working, but ISOLATED (test endpoint only)  
**Issue**: ⚠️ Doesn't read from actual missions or use existing ExecutionRequest

---

### Layer 6: WorkerBrief Generation (NEW - Phase 12-prep.1)
**Files**:
- `/lib/workers/worker-brief-types.ts` - WorkerBrief type
- `/lib/workers/worker-brief-builder.ts` - buildWorkerBrief()
- `/lib/workers/worker-selector.ts` - selectWorkerForBrief() - hardcoded to Veya
- `/lib/workers/worker-dispatcher.ts` - dispatchWorkerBrief() - simulated only

**Status**: Implemented, but SIMULATED ONLY  
**Issue**: ⚠️ No real dispatch to Twilio, no integration with real Veya agent

---

### Layer 7: Worker Execution
**Files**:
- `/lib/voice/voice-service.ts` - ElevenLabs WebRTC setup
- `/lib/voice/elevenlabs.ts` - ElevenLabs client
- **NO FILE**: Worker agent execution (Veya) doesn't exist yet

**Status**: ElevenLabs infrastructure exists, but NO AGENT IMPLEMENTATION  
**Critical Gap**: Veya agent doesn't exist - only simulated

---

### Layer 8: Call Outcome Capture (NEW - Phase 12-prep.4)
**Files**:
- `/lib/call-outcomes/call-outcome-types.ts` - CallOutcome type
- `/lib/call-outcomes/call-outcome-simulator.ts` - simulateCallOutcome()
- `/lib/call-outcomes/call-outcome-aggregator.ts` - aggregateCallOutcomes()

**Status**: Implemented, working, fully SIMULATED  
**Gap**: No connection to Twilio webhooks, no real outcome capture

---

### Layer 9: Learning & Memory Feedback
**Files**:
- `/lib/learning/mission-debrief.ts` - Mission analysis after execution
- **NO FILE**: CallOutcome → MemoryEvent conversion doesn't exist

**Status**: Partial  
**Critical Gap**: I created CallOutcome structure but no code converts it to MemoryEvent for learning

---

### Layer 10: Provider Boundary (Twilio/ElevenLabs)
**Status**: ❌ NOT DEFINED

**What's Missing**:
- [ ] Phone number management
- [ ] Outbound call initiation
- [ ] Call status webhook receiver
- [ ] Transcript ingestion from Twilio
- [ ] Post-call data parsing
- [ ] Error handling for provider failures

---

## 2. End-to-End Flow Integrity

### Intended Flow
```
Business Context
→ Mission Creation
→ Operational Intelligence Analysis
→ ExecutionPlan
→ WorkerBrief
→ Worker Selection
→ Dispatch
→ CallOutcome
→ Outcome Intelligence / Learning Signals
→ Memory Update
→ Mission Iteration
```

### Actual Flow (Reality Check)

#### ✓ Working Links
1. **Onboarding → Memory**: Founder conversation → MemoryEvent ✓
2. **Memory → Mission**: Memory read into mission context ✓
3. **Workflow → Memory**: Conversation extraction → MemoryEvent ✓

#### ⚠️ Simulated/Disconnected Links
1. **Mission → Analysis**: No real code; test endpoint accepts missionId directly
2. **Analysis → ExecutionPlan**: Test endpoint only; doesn't read real mission
3. **ExecutionPlan → WorkerBrief**: Implemented but never calls with real plan
4. **WorkerBrief → Dispatch**: Simulated only; no real Twilio call
5. **Dispatch → CallOutcome**: Simulated; no real call result
6. **CallOutcome → MemoryEvent**: NO CODE EXISTS

#### ❌ Missing Links
1. **Actual Mission → Actual OperationalIntelligence** - No trigger
2. **Actual ExecutionRequest → My ExecutionPlan** - Two different types
3. **Real CallOutcome ← Twilio webhook** - No webhook handler
4. **Learning loop closure** - No feedback to mission

#### ⚠️ Dead-End Modules
- `/lib/autonomy/` - Operates in a separate loop (Phase 10)
- `/lib/orchestration/` - Has its own ExecutionPlan, not connected to my layer
- `/lib/workforce/` - Defines WorkforceMember but WorkerBrief doesn't use it

---

## 3. Conceptual Clarity Check

### Zeya vs Veya Separation
✓ **CLEAR**: WorkerBrief architecture correctly separates Zeya (planner) from Veya (executor)
- Zeya generates WorkerBrief
- Veya executes (simulated currently)
- Clean responsibility boundary

### Mission vs ExecutionPlan
⚠️ **BLURRED**: Two different ExecutionPlan types exist:
1. `/lib/orchestration/orchestration-types.ts` - ExecutionPlan with WorkItems and Assignments
2. `/lib/execution-plans/execution-plan-types.ts` - My ExecutionPlan with ExecutionPlanSteps

These have different structures and aren't compatible. **This will cause problems in Phase 12A.**

### ExecutionPlan vs WorkerBrief
✓ **CLEAR**: ExecutionPlan (multiple targets, multiple steps) → WorkerBrief (single worker, single objective per step) ✓

### Dispatch Result vs CallOutcome
⚠️ **CONFUSED**:
- `ExecutionResult` exists in `/lib/execution/execution-types.ts` - simple `{requestId, success, outcome}`
- My `CallOutcome` is much more detailed (sentiment, insights, objections, duration, etc.)
- These serve different purposes but same role

---

## 4. Data Model Consistency

### Critical Naming Issues

| Concept | Files Using It | ID Field Name | Problem |
|---------|---|---|---|
| Execution Plan | `/lib/execution/`, `/lib/orchestration/`, `/lib/execution-plans/` | `id` vs `planId` | INCONSISTENT |
| Work Item | `/lib/orchestration/`, `/lib/workforce/`, `/lib/execution-plans/` | `id` vs `stepId` vs `workItemId` | INCONSISTENT |
| Worker Brief | `/lib/workers/` | `id` | Not referenced by ExecutionPlanStep |
| Call Outcome | `/lib/call-outcomes/` | `id` | Not linked to WorkerBrief properly |
| Memory Event | `/lib/memory/` | `id` | No CallOutcome creates these |

### Key Missing Fields

**ExecutionPlanStep** (my layer):
- ✓ Has `stepId`, `planId`, `workerType`, `objective`, `target`
- ✗ Missing: Direct reference to WorkerBrief (should be created FROM step)
- ✗ Missing: Link to actual mission leads/contacts

**WorkerBrief** (my layer):
- ✓ Has `id`, `missionId`, `executionPlanId`, `workerBriefId`
- ✗ Missing: Lead/prospect reference fields (should have leadId, leadEmail, leadPhone)
- ✗ Missing: Link back to ExecutionPlanStep that created it

**CallOutcome** (my layer):
- ✓ Has `id`, `missionId`, `workerBriefId`, `targetName`, `targetPhone`
- ✗ Missing: executionPlanId (which step did this outcome belong to?)
- ✗ Missing: Link to actual lead record from database
- ✗ Missing: timestamp for when call was made (only has createdAt)

---

## 5. Provider Readiness (Twilio/ElevenLabs)

### Twilio Readiness: ❌ NOT READY

**Missing**:
- [ ] Phone number registration/validation
- [ ] Outbound call API handler
- [ ] Call status webhook receiver (`POST /api/twilio/webhook`)
- [ ] Call metadata parser (duration, status, participant info)
- [ ] Post-call transcript receiver
- [ ] Rate limiting / backoff strategy
- [ ] Number validation (E.164 format)
- [ ] Error handling (invalid number, call failed, etc.)
- [ ] Retry logic for failed calls
- [ ] Call logging for audit trail

**Where it plugs in**:
```
dispatchWorkerBrief() currently:
  - Returns simulated outcome
  
Should become:
  - Call Twilio API to initiate call
  - Poll/webhook for call completion
  - Parse Twilio result → CallOutcome
  - Handle errors → failed CallOutcome
```

### ElevenLabs Readiness: ⚠️ PARTIAL

**Existing**:
- ✓ Voice service exists
- ✓ WebRTC integration
- ✓ Session management

**Missing**:
- [ ] Dynamic variables integration (`WorkerBrief.dynamicVariables` → ElevenLabs template variables)
- [ ] Script generation from WorkerBrief guidance
- [ ] Transcript extraction from call
- [ ] Sentiment analysis from transcript
- [ ] Call recording storage

**Where it plugs in**:
```
dispatchWorkerBrief() should:
  - Pass WorkerBrief.dynamicVariables to ElevenLabs
  - Generate prompt from WorkerBrief.keyQuestions + objectionGuidance
  - Capture transcript from ElevenLabs session
  - Extract sentiment/insights from transcript → CallOutcome
```

### Post-Call Webhook Integration: ❌ MISSING

**Needed**:
- [ ] `POST /api/twilio/webhook` - Receive call completion event
- [ ] `POST /api/elevenlab/transcript` - Receive transcript
- [ ] Validate webhook signature
- [ ] Parse provider payload → standard format
- [ ] Trigger CallOutcome creation
- [ ] Trigger MemoryEvent creation
- [ ] Update mission progress

---

## 6. Risks and Over-Engineering

### 🔴 CRITICAL RISKS

**1. Architectural Duplication**
- Risk: Two ExecutionPlan types will cause confusion and bugs
- Location: `/lib/orchestration/` vs `/lib/execution-plans/`
- Impact: Phase 12A integration will be unclear about which to use
- Recommendation: Decide which to keep, merge or deprecate the other

**2. Isolated Test System**
- Risk: Phase 12-prep layers work in isolation; no real data flow
- Location: All test routes use in-memory data
- Impact: Real Twilio integration won't work without rewiring
- Recommendation: Must add database queries to read real missions/leads

**3. Missing CallOutcome → MemoryEvent Bridge**
- Risk: Execution results never feed into learning system
- Location: No code in `/lib/call-outcomes/` creates MemoryEvent
- Impact: Closed-loop learning won't work
- Recommendation: Add `createMemoryEventFromCallOutcome()` before Phase 12A

**4. Veya Agent Doesn't Exist**
- Risk: WorkerBrief dispatches to non-existent Veya
- Location: `/lib/workers/worker-dispatcher.ts` simulates only
- Impact: Can't make real calls
- Recommendation: Must implement Veya agent (or defer to Phase 12A)

---

### 🟡 MODERATE RISKS

**5. Data Model Inconsistency**
- Risk: Field naming (stepId vs workItemId, planId vs id) causes integration bugs
- Recommendation: Standardize before Phase 12A

**6. Missing Lead/Contact References**
- Risk: WorkerBrief and CallOutcome don't properly link to actual contacts
- Recommendation: Add leadId, prospectId fields

**7. No Real Provider Boundaries**
- Risk: Unclear where Twilio/ElevenLabs code should go
- Recommendation: Define provider API layer before implementation

---

### 🟢 GOOD PATTERNS (Don't Change)

**✓ WorkerBrief is well-designed**
- Clear separation of concerns
- Good use of dynamicVariables for provider integration
- Realistic outcome distribution for simulation

**✓ Operational Intelligence layer is solid**
- Deterministic intent inference
- Good quality objection/escalation guidance
- Ready for future learning-based improvements

**✓ Memory and MemoryEvent are well-designed**
- Clean event-based model
- Good for audit trails
- Ready for historical analysis

---

## 7. Gaps Before Phase 12A

### Must-Have Before Real Twilio Calls

| Item | File/Location | Status | Priority |
|------|---|---|---|
| Phone number handling | `/lib/workers/` or `/lib/call-outcomes/` | ❌ Missing | P0 |
| CallOutcome → MemoryEvent | `/lib/call-outcomes/` | ❌ Missing | P0 |
| Twilio API handler | `/app/api/twilio/` | ❌ Missing | P0 |
| Twilio webhook receiver | `/app/api/twilio/webhook` | ❌ Missing | P0 |
| Mission → Analysis trigger | `/app/api/zeya/` or `/lib/mission/` | ❌ Missing | P0 |
| Real lead reading | `/lib/execution-plans/` | ❌ Missing (test only) | P0 |
| Database queries in builders | `/lib/execution-plans/`, `/lib/workers/` | ❌ Missing | P0 |

### Nice-to-Have Before Phase 12A

| Item | File/Location | Status |
|------|---|---|
| ExecutionPlan type consolidation | `/lib/orchestration/` vs `/lib/execution-plans/` | ⚠️ Needs decision |
| Call logging | `/app/api/twilio/` | ❌ Missing |
| Rate limiting | `/app/api/twilio/` | ❌ Missing |
| Retry logic | `/lib/workers/` | ❌ Missing |
| Error handling | All layers | Partial |

---

## 8. End-to-End Data Flow: Reality vs Intention

### What I Built (Phase 12-prep)
```
TestInput
  ↓
analyzeOperationalMission()
  ↓
buildExecutionPlanFromOperationalAnalysis()
  ↓
createWorkerBriefsFromOperationalAnalysis()
  ↓
selectWorkerForBrief()
  ↓
dispatchWorkerBrief() [SIMULATED]
  ↓
simulateCallOutcome()
  ↓
[ENDS HERE - No MemoryEvent creation]
```

### What Should Flow (Real System)
```
RealMission (from DB)
  ↓
analyzeOperationalMission() [NEEDS: Read mission from DB]
  ↓
ExecutionPlan [NEEDS: Use existing orchestration or new plan]
  ↓
WorkerBriefs [NEEDS: Read actual leads, not test data]
  ↓
Dispatch to Twilio [NEEDS: Real phone number, API integration]
  ↓
Twilio Call [NEEDS: Veya agent implementation]
  ↓
Twilio Webhook → CallOutcome [NEEDS: Webhook handler]
  ↓
createMemoryEventFromCallOutcome() [NEEDS: Implementation]
  ↓
MemoryEvent persisted to Supabase [NEEDS: Write to DB]
  ↓
Mission updated with evidence [NEEDS: Mission update logic]
```

---

## 9. Recommended Next Phase

### CRITICAL DECISION FIRST
Before ANY coding, resolve:
1. **ExecutionPlan consolidation**: Keep `/lib/orchestration/ExecutionPlan` OR `/lib/execution-plans/ExecutionPlan`?
2. **Veya implementation**: Build full Veya agent NOW, or defer to Phase 12A?

### If keeping Phase 12-prep architecture:

### RECOMMENDED NEXT PHASE: **Provider Interface Layer**

**Goal**: Create the bridge between Zeya/Veya logic and real Twilio/ElevenLabs

**Work**:
1. Define provider interface:
   ```
   /lib/providers/provider-interface.ts
     - makeCall(brief, phone): Promise<CallOutcome>
     - simulateCall(brief, phone): Promise<CallOutcome>
     - registerPhoneNumber(number): Promise<bool>
   ```

2. Implement Twilio adapter:
   ```
   /lib/providers/twilio-adapter.ts
     - Call Twilio API
     - Handle call status
     - Parse call metadata
     - Return CallOutcome
   ```

3. Implement Twilio webhook:
   ```
   /app/api/twilio/webhook/route.ts
     - Receive call completion
     - Create CallOutcome
     - Trigger memory events
   ```

4. Add database queries:
   ```
   /lib/execution-plans/db-queries.ts
     - readMissionLeads(missionId)
     - readMissionContext(missionId)
     - createDispatchLog(brief, result)
   ```

5. Add MemoryEvent creation:
   ```
   /lib/call-outcomes/create-memory-event.ts
     - CallOutcome → MemoryEvent
     - Link to mission
   ```

**Effort**: 3-4 days  
**Risk**: Medium (provider integration always has surprises)  
**Payoff**: Everything works end-to-end with real data  

**Files involved**:
- `/lib/providers/` (NEW)
- `/lib/call-outcomes/` (ADD memory bridge)
- `/lib/execution-plans/` (ADD DB queries)
- `/app/api/twilio/` (NEW webhook)
- `/app/api/zeya/` (ADD mission trigger)

---

## Summary of Audit Findings

| Category | Status | Risk | Action |
|----------|--------|------|--------|
| **Conceptual Design** | ✓ Good | Low | Keep as-is |
| **Phase 12-prep Implementation** | ✓ Working | Low | Keep as-is |
| **Architect Duplication** | ⚠️ Issue | High | Consolidate ExecutionPlan types |
| **System Integration** | ❌ Missing | Critical | Add provider layer before Phase 12A |
| **Data Model** | ⚠️ Gaps | Medium | Add field references (leadId, etc.) |
| **Provider Readiness** | ❌ Not Ready | Critical | Build provider interface layer |
| **End-to-End Flow** | ⚠️ Partial | Medium | Add missing bridges (MemoryEvent, webhooks) |
| **Learning Loop** | ❌ Missing | High | Add CallOutcome → MemoryEvent |

---

## Final Recommendation

✅ **Keep all Phase 12-prep code** - It's well-designed and correct  
⚠️ **DO NOT move to Phase 12A yet** - Missing critical bridges  
🔴 **DO NOT commit Phase 12-prep until** provider layer is planned  

**Next Phase**: Build Provider Interface Layer (makes real Twilio/ElevenLabs possible)
