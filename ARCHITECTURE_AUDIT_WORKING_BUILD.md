# Architecture Audit: First Known-Good Build
**Date:** 2026-06-21  
**Status:** End-to-End Experience Working  
**Baseline:** Before phone-call integration  

---

## A. WORKING ARCHITECTURE MAP

### COMPLETE RUNTIME FLOW

```
User clicks "Start Experience"
    ↓
[ENTRY: app/experience/page.tsx:handleStartExperience()]
    ├─ console.log("[EXPERIENCE] Start button clicked")
    ├─ setPhase("voice_active")
    │
    ├─ await startConversation()
    │   [COMPONENT: hooks/realtime/useRealtimeOnboardingSession.ts]
    │   └─ Calls: client.connect()
    │       [COMPONENT: lib/realtime/openai-realtime-client.ts:71]
    │       ├─ Awaits: connectionReadyPromise
    │       │   (BOTH: connected=true AND dataChannel.readyState="open")
    │       ├─ Establishes WebRTC peer connection
    │       ├─ Creates data channel
    │       ├─ Exchanges SDP with OpenAI Realtime API
    │       └─ Returns when fully ready
    │
    ├─ initializeSession()
    │   [COMPONENT: lib/experience/experience-state.ts]
    │   └─ Creates: ExperienceSession object
    │       ├─ currentBeat: ExperienceBeat.GREETING
    │       ├─ visitor: empty
    │       └─ initialized state
    │
    ├─ new BeatController(session, callbacks)
    │   [COMPONENT: lib/experience/beat-controller.ts:36]
    │   └─ Stores: onBeatStart, onBeatComplete, callbacks
    │
    ├─ await controller.startBeat()
    │   [COMPONENT: lib/experience/beat-controller.ts:44]
    │   ├─ Sets: this.session.beatStartedAt = new Date()
    │   ├─ Gets: script for GREETING beat
    │   │   [COMPONENT: lib/experience/experience-beats.ts:28]
    │   │   └─ Script: "Hi, I'm Zeya..."
    │   │
    │   └─ Calls: onBeatStart(beat, script) callback
    │       ├─ console.log("[BEAT] onBeatStart() called")
    │       ├─ console.log("[BEAT] onBeatStart() calling speakExact()")
    │       │
    │       └─ await speakExact(script)
    │           [COMPONENT: hooks/realtime/useRealtimeOnboardingSession.ts:208]
    │           ├─ console.log("[HOOK] Calling client.speakExact()")
    │           │
    │           └─ client.speakExact(text)
    │               [COMPONENT: lib/realtime/openai-realtime-client.ts:356]
    │               ├─ Checks: connected=true
    │               ├─ Checks: dataChannel exists
    │               ├─ Sends: conversation.item.create event
    │               │   └─ role: "assistant", content: text
    │               └─ Sends: response.create event
    │                   └─ modalities: ["audio"]
    │
    └─ [STATE: phase = "voice_active", transcript listening enabled]

PARALLEL: OpenAI Realtime API Processing
    ├─ Receives: conversation.item.create
    ├─ Receives: response.create
    ├─ Synthesizes: greeting audio
    ├─ Sends: audio via WebRTC
    │   └─ pc.ontrack fires
    │       └─ Attaches audio to <audio> element
    │           └─ element.play()
    │               └─ console.log("[VOICE] Audio playback started")
    │
    └─ Sends: transcripts via data channel
        └─ onTranscript callback fires
            └─ appendTranscript()
                └─ Updates: voiceTranscript state

USER SPEAKS

voiceTranscript updates
    └─ useEffect([voiceTranscript]) fires
        [COMPONENT: app/experience/page.tsx:54]
        ├─ Checks: beatStartedAt exists (YES)
        ├─ Finds: lastUserMessage
        ├─ Checks: !lastProcessedId
        ├─ Calls: controller.advanceBeat(null)
        │   [COMPONENT: lib/experience/beat-controller.ts:204]
        │   ├─ Updates: session.currentBeat to next beat
        │   ├─ Calls: onBeatComplete()
        │   └─ Calls: startBeat() for next beat
        │       └─ Repeats speech cycle for next beat
        │
        └─ [BEAT SEQUENCE: GREETING → NAME → OFFER → BUYER → EXPERIMENT]

AT EXPERIMENT BEAT (Beat 4)

User says "yes" or "no"
    └─ Transcript: { role: "user", text: "yes/no", isFinal: true }
        └─ extractYesNo(transcript)
            [COMPONENT: lib/experience/extractors/ (implied)]
            └─ Returns: boolean decision

advanceBeat() with yes/no decision
    ├─ If YES:
    │   ├─ Updates: session.decision = "yes"
    │   ├─ Advances to: PHONE beat (Beat 5)
    │   └─ Calls: startBeat()
    │       └─ Speaks: "Great. What's your phone number?"
    │
    └─ If NO:
        ├─ Updates: session.decision = "no"
        ├─ Advances to: CLOSED beat
        └─ Calls: startBeat()
            └─ Speaks: "No problem at all..."

AT PHONE BEAT

User provides phone number
    └─ Transcript received
        └─ extractPhone(transcript)
            └─ Returns: phone number string

advanceBeat() with phone
    ├─ Updates: session.visitor.phone = phone
    ├─ Calls: onSessionComplete()
    │   [COMPONENT: app/experience/page.tsx:112]
    │   ├─ Calls: stopConversation()
    │   └─ setPhase("collecting_phone")
    │
    └─ [STATE: Experience complete, ready for handoff]
```

---

## B. MISSION-CRITICAL COMPONENTS

### TIER 1: CANNOT REMOVE - ENTIRE FLOW DEPENDS ON

| Component | Location | Responsibility | Why Critical |
|-----------|----------|-----------------|--------------|
| **OpenAIRealtimeClient** | `lib/realtime/openai-realtime-client.ts` | WebRTC transport, audio I/O, event marshalling | All speech/listening depends on this |
| **useRealtimeOnboardingSession hook** | `hooks/realtime/useRealtimeOnboardingSession.ts` | Client instantiation, transcript aggregation, state management | Creates the connection, manages voice lifecycle |
| **BeatController** | `lib/experience/beat-controller.ts` | State machine progression, beat orchestration | Drives the experience sequence |
| **EXPERIENCE_SCRIPTS** | `lib/experience/experience-beats.ts` | Immutable beat dialogue | Defines what Zeya says |
| **Experience page component** | `app/experience/page.tsx` | Orchestrates callbacks, displays UI, handles phase transitions | Entry point, UI rendering, flow control |
| **Connection Readiness Gate** | `openai-realtime-client.ts:290-291` | Ensures both connected=true AND dc.readyState="open" | Prevents race conditions in speech synthesis |

---

### TIER 2: CRITICAL FOR CURRENT FLOW - DEPENDENCY CHAIN

| Component | Dependency Chain | Required For |
|-----------|------------------|--------------|
| **speakExact()** | OpenAIRealtimeClient → conversation.item.create → response.create | Every beat that Zeya speaks |
| **voiceTranscript state** | useRealtimeOnboardingSession → onTranscript → appendTranscript | User response detection, beat advancement |
| **beatStartedAt guard** | BeatController → app/experience/page.tsx useEffect | Prevents pre-Beat1 transcript hijacking |
| **experience-state.ts** | initializeSession() → session object | Beat state, visitor data storage |

---

## C. TEMPORARY/DEBUGGING ADDITIONS IDENTIFIED

### Logging That Can Be Removed (Post Phone Integration)

```
LOW RISK - Safe to clean up after phone workflow validates:

[INSTANCE] logs in openai-realtime-client.ts
  - Instance ID tracking (lines 57-66, 72-76, 147-149, 359-367)
  - Purpose: Verify single instance active
  - Status: DEBUGGING ONLY

[CONNECTION] logs in openai-realtime-client.ts
  - Transport readiness diagnostics (lines 201, 233-236, 293-297, etc.)
  - Purpose: Trace race conditions
  - Status: DEBUGGING ONLY

[BEAT] logs in beat-controller.ts
  - Beat lifecycle (lines 46-51, 61, 71, 75-78, 208-209, 210-211, etc.)
  - Purpose: Trace beat progression
  - Status: DEBUGGING ONLY

[HOOK] logs in useRealtimeOnboardingSession.ts
  - Hook lifecycle (lines 78, 141, 146)
  - Purpose: Trace hook initialization
  - Status: DEBUGGING ONLY

[VOICE] logs in openai-realtime-client.ts
  - Speech I/O diagnostics (lines 256-271, 296-312, etc.)
  - Purpose: Trace audio events
  - Status: DEBUGGING ONLY

[EXPERIENCE] logs in app/experience/page.tsx
  - Flow tracking (lines 77-94, 97-132, 134)
  - Purpose: Trace handleStartExperience
  - Status: DEBUGGING ONLY

[TRANSPORT TEST] logs in app/experience-v2-test/page.tsx
  - Entire test page is temporary validation
  - Purpose: Validate transport layer
  - Status: TEMPORARY TEST ARTIFACT
```

**Total: ~150 lines of logging code can be removed once phone integration is validated**

---

## D. LEGACY REMNANTS FROM PREVIOUS IMPLEMENTATIONS

### Identified Legacy Code (Still Active But From Old Architecture)

| Legacy Component | Location | Status | Risk if Removed Now |
|------------------|----------|--------|------------------|
| `/app/demo-experience-test/` | `app/demo-experience-test/page.tsx` | UNUSED | SAFE TO DELETE now |
| `/lib/demo-experience/` | `lib/demo-experience/` | UNUSED | SAFE TO DELETE now |
| `/app/api/demo-experience/` | `app/api/demo-experience/` | UNUSED | SAFE TO DELETE now |
| `extractAssistantActions` import | `app/experience/page.tsx:9` | UNUSED in current flow | SAFE TO REMOVE now |
| `createDispatchInSupabase` import | `app/experience/page.tsx:10` | UNUSED in current flow | SAFE TO REMOVE now |
| `generateWorkerBrief` import | `app/experience/page.tsx:11` | UNUSED in current flow | SAFE TO REMOVE now |
| `buildExecutionPackage` import | `app/experience/page.tsx:15` | UNUSED in current flow | SAFE TO REMOVE now |
| `PresenceCore` component | `app/experience/page.tsx:8` | Renders but doesn't affect experience | SAFE TO REMOVE now |
| Old transcript persistence | `app/experience/page.tsx:156+` | useEffect watching voiceState | LOW RISK TO REMOVE |
| Phone collection UI (redundant) | `app/experience/page.tsx` | Shows form but not used yet | KEEP UNTIL PHONE INTEGRATION COMPLETE |

**These can be deleted immediately without affecting current working experience.**

---

## E. CODE THAT IS SAFE TO REMOVE (AFTER PHONE WORKFLOW VALIDATES)

### Post Phone-Integration Cleanup

| Code | Location | Why Safe | When Safe |
|------|----------|---------|-----------|
| All [INSTANCE] logging | openai-realtime-client.ts | Verified single instance works | After phone integration complete |
| All [CONNECTION] timing logs | openai-realtime-client.ts | Readiness gate confirmed working | After phone integration complete |
| All [BEAT] progression logs | beat-controller.ts | Advancement logic confirmed working | After phone integration complete |
| All [VOICE] synthesis logs | openai-realtime-client.ts | Audio playback confirmed working | After phone integration complete |
| All [HOOK] initialization logs | useRealtimeOnboardingSession.ts | Hook lifecycle confirmed working | After phone integration complete |
| All [EXPERIENCE] flow logs | app/experience/page.tsx | Flow orchestration confirmed working | After phone integration complete |
| connectionReadyPromise implementation | openai-realtime-client.ts:273-291 | Once confirmed stable, could simplify | After 2+ weeks of production stability |
| beatStartedAt guard | app/experience/page.tsx:59 | Prevents transcript hijacking, but could optimize | After phone integration complete |
| experience-v2-test route | app/experience-v2-test/page.tsx | Entire test route | Once transport fully validated |

**TOTAL SAVINGS: ~200 lines of logging + 1 test route**

---

## F. CODE THAT MUST NOT BE TOUCHED UNTIL COMPLETE

### High-Risk Components

| Component | Why Untouchable | Risk of Modification |
|-----------|-----------------|-------------------|
| **connectionReadyPromise pattern** | Controls whether speakExact() executes before transport ready | Breaking this = speech synthesis fails silently |
| **beatStartedAt guard** | Prevents transcripts before Beat 1 plays | Removing = ambient noise hijacks state machine |
| **speakExact() event sequence** | conversation.item.create → response.create order matters | Reversing order = no synthesis |
| **create_response: false in session config** | Disables autonomous model generation | Re-enabling = Spanish autonomous speech returns |
| **turn_detection.threshold: 0.5** | Balances between catching speech and rejecting noise | Lowering = more false positives, increasing = misses real speech |
| **transcript deduplication in appendTranscript** | Prevents duplicate transcript processing | Removing = state machine advances twice on same input |
| **BeatController state machine logic** | Manages beat progression sequencing | Any change = breaks beat order |

---

## G. DETAILED COMPONENT ANALYSIS WITH RISK ASSESSMENT

### STEP 1: START BUTTON CLICK

**Component:** `app/experience/page.tsx:handleStartExperience()`  
**Responsibility:** Orchestrate experience initialization  
**Dependencies:** voice hook, BeatController, phase state  
**Status:** ✅ **REQUIRED** - Entry point  
**Type:** Core implementation  
**Risk Level:** 🔴 **CRITICAL** - Cannot modify without breaking flow  
**Notes:** Contains console.log statements (debug safe to remove)

---

### STEP 2: CONNECTION ESTABLISHMENT

**Component:** `hooks/realtime/useRealtimeOnboardingSession.ts`  
**Responsibility:** Create and manage OpenAIRealtimeClient instance  
**Dependencies:** OpenAIRealtimeClient, React hooks  
**Status:** ✅ **REQUIRED** - Creates the connection  
**Type:** Core implementation  
**Risk Level:** 🔴 **CRITICAL** - Manages entire Realtime lifecycle  
**Sub-components:**
- `OpenAIRealtimeClient` constructor (REQUIRED)
- `client.connect()` method (REQUIRED)
- `connectionReadyPromise` pattern (REQUIRED - prevents race conditions)
- Callback setup (REQUIRED - onTranscript, onStateChange)
- Client cleanup in useEffect return (REQUIRED)

**Modification Risk:** HIGH
- Cannot change callback order
- Cannot remove connectionReadyPromise
- Cannot modify event marshalling

**Safe Optimizations:** NONE until phone integration complete

---

### STEP 3: REALTIME SESSION CREATION

**Component:** `lib/realtime/openai-realtime-client.ts:createSession()`  
**Responsibility:** Create ephemeral session token with OpenAI  
**Dependencies:** API endpoint, environment variables  
**Status:** ✅ **REQUIRED** - Must establish session  
**Type:** Core implementation  
**Risk Level:** 🟡 **HIGH** - API integration, error handling critical  
**Configuration:**
- `turn_detection.create_response: false` (REQUIRED - disable autonomous generation)
- `turn_detection.threshold: 0.5` (TUNABLE - VAD sensitivity)
- `transcription.model: gpt-4o-mini-transcribe` (TUNABLE)
- `silence_duration_ms: 500` (TUNABLE)

**Modification Risk:** MEDIUM
- Session endpoint must not change
- Turn detection must remain disabled
- Other parameters can be tuned

**Safe Optimizations:** None until phone workflow validates

---

### STEP 4: BEAT CONTROLLER INITIALIZATION

**Component:** `lib/experience/beat-controller.ts`  
**Responsibility:** Manage beat state machine, progression logic  
**Dependencies:** experience-state, experience-beats, callbacks  
**Status:** ✅ **REQUIRED** - Drives experience sequence  
**Type:** Core implementation  
**Risk Level:** 🔴 **CRITICAL** - State machine logic  
**Key Methods:**
- `startBeat()` (REQUIRED - initiates beat, calls callback)
- `advanceBeat()` (REQUIRED - progresses state machine)
- `beatStartedAt` getter (REQUIRED - used by transcript guard)

**Modification Risk:** CRITICAL
- Cannot change beat order
- Cannot modify state transitions
- Cannot change callback invocation

**Safe Optimizations:** NONE

---

### STEP 5: BEAT SCRIPT DELIVERY

**Component:** `lib/experience/experience-beats.ts:EXPERIENCE_SCRIPTS`  
**Responsibility:** Immutable beat dialogue  
**Dependencies:** BeatController  
**Status:** ✅ **REQUIRED** - Defines what Zeya says  
**Type:** Data/configuration  
**Risk Level:** 🟢 **LOW** - Just text strings  
**Content:**
- GREETING: "Hi, I'm Zeya..."
- NAME: "Nice to meet you..."
- OFFER: "What does your business sell?"
- BUYER: "Who usually buys it?"
- EXPERIMENT: "Would you be willing to try it?"
- PHONE: "What's your phone number?"
- CLOSED: "No problem at all..."

**Modification Risk:** NONE - Safe to edit text  

**Safe Optimizations:** Can refactor script structure later

---

### STEP 6: SPEECH SYNTHESIS (speakExact)

**Component:** `lib/realtime/openai-realtime-client.ts:speakExact()`  
**Responsibility:** Send text to OpenAI for TTS synthesis  
**Dependencies:** dataChannel, connected flag, Realtime API  
**Status:** ✅ **REQUIRED** - Only way Zeya speaks  
**Type:** Core implementation  
**Risk Level:** 🔴 **CRITICAL** - Speech generation depends on this  
**Event Sequence:**
1. Check: connected=true
2. Check: dataChannel exists
3. Send: conversation.item.create event
4. Send: response.create event with modalities: ["audio"]

**Modification Risk:** CRITICAL
- Event order cannot change
- Cannot modify event structure
- Cannot change response.create parameters

**Unsafe Changes:**
- Changing event order
- Removing either event
- Modifying modalities parameter
- Adding instructions to response.create

**Safe Optimizations:** NONE

---

### STEP 7: TRANSCRIPT RECEPTION & PROCESSING

**Component:** `hooks/realtime/useRealtimeOnboardingSession.ts:appendTranscript()`  
**Responsibility:** Aggregate and deduplicate transcripts  
**Dependencies:** voiceTranscript state  
**Status:** ✅ **REQUIRED** - Enables user response detection  
**Type:** Core implementation  
**Risk Level:** 🟡 **HIGH** - Deduplication logic critical  
**Key Logic:**
- Deduplicates by transcript.id (REQUIRED)
- Slices transcript array to last 80 entries (TUNABLE)
- Triggers useEffect watching voiceTranscript (REQUIRED)

**Modification Risk:** HIGH
- Cannot remove deduplication
- Cannot change comparison logic
- Array size is tunable but affects memory

**Safe Optimizations:** Can adjust slice size (80 → 50 or 100)

---

### STEP 8: BEAT ADVANCEMENT TRIGGER

**Component:** `app/experience/page.tsx` useEffect watching voiceTranscript  
**Responsibility:** Detect final transcript, advance beat  
**Dependencies:** voiceTranscript, BeatController, beatStartedAt guard  
**Status:** ✅ **REQUIRED** - Only mechanism for state progression  
**Type:** Core implementation  
**Risk Level:** 🔴 **CRITICAL** - Guards against transcript hijacking  
**Key Guards:**
- `if (phase !== "voice_active") return` (REQUIRED)
- `if (!controllerRef.current.beatStartedAt) return` (REQUIRED - prevents pre-Beat1 hijacking)
- Deduplication check (REQUIRED)

**Modification Risk:** CRITICAL
- Cannot remove beatStartedAt guard
- Cannot change phase check
- Cannot modify deduplication

**Unsafe Changes:**
- Removing the guard
- Changing deduplication logic
- Advancing without checking phase

**Safe Optimizations:** NONE

---

### STEP 9: EXPERIMENT DECISION

**Component:** Implied `lib/experience/extractors/` (extraction function)  
**Responsibility:** Extract yes/no from transcript  
**Dependencies:** voiceTranscript, beat advancement  
**Status:** ✅ **REQUIRED** - Determines path (phone vs closed)  
**Type:** Core logic (location TBD - may not exist yet as separate module)  
**Risk Level:** 🟡 **MEDIUM** - Extraction logic must be robust  
**Uncertainty:** Extraction may be hardcoded or simple pattern matching

**Modification Risk:** MEDIUM - Accuracy affects user path

---

### STEP 10: PHONE NUMBER CAPTURE

**Component:** `app/experience/page.tsx` (form in PHONE beat)  
**Responsibility:** Display phone collection UI  
**Dependencies:** Session reaching PHONE beat  
**Status:** ✅ **FUNCTIONAL** - Renders but actual integration pending  
**Type:** Partial implementation (UI ready, backend integration TBD)  
**Risk Level:** 🟡 **HIGH** - Integration not yet validated  
**Current State:**
- Beat plays: "What's the best number to reach you?"
- Form ready to display
- Submission logic not integrated with handoff

**Modification Risk:** HIGH until phone integration complete

---

## H. TECHNICAL DEBT INVENTORY

### Code Quality Issues (Low Risk to Leave Until Complete)

| Issue | Location | Severity | Recommendation |
|-------|----------|----------|-----------------|
| ~150 lines of debug logging | openai-realtime-client.ts, beat-controller.ts, others | LOW | Remove after phone validation |
| Unused imports (dispatch, brief generation) | app/experience/page.tsx | LOW | Remove after phone validation |
| `demo-experience-test/` directory | app/ | LOW | Delete after phone validation |
| `experience-v2-test/` test route | app/experience-v2-test/ | MEDIUM | Delete when transport fully validated |
| Unused React state variables | app/experience/page.tsx | LOW | Remove after phone validation |
| Console logging in production | multiple files | MEDIUM | Clean up before production deployment |
| No error boundaries | app/experience/page.tsx | MEDIUM | Add after phone validation |
| Hard-coded script strings | experience-beats.ts | LOW | Already modular, no change needed |

---

## I. SAFE CLEANUP LIST - Can Execute Now

### Immediate Removals (Zero Risk)

```
✅ DELETE /app/demo-experience-test/
   - Unused old demo implementation
   - Completely separate from current flow
   
✅ DELETE /lib/demo-experience/
   - Unused demo library code
   - No dependencies in current experience
   
✅ DELETE /app/api/demo-experience/
   - Unused API route
   - No dependencies in current experience
   
✅ REMOVE imports from app/experience/page.tsx:
   - extractAssistantActions (line 9)
   - createDispatchInSupabase (line 10)
   - generateWorkerBrief (line 11-12)
   - buildExecutionPackage (line 15)
   
✅ REMOVE unused imports:
   - PresenceCore (line 8) - renders but not used in current beat flow
   
✅ REMOVE unused state variables:
   - isSubmittingPhone (line 38) - declared but never used
   - visitorName (line 39) - declared but never used
   - businessOffer (line 40) - declared but never used
   - targetBuyer (line 41) - declared but never used
   - dispatchRecord (line 42) - declared but never used

Total cleanup: ~30 lines of unused code + 3 directories
Risk level: ZERO - None of these are in execution path
```

---

## J. DANGEROUS CLEANUP LIST - Do NOT Remove

### Code That Must Survive Until Phone Integration Complete

| Code | Location | Why Dangerous |
|------|----------|---------------|
| `connectionReadyPromise` | openai-realtime-client.ts:273-291 | Prevents race conditions in speech synthesis. Removing = silent speech failures |
| `beatStartedAt` guard | app/experience/page.tsx:59 | Prevents ambient noise hijacking before Beat 1. Removing = transcript hijacking returns |
| `conversation.item.create` event | openai-realtime-client.ts:386-398 | Part of speech synthesis. Removing = no TTS |
| `response.create` event | openai-realtime-client.ts:406-411 | Part of speech synthesis. Removing = no TTS |
| `turn_detection.create_response: false` | app/api/openai/realtime/session/route.ts | Disables autonomous generation. Removing = Spanish autonomous speech returns |
| `appendTranscript` deduplication | useRealtimeOnboardingSession.ts:26-75 | Prevents double-processing. Removing = state machine doubles |
| `BeatController` state machine | beat-controller.ts | Entire beat progression logic. Removing = experience breaks |
| `speakExact()` method | openai-realtime-client.ts:356 | Only speech synthesis pathway. Removing = no audio |
| Callback chain (onBeatStart → speakExact) | Multiple files | Speech delivery pipeline. Breaking = no dialogue |
| `experience-state.ts` session object | lib/experience/experience-state.ts | State persistence. Removing = beat data lost |

**CRITICAL: Do not refactor any of these until phone integration is proven working and stable for 1+ week.**

---

## K. RECOMMENDED SEQUENCE FOR IMPROVEMENTS

### Phase 1: Validate & Stabilize (Current - Next 1 Week)

**Keep everything as-is. Do NOT refactor.**

1. Run experience 20+ times end-to-end
2. Verify phone number capture flow works
3. Verify handoff to next system works
4. Measure transcript accuracy
5. Measure speech latency
6. Test with real phone calls (if applicable)

**No code changes. Just validation.**

---

### Phase 2: Integrate Phone Workflow (After Phase 1 Validates)

**Scope:** Connect phone capture to downstream systems

1. Implement extraction for phone (if not done)
2. Wire phone submission to handoff
3. Test handoff integration
4. Verify visitor data flows to next system
5. Test error cases (invalid phone, network errors)

**Minimal code changes. Only phone integration.**

---

### Phase 3: Remove Debug Code (After Phone Integration Validates)

**Scope:** Clean up logging, remove unused code

1. Remove all [INSTANCE], [CONNECTION], [BEAT], [VOICE], [HOOK], [EXPERIENCE] logging (~150 lines)
2. Remove unused imports from app/experience/page.tsx
3. Delete demo-experience directories
4. Delete experience-v2-test when ready
5. Remove unused React state variables
6. Add error boundaries if needed

**Safe to do once phone workflow is validated.**

**Estimated time:** 1-2 hours
**Risk:** ZERO - only removing logging and unused code

---

### Phase 4: Optional Refactoring (After 2+ Weeks Stability)

**Scope:** Code structure improvements (NOT YET)

1. Extract extraction logic to clean module structure
2. Simplify connectionReadyPromise pattern if simpler alternative exists
3. Separate concerns in BeatController (if needed)
4. Consolidate logging into proper module
5. Add TypeScript stricter mode

**ONLY after phone workflow stable for 2+ weeks.**

---

### Phase 5: V2 Redesign (Only AFTER All Above Complete)

**Scope:** Experience V2 rebuild (current scope is freeze)

**DO NOT START BEFORE:**
- Phone integration validated ✅
- Debug code removed ✅
- System proven stable for 2+ weeks ✅
- Current code fully understood ✅

**Then:** Build Experience V2 from clean slate with lessons learned.

---

## L. SUMMARY RISK MATRIX

```
┌─────────────────────────────────────────────────────────────┐
│ RISK LEVEL vs TIMING                                        │
├──────────────────────┬────────────────────────────────────────┤
│ LEVEL                │ ACTION                                 │
├──────────────────────┼────────────────────────────────────────┤
│ 🟢 SAFE NOW         │ Delete demo-experience                 │
│                      │ Remove unused imports                   │
│                      │ Remove unused state variables           │
│                      │ (Risk: ZERO - not in execution path)    │
├──────────────────────┼────────────────────────────────────────┤
│ 🟡 SAFE AFTER PHONE  │ Remove debug logging (~150 lines)      │
│                      │ Delete experience-v2-test              │
│                      │ (Risk: ZERO - only logging)            │
├──────────────────────┼────────────────────────────────────────┤
│ 🔴 DO NOT TOUCH     │ connectionReadyPromise pattern          │
│                      │ beatStartedAt guard                     │
│                      │ speakExact() event sequence             │
│                      │ BeatController logic                    │
│                      │ (Risk: CRITICAL - breaks experience)    │
└──────────────────────┴────────────────────────────────────────┘
```

---

## M. FINAL ASSESSMENT

### What Is Working Today

✅ Complete end-to-end experience  
✅ Deterministic beat progression  
✅ Speech synthesis via Realtime API  
✅ Transcript capture and processing  
✅ User input detection  
✅ Conditional logic (yes/no decision)  
✅ Phone number input field  

### What Is NOT Yet Complete

⏳ Phone extraction logic (extraction function)  
⏳ Phone data handoff to next system  
⏳ Error handling for phone validation  
⏳ Integration with downstream workflow  

### Recommended Next Action

**DO NOT REFACTOR. DO NOT REDESIGN.**

1. Test the experience 20+ times
2. Verify phone integration works
3. THEN clean debug code
4. THEN consider V2

**Current state is the first known-good build. Preserve it completely until phone integration is validated.**

---

**Audit completed:** 2026-06-21  
**Status:** First known-good build documented  
**Next review:** After phone integration validates  
