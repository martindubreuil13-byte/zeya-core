# Phase 1B — Hardwired Deterministic Flow: Execution Path Audit

**Objective:** Validate that Experience Engine can execute a complete deterministic run with zero AI generation

**Testing Goal:** Hear exact script 20 times in sequence with zero variation

**Architecture Validation:** Prove state machine controls voice output, not OpenAI

---

## PROPOSED EXECUTION PATH

```
START
  │
  ├─ User clicks "Start Experience"
  │
  ├─ app/experience/page.tsx → handleStartExperience()
  │
  ├─ Initialize: const session = initializeSession()
  │  └─ Creates ExperienceSession { currentBeat: GREETING, ... }
  │
  ├─ Initialize: const controller = new BeatController(session, callbacks)
  │
  ├─ Call: await controller.startBeat()
  │
  ├─ BeatController.startBeat() executes
  │  │
  │  ├─ Get current beat: session.currentBeat (GREETING)
  │  │
  │  ├─ Lookup script: getBeatScript(GREETING)
  │  │  └─ Returns: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
  │  │
  │  ├─ Call callback: onBeatStart(GREETING, script)
  │  │
  │  └─ app/experience/page.tsx receives callback
  │     │
  │     ├─ Call: voice.speakExact(script)
  │     │
  │     └─ openai-realtime-client.speakExact(script)
  │        │
  │        ├─ Create conversation.item.create event
  │        │  { type: "message", role: "assistant", content: { type: "text", text: script } }
  │        │
  │        ├─ Send event to OpenAI Realtime
  │        │
  │        ├─ Realtime synthesizes text to speech
  │        │  (DETERMINISTIC: no model generation, just TTS)
  │        │
  │        └─ Audio plays via WebRTC track
  │
  ├─ LISTENING STATE
  │  │
  │  ├─ User speaks anything
  │  │
  │  ├─ Realtime captures audio, transcribes
  │  │
  │  └─ openai-realtime-client emits transcript event
  │
  ├─ app/experience/page.tsx receives transcript
  │  │
  │  ├─ Extract user message from transcript
  │  │
  │  ├─ (Phase 1B: Don't extract data, just check if speech exists)
  │  │
  │  ├─ Call: controller.advanceBeat(null, 0.99, false)
  │  │
  │  └─ BeatController.advanceBeat() executes
  │     │
  │     ├─ Call callback: onBeatComplete(currentBeat, null)
  │     │
  │     ├─ Determine next beat: getNextBeat(GREETING)
  │     │  └─ Returns: PRODUCT
  │     │
  │     ├─ Update session: currentBeat = PRODUCT
  │     │
  │     └─ Call: await startBeat()
  │        └─ LOOP BACK to "Get current beat"
  │
  ├─ BEAT 2 → PRODUCT
  │  └─ "Nice to meet you, {name}. What does your business sell?"
  │
  ├─ BEAT 3 → CUSTOMER
  │  └─ "Who usually buys it?"
  │
  ├─ BEAT 4 → EXPERIMENT
  │  └─ "I'd like to show you something. We run a small experiment..."
  │
  ├─ BEAT 5A or 5B (based on yes/no)
  │  ├─ If yes → PHONE: "What's the best number to reach you?"
  │  └─ If no → CLOSED: "No problem at all..."
  │
  └─ END: session.status = "completed"

```

---

## FILES INVOLVED

### 1. app/experience/page.tsx (MODIFIED)
**Responsibility:** Initialize beat controller, wire callbacks, trigger speech

**Changes:**
```typescript
// In handleStartExperience():
const session = initializeSession();
const controller = new BeatController(session, {
  onBeatStart: async (beat, script) => {
    await voice.speakExact(script);  // ← NEW METHOD
  },
  onBeatComplete: (beat, extractedValue) => {
    // Phase 1B: Empty for now
  },
  onSessionComplete: (session) => {
    setPhase("collecting_phone");
  },
  onSessionFail: (session, reason) => {
    // Error handling
  },
});

await controller.startBeat();
```

### 2. lib/experience/beat-controller.ts (NO CHANGES)
**Responsibility:** Manage beat state transitions, call callbacks

**Already exists:** `startBeat()`, `advanceBeat()`, `processExtraction()`

**For Phase 1B:** Use `advanceBeat(null, 0.99, false)` to always advance

### 3. lib/experience/experience-beats.ts (NO CHANGES)
**Responsibility:** Define beat scripts and configuration

**Already exists:** BEAT_SCRIPTS, getBeatScript(), getNextBeat()

### 4. lib/experience/experience-state.ts (NO CHANGES)
**Responsibility:** Track session state

**Already exists:** ExperienceSession, initializeSession(), recordExtraction()

### 5. lib/realtime/openai-realtime-client.ts (NEW METHOD)
**Responsibility:** Provide deterministic speech capability

**New method needed:**
```typescript
async speakExact(text: string): Promise<void> {
  // Inject assistant message directly into conversation
  // Trigger synthesis without model generation
  // Return when audio has been queued/started
}
```

**How it works:**
- Creates conversation.item.create event with assistant message
- Sends response.create event to synthesize (with empty instructions)
- Returns without waiting for completion
- Audio plays automatically via WebRTC track

### 6. hooks/realtime/useRealtimeOnboardingSession.ts (NEW EXPORT)
**Responsibility:** Expose speakExact to React components

**New hook method:**
```typescript
const speakExact = useCallback((text: string) => {
  return clientRef.current?.speakExact(text);
}, []);

// Export it
return {
  ...snapshot,
  speakExact,  // ← NEW
  // ... existing exports
};
```

### 7. hooks/voice/useOnboardingVoiceConversation.ts (NEW EXPORT)
**Responsibility:** Expose speakExact to voice hook consumers

**Changes:**
```typescript
export function useOnboardingVoiceConversation() {
  const realtime = useRealtimeOnboardingSession();
  
  return {
    // ... existing methods
    speakExact: realtime.speakExact,  // ← NEW
  };
}
```

---

## EXECUTION FLOW: Detailed Step-by-Step

### Step 1: Connection & Initialization (happens once)
```
handleStartExperience() called
  ├─ setPhase("voice_active")
  ├─ const session = initializeSession()
  │  └─ session.currentBeat = GREETING
  │  └─ session.status = "active"
  │
  ├─ const controller = new BeatController(session, {...callbacks...})
  │
  └─ await controller.startBeat()
```

### Step 2: Beat 1 - GREETING
```
controller.startBeat() executes
  ├─ Get beat config: BEAT_SCRIPTS[GREETING]
  ├─ Get script: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
  ├─ Call onBeatStart(GREETING, script)
  │
  └─ In component callback:
     └─ await voice.speakExact(script)
        └─ openai-realtime-client.speakExact(script)
           ├─ Create conversation.item.create event
           ├─ Send to Realtime WebSocket
           ├─ Realtime synthesizes audio
           ├─ Audio flows back via WebRTC
           └─ Audio element plays
```

### Step 3: User Speaks (anything)
```
Realtime captures user audio
  ├─ Transcribes audio
  ├─ Sends transcript event
  └─ app/experience/page.tsx receives transcript
     └─ Detects final user message
        └─ Call: controller.advanceBeat(null, 0.99, false)
```

### Step 4: Beat Advancement
```
controller.advanceBeat() executes
  ├─ Call onBeatComplete(currentBeat, null)
  ├─ Determine next beat: getNextBeat(GREETING) → PRODUCT
  ├─ Update session: currentBeat = PRODUCT
  └─ Call: await startBeat()
     └─ LOOPS BACK TO STEP 2 with PRODUCT beat
```

### Steps 5-7: Beats 2-4 (PRODUCT, CUSTOMER, EXPERIMENT)
```
Same pattern repeats for each beat.
Controller determines progression automatically.
Same script is spoken every time.
```

### Step 8: End of Sequence
```
After EXPERIMENT beat:
  ├─ User says "yes" or "no" (or just anything in Phase 1B)
  ├─ controller.advanceBeat() advances
  │
  ├─ For "yes": next beat = PHONE
  │  └─ "Great. I'll need your phone number..."
  │
  └─ For "no": next beat = CLOSED
     └─ "No problem at all..."
        └─ session.status = "completed"
           └─ Trigger onSessionComplete() callback
              └─ setPhase("collecting_phone")
```

---

## VOICE OUTPUT MECHANISM

### Current State (Kill Switch PR)
- ❌ No `speakExact()` method exists yet
- ❌ openai-realtime-client can only use `response.create` with instructions
- ❌ No public method to inject conversation items

### Required Implementation

**New method in openai-realtime-client.ts:**

```typescript
async speakExact(text: string): Promise<void> {
  // Step 1: Create conversation item event
  const createItemEvent: RealtimeSessionEvent = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: text,
        },
      ],
    },
  };

  // Step 2: Send to Realtime
  this.sendEvent(createItemEvent);

  // Step 3: Request synthesis without generation
  const responseEvent: RealtimeSessionEvent = {
    type: "response.create",
    response: {
      // CRITICAL: No instructions that could trigger model generation
      // The conversation already has the message content
      modalities: ["text", "audio"],  // Request audio synthesis
      instructions: undefined,  // Empty instructions
    },
  };

  // Step 4: Send synthesis request
  this.sendEvent(responseEvent);

  // Step 5: Return immediately
  // Audio will play automatically when received via WebRTC track
  return;
}
```

**Flow Diagram:**
```
speakExact("Hi, I'm Zeya...")
  │
  ├─ conversation.item.create
  │  └─ { role: "assistant", content: "Hi, I'm Zeya..." }
  │
  ├─ response.create
  │  └─ { modalities: ["text", "audio"] }
  │
  ├─ Realtime synthesizes the text to speech
  │  (No model inference, deterministic TTS)
  │
  ├─ response.audio.delta events
  │  └─ Audio chunks arrive via WebSocket
  │
  ├─ WebRTC track receives audio
  │
  └─ HTML audio element plays it
```

---

## BEAT PROGRESSION LOGIC

### State Transitions (Deterministic)

```
GREETING
  ↓ (user speaks anything)
PRODUCT
  ↓ (user speaks anything)
CUSTOMER
  ↓ (user speaks anything)
EXPERIMENT
  ↓ (user says yes/no)
  ├─ YES → PHONE
  │         ↓ (user says anything)
  │       CLOSED ← END
  │
  └─ NO → CLOSED ← END
```

**Implementation in getNextBeat():**
```typescript
export function getNextBeat(
  currentBeat: ExperienceBeat,
  extractedValue: string | null,
  decision?: "yes" | "no"
): ExperienceBeat {
  switch (currentBeat) {
    case ExperienceBeat.GREETING:
      return ExperienceBeat.PRODUCT;
    case ExperienceBeat.PRODUCT:
      return ExperienceBeat.CUSTOMER;
    case ExperienceBeat.CUSTOMER:
      return ExperienceBeat.EXPERIMENT;
    case ExperienceBeat.EXPERIMENT:
      return decision === "yes" ? ExperienceBeat.PHONE : ExperienceBeat.CLOSED;
    case ExperienceBeat.PHONE:
      return ExperienceBeat.CLOSED;
    default:
      return ExperienceBeat.CLOSED;
  }
}
```

**No decision-making logic. Pure state machine.**

---

## HOW OPENAI CANNOT GENERATE DIALOGUE

### Path Analysis

**Old pathway (DEAD):**
```
response.create { instructions: "You are a host..." }
  ↓
OpenAI interprets instructions
  ↓
OpenAI decides what to say
  ↓
OpenAI generates audio
```

**New pathway (Phase 1B):**
```
conversation.item.create { role: "assistant", content: "Hi, I'm Zeya..." }
  ↓
response.create { modalities: ["text", "audio"] }
  ↓
Realtime sees: "This message is already in the conversation"
  ↓
Realtime synthesizes the existing text to speech
  ↓
NO model inference happens
  ↓
Audio plays
```

**Why OpenAI cannot drift:**
1. ✅ No instructions field (empty or undefined)
2. ✅ No "interpret this guidance" signals
3. ✅ Message content is already specified in conversation
4. ✅ No reasoning required (just TTS)
5. ✅ No decision-making authority given to model

**Proof: Can you run 20 times and get different outputs?**
- ❌ NO. Same script every time.
- ❌ Why? Because the text is predetermined, not generated.
- ❌ The model is not generating anything—only synthesizing to audio.

---

## FILES TO MODIFY

| File | Change | Risk |
|------|--------|------|
| app/experience/page.tsx | Add BeatController init in handleStartExperience | LOW (isolated) |
| lib/realtime/openai-realtime-client.ts | Add speakExact() method | LOW (new method) |
| hooks/realtime/useRealtimeOnboardingSession.ts | Export speakExact callback | LOW (new export) |
| hooks/voice/useOnboardingVoiceConversation.ts | Wire speakExact | LOW (new export) |

**Files that do NOT change:**
- ✅ lib/experience/beat-controller.ts
- ✅ lib/experience/experience-beats.ts
- ✅ lib/experience/experience-state.ts

---

## TEST PROCEDURE

### Manual Test: 20 runs

**Setup:**
1. Deploy code
2. Open `/experience` in browser
3. Run conversation 20 times

**Expected Output (every single time):**
```
[Beat 1] "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
↓
[Beat 2] "Nice to meet you, [Name]. What does your business sell?"
↓
[Beat 3] "Who usually buys it?"
↓
[Beat 4] "Got it. I'd like to show you something. We run a small experiment with businesses like yours—gives you a real sense of how this works before you decide anything. Would you be willing to try it?"
↓
[Beat 5A] "Great. I'll need your phone number to set this up. What's the best number to reach you?"
        OR
[Beat 5B] "No problem at all. If you ever want to see how it works, you know where to find me."
```

**Variation tolerance:** ZERO

**Success criteria:**
- ✅ Same 5-beat sequence every run
- ✅ Same wording every run
- ✅ No consulting questions
- ✅ No variation
- ✅ No drift

**Failure indicators:**
- ❌ Different phrasing ("Tell me more", "What are your goals?", etc.)
- ❌ Extra questions between beats
- ❌ Variable output
- ❌ Any AI-generated content

---

## SUMMARY

**What this validates:**
1. ✅ BeatController can drive state progression
2. ✅ Beat scripts are delivered deterministically
3. ✅ No OpenAI generation happens
4. ✅ Architecture separates voice output from AI reasoning
5. ✅ Ready for Phase 2 (extraction service)

**What this does NOT do:**
- ❌ Extract visitor data (no extraction yet)
- ❌ Validate extraction accuracy
- ❌ Test error handling
- ❌ Test fallback logic
- ❌ Validate intent detection

**Next phase after validation:**
- Phase 2: Add extraction service to understand user responses
- Phase 3: Connect extraction to beat progression logic

---

## DECISION POINT

Before I implement:

**Question 1:** Is the execution path clear?
- Does the flow from BeatController → speakExact() → Realtime synthesis make sense?

**Question 2:** Should speakExact() wait for audio to finish before returning?
- Option A: Return immediately (fire and forget)
- Option B: Wait for audio to finish playing (blocking)

**Question 3:** For Phase 1B testing, how should we handle user input?
- Option A: Any speech (duration > 1 second) advances beat
- Option B: Hardcode advancement after beat timeout
- Option C: Both (whichever comes first)

**Ready to implement?**

