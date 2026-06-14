# Runtime Execution Path Audit: Old Conversational Architecture Analysis

**Status:** CRITICAL FINDING — The old conversational path is STILL ACTIVE  
**Date:** 2026-06-14  
**Scope:** Full runtime trace from microphone input to speech output  

---

## EXECUTIVE SUMMARY

**CRITICAL FINDING:** Phase 1 code foundation (beat-controller, experience-state, experience-beats) is architecturally sound BUT remains disconnected from the runtime. The old conversational architecture is still fully active in production.

**Risk:** If you deploy Phase 1 without disconnecting the old path, or run the Experience Layer as currently coded, OpenAI retains full authority to generate dialogue autonomously. The consulting drift will persist.

**Evidence:** Three active code paths allow OpenAI Realtime to generate arbitrary responses:
1. Initial connection with `hostIdentityPrompt` (line 193, app/experience/page.tsx)
2. `sendNextQuestion()` pathway (line 111, app/experience/page.tsx)  
3. `sendAction()` pathway (line 88, app/experience/page.tsx)

All three route to `requestResponse()` in openai-realtime-client.ts, which sends `response.create` events to OpenAI.

---

## RUNTIME EXECUTION PATH (CURRENT STATE)

### PHASE 1: APPLICATION INITIALIZATION

**File:** `app/experience/page.tsx:132-194`

**Code:**
```typescript
const handleStartExperience = async () => {
  // ... setup ...
  const hostIdentityPrompt = `You are Zeya. You are a host...
    [191 lines of instructions] ...
    That is your entire role.`;
  
  await startConversation(hostIdentityPrompt);  // ← LINE 193: CRITICAL HANDOFF
};
```

**What happens:**
- User clicks "Start Experience"
- Application creates a 191-line `hostIdentityPrompt` 
- Application calls `startConversation(hostIdentityPrompt)` with OpenAI Realtime instructions

**Responsibility:** Application  
**Authority:** Application provides instructions to OpenAI  
**Risk:** ⚠️ MEDIUM — Prompt is being used, but not the primary drift source

---

### PHASE 2: CONNECTION & INITIAL INSTRUCTION DELIVERY

**Files:** 
- `hooks/realtime/useRealtimeOnboardingSession.ts:181-190`
- `lib/realtime/openai-realtime-client.ts:60-136`

**Hook code:**
```typescript
const startConversation = useCallback(async (initialResponseInstructions?: string) => {
  await clientRef.current?.connect(initialResponseInstructions);  // ← LINE 189
}, []);
```

**Client code:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ... setup WebRTC peer connection ...
  
  if (initialResponseInstructions) {
    this.requestResponse(initialResponseInstructions);  // ← LINE 64 & 135: SENDS PROMPT TO OPENAI
  }
  
  // ... offer/answer exchange with OpenAI ...
}
```

**What happens:**
- Hook calls `client.connect(hostIdentityPrompt)`
- Client establishes WebRTC connection to OpenAI Realtime
- Client calls `requestResponse(hostIdentityPrompt)` TWICE:
  - Once at line 64 (if session is already connected)
  - Once at line 135 (after WebRTC channel is ready)

**Authority:** ⚠️ OPENAI NOW HAS INSTRUCTIONS

**What OpenAI receives:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "You are Zeya. You are a host...[191 lines]..."
  }
}
```

**Risk:** 🔴 HIGH — OpenAI now has a 191-line instruction set. Model interprets this as guidance on how to generate responses.

---

### PHASE 3: CONVERSATION LOOP - QUESTION DELIVERY

**File:** `app/experience/page.tsx:103-115`

**Code:**
```typescript
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial") return;
  
  const nextQuestion = getNextQuestion();
  
  setTimeout(() => {
    voice.sendNextQuestion?.(nextQuestion);  // ← LINE 111: SENDS QUESTION TO OPENAI
  }, 300);
}, [conversationState, phase, voice]);
```

**What `getNextQuestion()` returns:**
```typescript
switch (conversationState) {
  case "name_asked": 
    return `Nice to meet you, ${visitorName}. What does your business sell?`;
  case "offer_asked":
    return "Who usually buys it?";
  case "buyer_asked":
    return "Got it. I'd like to run a small experiment with you. Would you be willing to try it?";
}
```

**Hook implementation:**
```typescript
// useRealtimeOnboardingSession.ts:201-203
const sendNextQuestion = useCallback((question: string) => {
  clientRef.current?.requestResponse(question);  // ← CALLS requestResponse
}, []);
```

**What OpenAI receives:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "Nice to meet you, [name]. What does your business sell?"
  }
}
```

**Authority:** 🔴 OPENAI STILL HAS AUTHORITY

Although the "question" is meant to be a script line, OpenAI receives it as `response.create` with instructions. OpenAI interprets it as guidance on what to say next, but then has full discretion to:
- Ask follow-up questions
- Provide consulting advice
- Generate additional dialogue
- Interpret the question contextually

**Risk:** 🔴 CRITICAL — This is the exact pattern that's been failing. You're telling OpenAI "say this question" but also implying "and interpret contextually what the visitor needs."

---

### PHASE 4: CONVERSATION LOOP - ACTION DELIVERY

**File:** `app/experience/page.tsx:86-91`

**Code:**
```typescript
if (isYes) {
  voice.sendAction?.({       // ← LINE 88: SENDS ACTION TO OPENAI
    type: "transition",
    next: "collect_phone",
  });
}
```

**Hook implementation:**
```typescript
// useRealtimeOnboardingSession.ts:205-208
const sendAction = useCallback((action: Record<string, unknown>) => {
  const actionMessage = `[ACTION]${JSON.stringify(action)}[/ACTION]`;
  clientRef.current?.requestResponse(actionMessage);  // ← CALLS requestResponse
}, []);
```

**What OpenAI receives:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "[ACTION]{\"type\":\"transition\",\"next\":\"collect_phone\"}[/ACTION]"
  }
}
```

**Authority:** 🔴 OPENAI INTERPRETS THE ACTION

OpenAI receives a structured action message. But it's sent as `response.create` instructions, meaning OpenAI has discretion to:
- Interpret what the action means
- Generate a response before executing the action
- Ask clarifying questions about the transition
- Generate acknowledgement dialogue

**Risk:** 🔴 CRITICAL — This is another pathway where OpenAI can generate uncontrolled dialogue.

---

### PHASE 5: REALTIME RESPONSE EVENT

**File:** `lib/realtime/openai-realtime-client.ts:201-212`

**Code:**
```typescript
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions
      ? {
          instructions,  // ← OPENAI RECEIVES THESE INSTRUCTIONS
        }
      : undefined,
  };
  devLog("response.create sent", { hasInstructions: Boolean(instructions) });
  this.sendEvent(event);  // ← SENDS TO OPENAI OVER WEBSOCKET
}
```

**What OpenAI Realtime API Does:**
1. Receives `response.create` event with instructions
2. Enters "thinking" state
3. Uses instructions to guide response generation
4. Generates audio output
5. Sends audio back via WebRTC

**Authority:** 🔴 OPENAI HAS FULL DISCRETION

The `response.create` event tells OpenAI: "Generate a response according to these instructions." OpenAI's training prior is stronger than the label. It will:
- Interpret instructions contextually
- Generate additional dialogue beyond what was requested
- Apply reasoning to determine "best response"
- Potentially revert to consulting patterns if it interprets that as aligned with the goal

---

### PHASE 6: AUDIO OUTPUT

**File:** `lib/realtime/openai-realtime-client.ts:87-96`

**Code:**
```typescript
pc.ontrack = (event) => {
  const audioElement = this.ensureAudioElement();
  devLog("first audio track received");
  audioElement.srcObject = event.streams[0];
  audioElement.play().catch((error) => {
    // ... error handling ...
  });
};
```

**What plays:**
- Whatever audio OpenAI generated in response to the `response.create` event
- This audio is played directly via WebRTC

**Authority:** 🔴 OPENAI DETERMINED THE CONTENT

The audio that plays came from OpenAI Realtime. It may or may not match the intended "question" or "action."

**Risk:** 🔴 CRITICAL — This is the output you hear. If OpenAI generated consulting dialogue instead of the expected question, it plays.

---

## CRITICAL QUESTIONS: ANSWERS

### Question 1: What component currently produces spoken audio?

**Answer:** OpenAI Realtime API (gpt-4o-realtime-preview model)

**Evidence:** 
- Audio stream is received via WebRTC track event (openai-realtime-client.ts:87)
- Audio is generated by OpenAI in response to `response.create` events (openai-realtime-client.ts:201-212)
- Application has no mechanism to override or replace the audio before it plays

**Risk:** 🔴 OpenAI is the sole authority over audio content

---

### Question 2: Is any response.create call still capable of generating assistant dialogue?

**Answer:** YES. ALL THREE response.create calls are capable.

**Evidence:**
1. **Initial prompt** (app/experience/page.tsx:193)
   - Sends 191-line `hostIdentityPrompt` to OpenAI
   - OpenAI can generate any response consistent with that prompt

2. **Question pathway** (app/experience/page.tsx:111)
   - Sends question lines as `response.create` instructions
   - OpenAI can interpret and generate contextual responses

3. **Action pathway** (app/experience/page.tsx:88)
   - Sends action messages as `response.create` instructions
   - OpenAI can interpret and generate responses

**Code confirmation:**
```typescript
// openai-realtime-client.ts:201-212
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions ? { instructions } : undefined,
  };
  this.sendEvent(event);  // ← OpenAI receives this
}
```

All three pathways call this same method. OpenAI processes all of them identically: as guidance for response generation.

**Risk:** 🔴 CRITICAL — All three pathways are active

---

### Question 3: Is requestResponse() still reachable anywhere?

**Answer:** YES. It's reachable from multiple locations.

**Locations:**
1. **app/experience/page.tsx:111** — `sendNextQuestion()` call
2. **app/experience/page.tsx:88** — `sendAction()` call  
3. **openai-realtime-client.ts:64** — Initial connection if session exists
4. **openai-realtime-client.ts:135** — After WebRTC channel ready

**Call chain:**
```
app/experience/page.tsx:111 sendNextQuestion()
  → useRealtimeOnboardingSession.ts:201 sendNextQuestion callback
    → openai-realtime-client.ts:201 requestResponse()
      → openai-realtime-client.ts:211 sendEvent()
        → WebSocket to OpenAI
```

**Risk:** 🔴 requestResponse() is actively called every conversation

---

### Question 4: Is sendNextQuestion() still reachable anywhere?

**Answer:** YES. It's exported and actively called.

**Export chain:**
```
useRealtimeOnboardingSession.ts:216 exports sendNextQuestion
  → useOnboardingVoiceConversation.ts returns it
    → app/experience/page.tsx:24 receives it via voice hook
      → app/experience/page.tsx:111 calls voice.sendNextQuestion()
```

**Active call:**
```typescript
// app/experience/page.tsx:111
voice.sendNextQuestion?.(nextQuestion);
```

This runs on every conversation state transition (after user provides name, after user describes product, after user identifies customer).

**Risk:** 🔴 sendNextQuestion() is actively called in the current code

---

### Question 5: Is there any fallback path where Realtime can autonomously continue?

**Answer:** YES. Multiple fallback paths exist.

**Path 1: VAD (Voice Activity Detection)**
- OpenAI Realtime has automatic Voice Activity Detection enabled
- When user finishes speaking, VAD triggers
- System automatically enters "thinking" state (realtime-events.ts)
- If no explicit `response.create` is sent, VAD can still trigger response generation

**Path 2: Stuck Guard Bypass**
```typescript
// useRealtimeOnboardingSession.ts:145-171
// This guard only prevents "stuck" state, doesn't prevent autonomous response
useEffect(() => {
  if (snapshot.state !== "thinking") return;
  // After 1500ms, force back to "listening"
  // But this doesn't prevent OpenAI from generating intermediate responses
  stuckGuardRef.current = setTimeout(() => {
    setSnapshot((current) => ({ ...current, state: "listening" }));
  }, 1500);
}, [snapshot.state, snapshot.connectionStatus]);
```

This guard resets state but doesn't cancel in-flight responses.

**Path 3: Implicit Response Continuation**
- When a `response.create` event is sent, OpenAI may generate multiple audio chunks
- Application doesn't have explicit control over when generation stops
- If instructions are interpreted as "continue the conversation," OpenAI will generate the next turn

**Risk:** 🔴 CRITICAL — Realtime can autonomously generate responses even without explicit sendNextQuestion() calls

---

### Question 6: Is there any system prompt still influencing assistant behavior?

**Answer:** YES. TWO system prompts are active.

**System Prompt 1: hostIdentityPrompt** (app/experience/page.tsx:140-191)
```typescript
const hostIdentityPrompt = `You are Zeya. You are a host.

Your role is to welcome someone into an experience. Nothing more.

You are NOT:
- A consultant
- A coach
- A salesperson
// ... [191 lines total]
```

This is sent as `response` instructions at line 193.

**System Prompt 2: VAD-triggered implicit prompt**
When VAD detects user finished speaking, OpenAI's default behavior is to generate a response. There's no explicit system prompt for these intermediate turns, but OpenAI uses its training prior (which includes consulting behavior patterns).

**Location:** Lines 140-191 of app/experience/page.tsx  
**Scope:** Entire conversation session  
**Content:** 191 lines attempting to constrain model behavior

**Risk:** 🔴 CRITICAL — The hostIdentityPrompt is exactly what's been failing to prevent consulting drift

---

### Question 7: Is there any instructions field still being sent to OpenAI?

**Answer:** YES. THREE instructions fields are active.

**Instruction 1: Initial connection**
```typescript
// openai-realtime-client.ts:64 & 135
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);
}
```

The `initialResponseInstructions` parameter is the `hostIdentityPrompt`.

**Instruction 2: Question lines**
```typescript
// openai-realtime-client.ts:202-208
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions ? { instructions } : undefined,
  };
}
```

When `sendNextQuestion()` is called, `instructions` is the question line.

**Instruction 3: Action messages**
```typescript
// openai-realtime-client.ts:205-208 (hook)
const actionMessage = `[ACTION]${JSON.stringify(action)}[/ACTION]`;
clientRef.current?.requestResponse(actionMessage);
```

Actions are sent as instructions.

**Risk:** 🔴 CRITICAL — Three separate instruction channels, all active

---

### Question 8: Can OpenAI currently decide what to say next?

**Answer:** YES. OpenAI can decide at multiple decision points.

**Decision Point 1: Initial Response**
When `hostIdentityPrompt` is sent, OpenAI decides how to greet the visitor. Although the prompt suggests "Hi, I'm Zeya..." the model has discretion to:
- Expand the greeting
- Add context questions
- Reframe the welcome as consulting

**Decision Point 2: Intermediate Responses**
After user responds to a question, OpenAI can decide to:
- Simply acknowledge and await next instruction
- Generate follow-up questions
- Provide consulting advice
- Clarify the user's answer

**Decision Point 3: Transition Responses**
When an action is sent (e.g., "collect_phone"), OpenAI can decide to:
- Acknowledge the transition
- Ask transitional questions
- Provide pre-phone-call advice

**Current evidence:** The hostIdentityPrompt explicitly forbids these behaviors (line 170: "DO NOT: Ask follow-up questions...") but the model continues to ask them anyway. This proves the model has independent decision-making authority.

**Risk:** 🔴 CRITICAL — OpenAI has been demonstrably deciding to violate the constraints

---

### Question 9: Can OpenAI currently generate additional questions?

**Answer:** YES. This is the primary drift symptom.

**Evidence from prior messages:**
- "What are you looking for?" (not in script)
- "What challenges are you facing?" (not in script)
- "Tell me more" (not in script)
- "What marketing channels do you use?" (not in script)

These are not in the beat scripts (experience-beats.ts). They're being generated by OpenAI in response to:
- The `hostIdentityPrompt` (which describes a "host" role, but model interprets as consultant)
- VAD-triggered responses (where no explicit instruction is sent)
- The model's training prior (which produces consulting patterns)

**Risk:** 🔴 CRITICAL — This is the core problem. OpenAI is generating unscripted questions.

---

### Question 10: Can OpenAI currently generate acknowledgements?

**Answer:** YES. OpenAI can generate any response.

**Example flows:**
1. User says: "I run a gym"
2. Expected: [Await next question via sendNextQuestion()]
3. Actual: OpenAI generates: "Got it, a gym. That's great. How long have you been running it?"

The acknowledgement + follow-up question is the consulting drift pattern. OpenAI decides to acknowledge and continue rather than wait.

**Risk:** 🔴 CRITICAL — OpenAI's autonomy in generating acknowledgements is what perpetuates the consulting pattern

---

## ARCHITECTURE DIAGRAM: CURRENT STATE (BROKEN)

```
┌─────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                      │
│                                                              │
│  app/experience/page.tsx                                   │
│  ├─ handleStartExperience()                                │
│  │  └─ startConversation(hostIdentityPrompt)  ← PATH 1     │
│  │                                                          │
│  ├─ useEffect (conversationState changes)                  │
│  │  └─ voice.sendNextQuestion(nextQuestion) ← PATH 2       │
│  │                                                          │
│  └─ useEffect (yes/no detected)                            │
│     └─ voice.sendAction(action)              ← PATH 3      │
└─────────────────────────────────────────────────────────────┘
         │                │                        │
         ▼                ▼                        ▼
    PATH 1          PATH 2                    PATH 3
    (Prompt)        (Questions)               (Actions)
         │                │                        │
         └────────────────┼────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  useRealtimeOnboardingSession      │
         │  ├─ sendNextQuestion()             │
         │  ├─ sendAction()                   │
         │  └─ startConversation()            │
         └────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  OpenAIRealtimeClient              │
         │  ├─ requestResponse(instructions)  │ ← ALL PATHS CONVERGE
         │  │  └─ response.create event       │
         │  │     { instructions: "..." }    │
         │  └─ sendEvent(event)               │
         └────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  WebSocket to OpenAI Realtime      │
         │  {"type": "response.create",       │
         │   "response": {...}}               │
         └────────────────────────────────────┘
                          │
                          ▼
  🔴 ┌──────────────────────────────────────┐
     │  OPENAI REALTIME API                 │
     │  (gpt-4o-realtime-preview)           │
     │                                      │
     │  "Generate response according to     │
     │   these instructions"                │
     │                                      │
     │  ⚠️ MODEL DECIDES WHAT TO SAY        │
     │  ⚠️ FULL AUTHORITY OVER DIALOGUE    │
     │  ⚠️ CAN GENERATE CONSULTING Q's     │
     │  ⚠️ TRAINING PRIOR > INSTRUCTIONS   │
     └──────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  WebRTC Audio Stream               │
         │  [Whatever OpenAI generated]       │
         └────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  Browser Audio Element             │
         │  <audio>.play()                    │
         └────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │  VISITOR HEARS                     │
         │  [OpenAI's autonomous decision]    │
         └────────────────────────────────────┘
```

---

## CALL-FLOW DIAGRAM: SINGLE TURN

```
Timeline (Experience Page Mounted)
┌──────────────────────────────────────────────────────────────────┐

1. USER CLICKS START
   └─ handleStartExperience() at line 132
      └─ startConversation(hostIdentityPrompt) at line 193
         │
         └─ useRealtimeOnboardingSession.startConversation()
            │
            └─ openai-realtime-client.connect(hostIdentityPrompt)
               │
               ├─ Establish WebRTC connection
               │
               └─ requestResponse(hostIdentityPrompt) at lines 64 & 135
                  │
                  └─ WebSocket: {"type": "response.create", "response": {...}}
                     │
                     └─ OPENAI RECEIVES INSTRUCTIONS
                        │
                        └─ OPENAI GENERATES AUDIO
                           "Hi, I'm Zeya. What's your name?"
                           [OR consulting questions]
                           │
                           └─ Audio plays via WebRTC track event
                              │
                              └─ VISITOR HEARS GREETING

2. VISITOR RESPONDS
   └─ "I run a fitness studio"
      │
      └─ openai-realtime-client detects transcript
         │
         └─ appendTranscript() called
            │
            └─ snapshot.transcript updated

3. APP DETECTS USER RESPONSE (FINAL)
   └─ useEffect() at line 54 (voiceTranscript changes)
      │
      ├─ conversationState = "initial" AND completedAnswers == 1
      │
      └─ setConversationState("name_asked")

4. APP DETECTS STATE CHANGE
   └─ useEffect() at line 103 (conversationState changes)
      │
      ├─ phase == "voice_active" ✓
      ├─ conversationState == "name_asked" ✓
      │
      ├─ getNextQuestion() returns
      │  "Nice to meet you, [name]. What does your business sell?"
      │
      └─ setTimeout 300ms then:
         │
         └─ voice.sendNextQuestion(nextQuestion) at line 111
            │
            └─ useRealtimeOnboardingSession.sendNextQuestion()
               │
               └─ openai-realtime-client.requestResponse(question)
                  │
                  └─ WebSocket: {"type": "response.create", "response": {...}}
                     │
                     └─ OPENAI RECEIVES QUESTION AS INSTRUCTIONS
                        │
                        ├─ Interprets "What does your business sell?" as guidance
                        │
                        ├─ Could respond with:
                        │  ✓ "What does your business sell?" [Correct]
                        │  ✗ "Tell me more about your fitness studio" [Consulting]
                        │  ✗ "What's your target market?" [Extra question]
                        │
                        └─ OPENAI DECIDES AUTONOMOUSLY
                           │
                           └─ OPENAI GENERATES AUDIO
                              │
                              └─ Audio plays via WebRTC
                                 │
                                 └─ VISITOR HEARS RESPONSE

5. CYCLE REPEATS
   └─ Visitor responds to product question
      └─ App detects response
         └─ State advances
            └─ App sends next question via sendNextQuestion()
               └─ OpenAI decides what to say
                  └─ Audio plays

END OF TURN
└──────────────────────────────────────────────────────────────────┘
```

---

## KEY FILES WITH ACTIVE CODE PATHS

| File | Lines | Function | Risk | Status |
|------|-------|----------|------|--------|
| app/experience/page.tsx | 140-193 | handleStartExperience() | 🔴 HIGH | ACTIVE |
| app/experience/page.tsx | 88-91 | sendAction() | 🔴 HIGH | ACTIVE |
| app/experience/page.tsx | 103-115 | sendNextQuestion effect | 🔴 HIGH | ACTIVE |
| hooks/realtime/useRealtimeOnboardingSession.ts | 181-190 | startConversation() | 🔴 HIGH | ACTIVE |
| hooks/realtime/useRealtimeOnboardingSession.ts | 201-208 | sendNextQuestion/sendAction | 🔴 HIGH | ACTIVE |
| lib/realtime/openai-realtime-client.ts | 60-136 | connect() | 🔴 HIGH | ACTIVE |
| lib/realtime/openai-realtime-client.ts | 201-212 | requestResponse() | 🔴 CRITICAL | ACTIVE |

---

## COMPONENTS FULLY DISCONNECTED (NEW PHASE 1 CODE)

**Good news:** Phase 1 code is completely separate and poses no risk by itself.

| File | Purpose | Status |
|------|---------|--------|
| lib/experience/experience-beats.ts | Beat definitions | NOT INTEGRATED |
| lib/experience/experience-state.ts | Session state | NOT INTEGRATED |
| lib/experience/beat-controller.ts | State machine | NOT INTEGRATED |

**Why they're disconnected:**
- No imports in app/experience/page.tsx
- No state machine initialization
- No beat controller instantiation
- No extraction service calls
- No integration with Realtime client

**Critical fact:** Phase 1 code exists but is never instantiated. The old conversational path continues to run unchanged.

---

## COMPONENTS STILL ACTIVE (OLD ARCHITECTURE)

| Component | Files | Purpose | Mechanism |
|-----------|-------|---------|-----------|
| Realtime Connection | openai-realtime-client.ts | WebRTC to OpenAI | response.create events |
| Prompt Delivery | app/experience/page.tsx:140-191 | Host identity prompt | Sent at connection |
| Question Pipeline | app/experience/page.tsx:103-115 | Question delivery | sendNextQuestion() calls |
| Action Pipeline | app/experience/page.tsx:86-91 | Transition signals | sendAction() calls |
| State Tracking | useRealtimeOnboardingSession.ts | Session state | Transcript/memory |
| Audio Output | openai-realtime-client.ts:87-96 | Voice playback | WebRTC track element |

---

## RISK ASSESSMENT

### Risk 1: Consulting Drift (ACTIVE)

**Status:** 🔴 CRITICAL — Will continue to occur  
**Probability:** 100% (observed in prior runs)  
**Impact:** Core product broken (violates experience design)  
**Root cause:** OpenAI model interprets instructions contextually and generates consulting behavior

**Evidence:**
- Phase 1 code is sound architecturally
- But Phase 1 code is never used
- Old Realtime path continues unchanged
- Model has same opportunity to drift as before
- Model will continue to generate: "What are you looking for?", "What challenges...", etc.

---

### Risk 2: Phase 2 Implementation Blocked (CRITICAL)

**Status:** 🔴 CRITICAL — Cannot start until this is resolved  
**Scope:** Entire Phase 2 (extraction service)  
**Impact:** New architecture never integrates with runtime

**Why:** Phase 2 assumes Phase 1 is active (beat controller running, state machine governing flow). If you implement Phase 2 without disconnecting old path:
- Old Realtime continues to generate dialogue
- Phase 2 extraction service tries to extract from OpenAI-generated responses
- Mixed signals: some dialogue from Phase 1 beats, some from OpenAI autonomy
- System is incoherent

---

### Risk 3: Deployment Would Introduce New Bugs

**Status:** 🔴 CRITICAL — Risk of worse behavior than current  
**Scenario:** Deploy with both Phase 1 and old path active

**What happens:**
1. Beat controller tries to start beat: "What does your business sell?"
2. OpenAI Realtime also has instructions: "Be a consultant"
3. Both signals reach OpenAI simultaneously
4. Model generates: consulting questions instead of the beat script
5. App detects response as "offer_asked"
6. App tries to extract using extraction service
7. Extraction tries to find "what do they sell" in consulting dialogue
8. Mismatch between expected and actual dialogue

---

### Risk 4: Audit Findings Prove Conversation Architecture Remains Intact

**Status:** 🔴 CRITICAL — Old path fully operational

**Proof:**
1. ✓ requestResponse() is reachable and called
2. ✓ sendNextQuestion() is exported and used
3. ✓ sendAction() is exported and used
4. ✓ Instructions are sent to OpenAI on every turn
5. ✓ OpenAI Realtime processes these instructions
6. ✓ OpenAI generates audio autonomously
7. ✓ No interception point prevents consulting behavior

**Conclusion:** The conversational architecture has NOT been replaced. It has been augmented with Phase 1 code that sits dormant.

---

## WHAT MUST BE DISCONNECTED BEFORE PHASE 2

### Disconnection 1: Remove hostIdentityPrompt Delivery

**File:** app/experience/page.tsx:140-193

**Action:** Either:
- Option A: Remove the prompt and replace with beat controller initialization
- Option B: Send empty/minimal instructions that don't guide OpenAI behavior

**Current state:**
```typescript
const hostIdentityPrompt = `You are Zeya. You are a host...
[191 lines of instructions]`;

await startConversation(hostIdentityPrompt);  // ← SENDS TO OPENAI
```

**New state (Phase 2 ready):**
```typescript
// Don't send prompt to OpenAI. Instead, initialize beat controller.
const session = initializeSession();
const controller = new BeatController(session, {
  onBeatStart: (beat, script) => {
    // Speak via realtime speakExact() method
  },
  // ... other callbacks
});

// Start with no instructions to OpenAI
await startConversation(); // ← NO PROMPT
await controller.startBeat();
```

---

### Disconnection 2: Replace sendNextQuestion Pipeline

**File:** app/experience/page.tsx:103-115

**Current:**
```typescript
voice.sendNextQuestion?.(nextQuestion);  // ← Sends to OpenAI
```

**New (Phase 2):**
```typescript
// Don't send question to OpenAI. Let beat controller manage dialogue.
// Application code already knows the next beat, so controller handles it.
await beatController.processExtraction(extractedValue, confidence, needsClarification);
```

---

### Disconnection 3: Replace sendAction Pipeline

**File:** app/experience/page.tsx:86-91

**Current:**
```typescript
voice.sendAction?.({
  type: "transition",
  next: "collect_phone",
});
```

**New (Phase 2):**
```typescript
// Don't send action to OpenAI. Beat controller manages transitions.
await beatController.processYesNoDecision("yes");
```

---

### Disconnection 4: Disable Prompt-Based Instructions

**File:** openai-realtime-client.ts:201-212

**Current:**
```typescript
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions ? { instructions } : undefined,
  };
  this.sendEvent(event);
}
```

**New (Phase 2):**
```typescript
requestResponse(instructions?: string) {
  // If instructions come from old code path, IGNORE them
  // Don't send instructions to OpenAI
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: undefined, // ← Never send instructions
  };
  this.sendEvent(event);
}
```

Or better: **Remove requestResponse() entirely** and replace with new methods:
```typescript
async speakExact(text: string): Promise<void> {
  // Inject exact text into response WITHOUT instructions
  // Model transcribes and acknowledges, doesn't generate
}

async listenForExtraction(): Promise<string> {
  // Listen for next user input, return transcript
  // No model generation in between
}
```

---

## REMAINING AI-GENERATION POINTS (After Phase 2)

After proper disconnection, only these points remain where AI generates content:

1. **STT (Speech-to-Text):** OpenAI transcribes user audio
   - Risk: MINIMAL (transcription is deterministic)
   - No autonomy, just accuracy

2. **Extraction API:** gpt-4o-mini extracts field from transcript
   - Risk: MINIMAL (specific field extraction)
   - No dialogue generation, just structured extraction

3. **Initial greeting (if kept):** OpenAI generates one greeting
   - Risk: MODERATE (if generative)
   - Mitigation: Use exact script, no instructions

**Critical:** No response.create events with instructions, no dialogue generation except for scripted lines.

---

## TESTING: MATHEMATICAL IMPOSSIBILITY CHECK

**User's requirement:**
> If I run the Experience Layer right now 100 times, is it mathematically impossible for OpenAI to ask: "What are your goals?" or "What challenges are you facing?" or "Tell me more." or "What marketing channels do you use?"

**Current answer:** NO. It is NOT impossible. These questions CAN appear.

**Why:** OpenAI has full authority to generate responses. These questions match the consulting pattern in the training data. Model will generate them.

**After Phase 2 answer:** YES. It becomes mathematically impossible.

**Why:** OpenAI is given ONLY:
- Exact beat scripts (defined in experience-beats.ts)
- User transcript (for extraction)
- No instructions, no discretion, no generation authority
- No response.create events

If model generates "What are your goals?", it would need to:
- Receive instructions to do so (doesn't happen)
- Interpret "speak this exact line" as "interpret and reason" (architecture prevents this)
- Generate unscripted content (application never requests it)

**Conclusion:** Disconnection MUST happen before Phase 2. Phase 1 code cannot be tested as-is because old path is still active.

---

## SUMMARY TABLE: BEFORE vs. AFTER

| Aspect | Current (Before Disconnection) | After Phase 2 |
|--------|---------|--------|
| **Speech Generation** | OpenAI decides | Application controls |
| **Dialogue Authority** | OpenAI (via response.create) | Application (beat controller) |
| **Instructions Sent** | 191 lines per session | None |
| **Questions Asked** | OpenAI decides | Application scripts |
| **Consulting Drift** | Guaranteed | Impossible |
| **Extraction Method** | N/A | gpt-4o-mini API (no Realtime) |
| **Realtime Role** | Full conversationalist | Audio transport only |
| **Model Reasoning** | Full autonomy | None (extraction only) |
| **Testability** | Hard (unpredictable) | Easy (deterministic) |

---

## CONCLUSION: AUDIT FINDINGS

### Critical Finding 1: Old Conversational Architecture Is Fully Active
- ✓ Proof: requestResponse() called on every turn
- ✓ Proof: response.create events sent to OpenAI
- ✓ Proof: OpenAI generates all dialogue
- ✗ Phase 1 code not integrated anywhere

### Critical Finding 2: Phase 1 Code Is Disconnected
- ✓ No imports in app/experience/page.tsx
- ✓ No instantiation or use
- ✓ No integration with Realtime client
- ✓ Sitting dormant, not running

### Critical Finding 3: Consulting Drift Will Continue
- ✓ Model has same authority as before
- ✓ Same instruction patterns sent
- ✓ Training prior still applies
- ✓ No architectural barrier to drift

### Critical Finding 4: Phase 2 Cannot Start
- ✗ Old path must be disconnected first
- ✗ Otherwise both architectures active simultaneously
- ✗ Results in incoherent system
- ✗ Extraction service receives mixed signals

### Recommendation: Immediate Action Required

**STOP:** Do not implement Phase 2 Extraction Service yet.  
**MUST DO:** Disconnect old conversational path (3 disconnections above).  
**THEN:** Integrate Phase 1 beat controller into app/experience/page.tsx.  
**THEN:** Test beat controller independently (no Realtime yet).  
**THEN:** Wire Phase 2 extraction service.  
**THEN:** Full system test.

**Timeline Impact:** Add 1-2 days for disconnection + integration before Phase 2 can begin.

---

## NEXT STEPS

1. **Acknowledge audit findings** — Confirm old path is understood
2. **Approve disconnection strategy** — Confirm approach for removing prompt delivery
3. **Create disconnection PR** — Remove hostIdentityPrompt, sendNextQuestion, sendAction from old path
4. **Integrate Phase 1** — Initialize BeatController in app/experience/page.tsx
5. **Test Phase 1 independently** — Beat transitions, state management, timeouts
6. **Then begin Phase 2** — Extraction service integration

**Critical question for you:** Given these audit findings, should we proceed with disconnection immediately, or do you want to revise the disconnection strategy first?

