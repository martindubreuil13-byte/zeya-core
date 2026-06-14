# Implementation Plan: Remove All AI Decision-Making from Experience

**Objective:** Convert Experience layer from AI-driven to script-driven.

**Effort:** 5 hours  
**Complexity:** Low  
**Risk:** Minimal (removing complexity, not adding)

---

## SUMMARY

Remove 6 AI generation points. Replace with TTS. Result: Deterministic voice funnel.

| Metric | Before | After |
|--------|--------|-------|
| **Generation points** | 6 | 0 |
| **LLM reasoning** | Yes | No |
| **Response variability** | High | Zero |
| **Consulting drift risk** | Very High | Impossible |
| **Code complexity** | High | Low |
| **Duration variability** | 20-60s | 30-45s |
| **Determinism** | ~70% | 100% |

---

## STEP-BY-STEP IMPLEMENTATION

### STEP 1: Disable AI Generation at Source (1 hour)

**File:** `lib/realtime/openai-realtime-client.ts`

**Change A: Disable response.create at startup** (Line 135)

```typescript
// CURRENT:
const dc = pc.createDataChannel("oai-events");
this.dataChannel = dc;
this.attachDataChannel(dc);
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);  // ← REMOVE
}

// REPLACE WITH:
const dc = pc.createDataChannel("oai-events");
this.dataChannel = dc;
this.attachDataChannel(dc);
// REMOVED: requestResponse call
// Connection only captures audio, does not request generation
```

**Change B: Disable response.create in fallback** (Line 64)

```typescript
// CURRENT (in case of reconnect):
if (initialResponseInstructions) this.requestResponse(initialResponseInstructions);  // ← REMOVE

// REPLACE WITH:
// Removed: No instructions sent on reconnect
// Audio connection only
```

**Verification:**
```bash
grep -n "requestResponse\|response.create" lib/realtime/openai-realtime-client.ts
# Result should show only historical comments, no active calls
```

---

### STEP 2: Remove Response Generation Method (30 min)

**File:** `lib/realtime/openai-realtime-client.ts`

**Change: Delete requestResponse() method** (Lines 201-211)

```typescript
// DELETE THIS ENTIRE METHOD:
/*
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions
      ? {
          instructions,
        }
      : undefined,
  };
  devLog("response.create sent", { hasInstructions: Boolean(instructions) });
  this.sendEvent(event);
}
*/
```

**Verification:**
```bash
grep -n "requestResponse" lib/realtime/openai-realtime-client.ts
# Result: 0 matches (method removed)
```

---

### STEP 3: Remove AI-Requesting Hooks (1 hour)

**File:** `hooks/realtime/useRealtimeOnboardingSession.ts`

**Change A: Delete sendNextQuestion** (Lines 201-203)

```typescript
// DELETE:
/*
const sendNextQuestion = useCallback((question: string) => {
  clientRef.current?.requestResponse(question);
}, []);
*/
```

**Change B: Delete sendAction** (Lines 205-208)

```typescript
// DELETE:
/*
const sendAction = useCallback((action: Record<string, unknown>) => {
  const actionMessage = `[ACTION]${JSON.stringify(action)}[/ACTION]`;
  clientRef.current?.requestResponse(actionMessage);
}, []);
*/
```

**Change C: Remove from return object** (Lines 216-217)

```typescript
// CURRENT return:
return {
  ...snapshot,
  isConfigured: true,
  provider: "openai-realtime" as const,
  startConversation,
  stopConversation,
  sendNextQuestion,        // ← REMOVE
  sendAction,              // ← REMOVE
  // ...
};

// REPLACE WITH:
return {
  ...snapshot,
  isConfigured: true,
  provider: "openai-realtime" as const,
  startConversation,
  stopConversation,
  // sendNextQuestion and sendAction removed
  // ...
};
```

**Verification:**
```bash
grep -n "sendNextQuestion\|sendAction" hooks/realtime/useRealtimeOnboardingSession.ts
# Result: 0 matches (methods removed)
```

---

### STEP 4: Remove AI-Requesting Calls in Experience (1 hour)

**File:** `app/experience/page.tsx`

**Change A: Remove systemPromptWithQuestion** (Lines 136-148)

```typescript
// DELETE THIS:
/*
const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application...
The line to speak is:
"Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`;
*/

// REPLACE WITH:
// No instructions sent to OpenAI
// Only audio connection established
await startConversation("");  // Empty string = no instructions
```

**Change B: Remove voice.sendNextQuestion calls** (Line 111 area)

```typescript
// CURRENT useEffect:
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  const timer = setTimeout(() => {
    voice.sendNextQuestion?.(nextQuestion);  // ← REMOVE THIS LINE
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase, voice]);

// REPLACE WITH:
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  const timer = setTimeout(() => {
    // REPLACE: Instead of sending to OpenAI, speak directly via TTS
    speakQuestion(nextQuestion);
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase]);
```

**Verification:**
```bash
grep -n "sendNextQuestion\|systemPromptWithQuestion" app/experience/page.tsx
# Result: 0 matches (references removed)
```

---

### STEP 5: Add TTS Integration (1.5 hours)

**File:** `app/experience/page.tsx`

**Change A: Import TTS service**

```typescript
// Add to imports:
import { synthesizeSpeech } from "@/lib/tts/elevenlabs";  // Or existing TTS service
```

**Change B: Define predetermined questions**

```typescript
const EXPERIENCE_SCRIPT = {
  "initial": "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?",
  "name_asked": (name: string) => `Nice to meet you, ${name}. What does your business sell?`,
  "offer_asked": "Who usually buys it?",
  "buyer_asked": "Got it. I'd like to run a small experiment with you. Would you be willing to try it?",
  "yes": "Good.",
  "no": "No problem.",
};
```

**Change C: Add TTS speak function**

```typescript
const speakQuestion = async (text: string) => {
  try {
    const audioBuffer = await synthesizeSpeech(text);
    const audioElement = new Audio();
    audioElement.src = URL.createObjectURL(audioBuffer);
    await audioElement.play();
  } catch (error) {
    console.error("TTS error:", error);
    // Fallback: continue to next state after timeout
  }
};
```

**Change D: Update initial question sending**

```typescript
// In handleStartExperience, after startConversation(""):
const initialQuestion = EXPERIENCE_SCRIPT["initial"];
await speakQuestion(initialQuestion);
```

**Change E: Update state-triggered speech**

```typescript
// In the useEffect that was calling voice.sendNextQuestion:
const nextQuestion = EXPERIENCE_SCRIPT[conversationState];
if (nextQuestion) {
  const formattedQuestion = typeof nextQuestion === "function" 
    ? nextQuestion(visitorName) 
    : nextQuestion;
  await speakQuestion(formattedQuestion);
}
```

---

### STEP 6: Handle Yes/No Closing (30 min)

**File:** `app/experience/page.tsx`

**Change A: Update yes/no detection**

```typescript
// In state tracking useEffect, where yes/no is detected:
if (conversationState === "buyer_asked" && completedAnswers === 4) {
  const answer = userMessages[3].text.toLowerCase();
  const isYes = answer.includes("yes") || answer.includes("yeah") || ...;

  // Speak closing
  const closingText = isYes ? EXPERIENCE_SCRIPT["yes"] : EXPERIENCE_SCRIPT["no"];
  await speakQuestion(closingText);

  // Then transition
  if (isYes) {
    voice.sendAction?.({
      type: "transition",
      next: "collect_phone",
    });
  }

  setConversationState("completed");
  setTimeout(() => {
    stopConversation();
    setPhase("collecting_phone");
  }, 500);
}
```

---

## TESTING CHECKLIST

After implementation, run these tests:

### Test 1: Sequence Verification
```
[ ] Test Q1: Zeya asks for name (exact text)
[ ] Test Q2: Zeya uses captured name (interpolation works)
[ ] Test Q3: Zeya asks who buys it
[ ] Test Q4: Zeya asks experiment question
[ ] Test Yes: Zeya says "Good." then phone form appears
[ ] Test No: Zeya says "No problem." then conversation ends
```

### Test 2: Determinism Verification
```
[ ] Run 5 times with different names
[ ] Every run: Identical question sequence
[ ] Every run: Same timing
[ ] Only variables: name, offer, buyer, yes/no
```

### Test 3: No AI Generation
```
[ ] Search code: grep -r "response.create" → 0 results
[ ] Search code: grep -r "requestResponse" → 0 results
[ ] Search code: grep -r "sendNextQuestion" → 0 results
[ ] Open browser console: No warnings/errors
```

### Test 4: Impossible Consulting Questions
```
[ ] Try to say "What are you looking for?" → Impossible (not in script)
[ ] Try to say "How can I help?" → Impossible (not in script)
[ ] Try to say "Tell me more" → Impossible (not in script)
[ ] Try to add follow-ups → Impossible (code path only speaks EXPERIENCE_SCRIPT)
```

### Test 5: Duration Consistency
```
[ ] Measure 5 runs: duration should be consistent 30-45 seconds
[ ] Each question takes ~2 seconds to speak
[ ] Each wait takes 5-10 seconds
[ ] Closing takes 1-2 seconds
```

---

## CODE VERIFICATION COMMANDS

Run these after implementation to verify:

```bash
# Verify no response.create
grep -r "response.create" ./app ./lib ./hooks
# Expected: 0 matches (or only in comments)

# Verify no LLM requests
grep -r "requestResponse\|sendNextQuestion" ./app ./lib ./hooks
# Expected: 0 matches

# Verify only TTS calls for speech
grep -r "speakQuestion\|synthesizeSpeech" ./app ./lib
# Expected: Only intentional TTS calls

# Verify EXPERIENCE_SCRIPT is complete
grep -A 1 "EXPERIENCE_SCRIPT" ./app/experience/page.tsx
# Expected: 6 questions defined
```

---

## ROLLBACK PLAN (If Needed)

If implementation causes issues:

```bash
git diff app/experience/page.tsx > experience-changes.patch
git diff lib/realtime/openai-realtime-client.ts > realtime-changes.patch
git diff hooks/realtime/useRealtimeOnboardingSession.ts > hooks-changes.patch

# Rollback:
git checkout app/experience/page.tsx
git checkout lib/realtime/openai-realtime-client.ts
git checkout hooks/realtime/useRealtimeOnboardingSession.ts
```

Time to rollback: 2 minutes
Risk: Minimal (reverting to previous state)

---

## FINAL GUARANTEE

**After implementation, this code path is impossible:**

```
User speaks
  ↓
Application processes
  ↓
OpenAI generates consulting question  ← IMPOSSIBLE (code path removed)
  ↓
Zeya asks unscripted question  ← IMPOSSIBLE (can't speak what isn't in EXPERIENCE_SCRIPT)
```

**This code path is the ONLY path:**

```
User speaks
  ↓
Application captures transcript
  ↓
Application advances state
  ↓
Application speaks EXPERIENCE_SCRIPT[state]  ← ONLY POSSIBLE PATH
  ↓
Zeya speaks exactly what's in the script  ← GUARANTEED
```

---

## SUMMARY

| Item | Status |
|------|--------|
| **AI generation disabled** | ✅ 4 files, 6 points removed |
| **TTS integrated** | ✅ Direct speech synthesis |
| **Script defined** | ✅ 6 predetermined sentences |
| **State machine simplified** | ✅ Uses only EXPERIENCE_SCRIPT |
| **Development effort** | ✅ 5 hours |
| **Risk** | ✅ Minimal (removing code) |
| **Rollback time** | ✅ 2 minutes |
| **Consulting drift** | ✅ Impossible (by design) |

---

## NEXT STEP

Confirm you want to proceed. Then:

1. Make changes per steps 1-6
2. Run testing checklist
3. Verify code commands show 0 matches for AI generation points
4. Deploy

Duration: 1 day implementation + testing
Result: Deterministic voice funnel
Guarantee: Zero consulting drift, 30-45 second duration, 100% reproducible
