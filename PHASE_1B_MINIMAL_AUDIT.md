# Phase 1B: Minimal Deterministic Flow Audit

**Scope:** Architecture validation only. Zero intelligence.

---

## EXECUTION PATH (Simplified)

```
User clicks "Start Experience"
  ↓
handleStartExperience()
  ├─ const session = initializeSession()
  ├─ const controller = new BeatController(session, { onBeatStart, ... })
  └─ await controller.startBeat()

BeatController.startBeat() [Iteration 1]
  ├─ beat = session.currentBeat (GREETING)
  ├─ script = getBeatScript(GREETING)
  │  └─ Returns: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
  ├─ Call onBeatStart(beat, script)
  │
  └─ (in app/experience/page.tsx callback)
     └─ await voice.speakExact(script)
        └─ openai-realtime-client.speakExact(script)
           ├─ Send conversation.item.create + response.create
           ├─ Realtime synthesizes text to speech (deterministic TTS, no model inference)
           └─ Return immediately (fire-and-forget)

Audio plays automatically via WebRTC

User speaks anything (transcript event fires)
  ├─ "hello"
  ├─ "testing"
  ├─ "banana"
  └─ (content doesn't matter)

app/experience/page.tsx receives transcript
  ├─ Detect final user message (isFinal = true)
  └─ Call controller.advanceBeat(null, 1.0, false)
     ├─ session.currentBeat = PRODUCT
     └─ await controller.startBeat()  [LOOP BACK]

BeatController.startBeat() [Iteration 2]
  ├─ beat = session.currentBeat (PRODUCT)
  ├─ script = getBeatScript(PRODUCT)
  │  └─ Returns: "Nice to meet you, Martin. What does your business sell?"
  └─ await voice.speakExact(script)

REPEAT for CUSTOMER → EXPERIMENT → PHONE → END
```

---

## FILES INVOLVED

### 1. app/experience/page.tsx
**Change:** Replace empty handleStartExperience with BeatController initialization

**Before:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  // Old conversational path disabled
};
```

**After:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  
  const session = initializeSession();
  const controller = new BeatController(session, {
    onBeatStart: async (beat, script) => {
      await voice.speakExact?.(script);
    },
    onBeatComplete: () => {},
    onSessionComplete: () => {
      stopConversation();
      setPhase("collecting_phone");
    },
  });
  
  await controller.startBeat();
};
```

**Key:** Also detect final user transcripts and call `controller.advanceBeat()` when any speech is detected.

### 2. lib/realtime/openai-realtime-client.ts
**New method:** `speakExact(text: string)`

**Responsibility:** Inject conversation item, request synthesis, return immediately

**Method:**
```typescript
speakExact(text: string): void {
  // Step 1: Inject the text as an assistant message in the conversation
  const itemEvent: RealtimeSessionEvent = {
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
  
  this.sendEvent(itemEvent);

  // Step 2: Request synthesis of the message
  const responseEvent: RealtimeSessionEvent = {
    type: "response.create",
    response: {
      modalities: ["audio"],  // Only audio, no text generation
    },
  };
  
  this.sendEvent(responseEvent);
  
  // Step 3: Return immediately (fire-and-forget)
  // Audio will play automatically when Realtime sends it back
}
```

**Why this works:**
- ✅ Text is predetermined in conversation (not generated)
- ✅ Response only requests audio synthesis (no instructions)
- ✅ No model inference happens
- ✅ Realtime just converts text to speech

### 3. hooks/realtime/useRealtimeOnboardingSession.ts
**New export:** `speakExact` callback

**Change:**
```typescript
const speakExact = useCallback((text: string) => {
  clientRef.current?.speakExact(text);
}, []);

return {
  ...snapshot,
  isConfigured: true,
  provider: "openai-realtime" as const,
  startConversation,
  stopConversation,
  speakExact,  // ← NEW
  // ... rest
};
```

### 4. hooks/voice/useOnboardingVoiceConversation.ts
**New export:** Wire `speakExact` through

**Change:**
```typescript
return {
  // ... existing
  speakExact: realtime?.speakExact,  // ← NEW
  // ... rest
};
```

### 5. lib/experience/beat-controller.ts
**No changes** — Already has `startBeat()` and `advanceBeat()`

### 6. lib/experience/experience-beats.ts
**No changes** — Already has scripts defined

### 7. lib/experience/experience-state.ts
**No changes** — Already has session management

---

## OWNERSHIP CLARITY

### Voice Output Ownership
```
app/experience/page.tsx (BeatController callback)
  ↓
voice.speakExact(script)
  ↓
openai-realtime-client.speakExact(text)
  ├─ Creates conversation.item.create event
  ├─ Creates response.create event (synthesis only)
  └─ Sends to Realtime
     ↓
     Realtime synthesizes audio
     ↓
     Audio plays via WebRTC track
```

**Authority:** Application controls exact text. OpenAI only synthesizes.

### Beat Progression Ownership
```
app/experience/page.tsx (transcript listener)
  ├─ Detects final user transcript
  └─ Calls controller.advanceBeat()
     ├─ Updates session.currentBeat
     └─ Calls startBeat() again
        ↓
        Loop continues
```

**Authority:** BeatController determines next beat via `getNextBeat()`. No model inference.

---

## PROOF: OPENAI CANNOT GENERATE DIALOGUE

### Pathway Analysis

**Old path (DEAD):**
```
response.create { instructions: "You are a host..." }
  → OpenAI decides what to say
  → OpenAI generates answer
```

**New path (Phase 1B):**
```
conversation.item.create { role: "assistant", content: "Hi, I'm Zeya..." }
response.create { modalities: ["audio"] }
  → Realtime sees: "This message is already in conversation"
  → Realtime synthesizes text to speech
  → NO model inference
  → NO decision-making
```

### Why Drift is Impossible

1. ✅ No `instructions` field sent (empty response object)
2. ✅ Message content predetermined (not generated)
3. ✅ No reasoning authority given to model
4. ✅ Only TTS capability invoked
5. ✅ No prompt guidance
6. ✅ No contextual interpretation

### Test: 20 runs, same output?
- Expected: YES, always the same
- Why: Because text is predetermined, not generated
- Proof: No model inference = no variation possible

---

## HARDCODED VALUES (Phase 1B only)

```typescript
// app/experience/page.tsx
const HARDCODED_NAME = "Martin";

// In getBeatScript callback or similar:
const script = getBeatScript(beat, { visitorName: HARDCODED_NAME });
```

**Result:**
```
Beat 2 always says: "Nice to meet you, Martin. What does your business sell?"
Beat 3 always says: "And who usually buys it?"
```

**No extraction, no parsing, no variable logic.**

---

## ADVANCEMENT LOGIC (Phase 1B only)

```typescript
// In app/experience/page.tsx, detect transcript and advance immediately

useEffect(() => {
  if (phase !== "voice_active") return;
  
  // If we received ANY final user message
  const lastUserMessage = voiceTranscript
    .filter(entry => entry.role === "user" && entry.isFinal)
    .pop();
  
  if (lastUserMessage && lastUserMessage.text?.trim()) {
    // Advance beat. No interpretation, no validation.
    controller.advanceBeat(null, 1.0, false);
  }
}, [voiceTranscript, phase]);
```

**Key:** No extraction, no validation, no content analysis. If transcript exists and is final, advance.

---

## COMPLETE FLOW (No Branching)

```
Beat 1: GREETING
  "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
  → User speaks anything → Advance

Beat 2: PRODUCT
  "Nice to meet you, Martin. What does your business sell?"
  → User speaks anything → Advance

Beat 3: CUSTOMER
  "And who usually buys it?"
  → User speaks anything → Advance

Beat 4: EXPERIMENT
  "Got it. I'd like to show you something. Would you be willing to try a small experiment?"
  → User speaks anything → Advance

Beat 5: PHONE
  "Great. What's the best number to reach you?"
  → User speaks anything → Done

End: session.status = "completed"
```

**No conditional branches. No yes/no detection. No phone validation. Pure state machine.**

---

## FILES TOUCHED (Complete List)

| File | Type | Change |
|------|------|--------|
| app/experience/page.tsx | MODIFY | Wire BeatController, add transcript listener |
| lib/realtime/openai-realtime-client.ts | MODIFY | Add speakExact() method |
| hooks/realtime/useRealtimeOnboardingSession.ts | MODIFY | Export speakExact |
| hooks/voice/useOnboardingVoiceConversation.ts | MODIFY | Wire speakExact |
| lib/experience/beat-controller.ts | NO CHANGE | Already has methods |
| lib/experience/experience-beats.ts | NO CHANGE | Already has scripts |
| lib/experience/experience-state.ts | NO CHANGE | Already has state |

**Total changes: 4 files modified, 3 files untouched**

---

## FUNCTIONS TOUCHED

### New Functions
- `openai-realtime-client.ts::speakExact(text)` — Deterministic synthesis

### Modified Functions
- `useRealtimeOnboardingSession.ts::return` — Export speakExact callback
- `useOnboardingVoiceConversation.ts::return` — Wire speakExact
- `app/experience/page.tsx::handleStartExperience` — Initialize BeatController
- `app/experience/page.tsx::useEffect` (new) — Transcript listener for advancement

### Unchanged Functions
- `beat-controller.ts::startBeat()`
- `beat-controller.ts::advanceBeat()`
- `experience-beats.ts::getBeatScript()`
- `experience-beats.ts::getNextBeat()`
- `experience-state.ts::initializeSession()`

---

## VALIDATION PROOF

### Build Passes
```bash
npm run build
# Expected: ✓ Compiled successfully
```

### Grep Validation
```bash
# No response.create with instructions
grep "response.create" lib/realtime/openai-realtime-client.ts
# Expected output: response.create with modalities only, no instructions field

# No requestResponse with instructions
grep "requestResponse" app/experience/page.tsx
# Expected output: (none)

# No sendNextQuestion
grep "sendNextQuestion" app/experience/page.tsx
# Expected output: (none)

# No sendAction
grep "sendAction" app/experience/page.tsx
# Expected output: (none)
```

---

## SUCCESS CRITERIA (Measurable)

✅ **Criterion 1:** Same 5-beat sequence every run
✅ **Criterion 2:** Same script wording every run (hardcoded name "Martin")
✅ **Criterion 3:** No OpenAI-generated dialogue
✅ **Criterion 4:** No consulting drift
✅ **Criterion 5:** No prompts controlling conversation
✅ **Criterion 6:** Build passes (npm run build)
✅ **Criterion 7:** No intelligence, no extraction, no reasoning

---

## WHAT THIS PROVES

✅ BeatController can drive state progression
✅ Script lookup works deterministically
✅ Voice synthesis works without model generation
✅ Transcript detection can trigger advancement
✅ Architecture separates voice from reasoning
✅ Ready for Phase 1C (add extraction service)

---

## WHAT THIS DOES NOT DO

❌ Extract visitor data
❌ Validate extraction accuracy
❌ Handle yes/no detection
❌ Parse phone numbers
❌ Manage timeouts
❌ Implement fallbacks
❌ Integrate with onboarding
❌ Build any intelligence

---

## READY TO CODE?

All decisions made:
- ✅ Audio timing: Fire-and-forget
- ✅ User advancement: Any transcript
- ✅ Name handling: Hardcoded "Martin"

Proceed with implementation.

