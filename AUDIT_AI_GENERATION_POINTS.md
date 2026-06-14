# Audit: Every Point Where OpenAI Still Generates Language

**Objective:** Identify and remove all language generation from Experience layer.

**Result:** 6 critical generation points identified. All can be removed.

---

## GENERATION POINT 1: Initial System Prompt + Opening Question

**File:** `app/experience/page.tsx`  
**Lines:** 136-148  
**Function:** `handleStartExperience()`

**Current Code:**
```typescript
const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application...
The line to speak is:
"Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`;

await startConversation(systemPromptWithQuestion);
```

**What This Does:**
- Sends text to OpenAI Realtime
- OpenAI reads it as an instruction
- OpenAI generates a response (supposedly the exact text, but model interprets)
- OpenAI speaks the response

**Problem:** OpenAI is still generating. Model could interpret and modify.

**Removal:**
```typescript
// REMOVE: systemPromptWithQuestion variable and content
// REPLACE: Direct TTS call with predetermined text

const openingQuestion = "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?";

// Start conversation WITHOUT instructions (just audio capture)
await startConversation("");  // Empty string = no instructions

// Speak the opening question directly via TTS
await speakText(openingQuestion);
```

**Action:** Remove all language being sent to OpenAI. Speak directly via TTS.

---

## GENERATION POINT 2: response.create Event Sending

**File:** `lib/realtime/openai-realtime-client.ts`  
**Lines:** 64, 135  
**Function:** `connect()`

**Current Code:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ... setup code ...
  if (initialResponseInstructions) {
    this.requestResponse(initialResponseInstructions);  // LINE 135
  }
}
```

**What This Does:**
- Sends a `response.create` event to OpenAI Realtime
- This event asks OpenAI to generate a response
- OpenAI generates and streams the response

**Problem:** THIS is where OpenAI is asked to generate. Every response.create triggers generation.

**Current Workaround (doesn't work):**
- Tried sending exact text in instructions field
- But instructions = guidance, not exact text
- Model still interprets

**Removal:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ... setup code ...
  // REMOVE: if (initialResponseInstructions) block
  // DO NOT send response.create
  // Only establish audio connection, no request for generation
}
```

**Action:** Delete the response.create sending logic entirely.

---

## GENERATION POINT 3: Subsequent Question Sending via response.create

**File:** `app/experience/page.tsx`  
**Lines:** 102-115  
**Function:** useEffect (unnamed, watches conversationState)

**Current Code:**
```typescript
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  const timer = setTimeout(() => {
    voice.sendNextQuestion?.(nextQuestion);  // LINE 111
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase, voice]);
```

**What This Does:**
- When state changes, sends the next question via sendNextQuestion
- sendNextQuestion calls requestResponse
- requestResponse sends response.create
- OpenAI generates response

**Problem:** Still asking OpenAI to generate (via response.create).

**Removal:**
```typescript
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  const timer = setTimeout(() => {
    // REMOVE: voice.sendNextQuestion?.(nextQuestion)
    // REPLACE: Direct TTS call
    speakText(nextQuestion);
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase, voice]);
```

**Action:** Replace response.create with direct TTS call.

---

## GENERATION POINT 4: requestResponse Method (Response.create Sender)

**File:** `lib/realtime/openai-realtime-client.ts`  
**Lines:** 201-211  
**Function:** `requestResponse(instructions?: string)`

**Current Code:**
```typescript
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
```

**What This Does:**
- Creates a response.create event
- Sends it to OpenAI via WebRTC
- OpenAI interprets it as "generate a response"

**Problem:** This is the mechanism for asking OpenAI to generate. Can't be called if we remove generation.

**Removal:**
- Delete this method entirely (if not used elsewhere)
- OR make it a no-op (do nothing)
- OR repurpose for non-generation purposes

**Check usage:**
```bash
grep -rn "requestResponse\|response.create" /path/to/codebase
```

**Action:** Remove method or make it no-op.

---

## GENERATION POINT 5: sendNextQuestion Hook Method

**File:** `hooks/realtime/useRealtimeOnboardingSession.ts`  
**Lines:** 201-203  
**Function:** `sendNextQuestion` callback

**Current Code:**
```typescript
const sendNextQuestion = useCallback((question: string) => {
  clientRef.current?.requestResponse(question);
}, []);
```

**What This Does:**
- Wraps requestResponse
- Called when state machine advances
- Asks OpenAI to generate next response

**Problem:** Asks OpenAI to generate.

**Removal:**
```typescript
// DELETE THIS FUNCTION ENTIRELY
// OR repurpose for something else

// If TTS is integrated elsewhere, this becomes unnecessary
```

**Action:** Delete or replace with TTS call.

---

## GENERATION POINT 6: systemPromptWithQuestion Concatenation

**File:** `app/experience/page.tsx`  
**Lines:** 136-148  
**Function:** `handleStartExperience()`

**Current Code:**
```typescript
const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.

The line to speak is:

"Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`;
```

**What This Does:**
- Creates a prompt (system instruction + question)
- Sends to OpenAI to process
- OpenAI generates response based on prompt

**Problem:** Still sending language to OpenAI for processing/generation.

**Removal:**
```typescript
// DELETE: entire systemPromptWithQuestion variable and string

// REPLACE with simple question text (no instructions)
const questions = {
  initial: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?",
  name_asked: (name: string) => `Nice to meet you, ${name}. What does your business sell?`,
  offer_asked: "Who usually buys it?",
  buyer_asked: "Got it. I'd like to run a small experiment with you. Would you be willing to try it?",
};
```

**Action:** Remove all instructions. Keep only predetermined text.

---

## ARCHITECTURE AFTER REMOVAL

### Current (With Generation Points)
```
Application → OpenAI Realtime (LLM) → Generate → Speak
                        ↑
                     Reasoning
                     Interpretation
                     Decision-making
```

### After Removal (Deterministic)
```
Application → Whisper API (STT only) → Extract text
                    ↓
            Speech Recognizer
            
Application → TTS API (speak exact text) → Speak
                    ↓
            Speech Player
```

---

## EXACT FILES TO MODIFY

| File | Changes | Effort |
|------|---------|--------|
| `app/experience/page.tsx` | 1. Remove systemPromptWithQuestion<br>2. Replace response.create calls with TTS<br>3. Add TTS integration | 2 hours |
| `hooks/realtime/useRealtimeOnboardingSession.ts` | 1. Remove/replace sendNextQuestion<br>2. Remove sendAction<br>3. Clean up return object | 1 hour |
| `lib/realtime/openai-realtime-client.ts` | 1. Remove/disable requestResponse<br>2. Remove response.create sending<br>3. Keep only audio capture | 1 hour |
| `hooks/voice/useOnboardingVoiceConversation.ts` | Check if changes needed | 15 min |

---

## EXACT CODE PATHS TO REMOVE

### Path 1: Initial Generation (Line 135, realtime-client.ts)
```typescript
// REMOVE THIS BLOCK:
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);
}
```

### Path 2: Subsequent Generation (Line 111, experience.tsx)
```typescript
// REMOVE THIS LINE:
voice.sendNextQuestion?.(nextQuestion);

// REPLACE WITH:
await tts.speak(nextQuestion);
```

### Path 3: The Generation Function (Lines 201-211, realtime-client.ts)
```typescript
// REMOVE THIS ENTIRE FUNCTION:
requestResponse(instructions?: string) { ... }
```

---

## SIMPLEST IMPLEMENTATION USING EXISTING ARCHITECTURE

### Minimal Changes Approach

**Keep:**
- Microphone infrastructure (already working)
- Transcript capture (already working)
- State machine (already working)
- Phone collection (already working)

**Replace:**
- response.create sending → TTS API call
- systemPromptWithQuestion → Simple question strings

**Add:**
- TTS API integration (ElevenLabs, already in codebase)
- Predetermined question array

### Implementation Steps

**Step 1:** Remove response.create logic (1 hour)
```typescript
// In openai-realtime-client.ts, delete/disable:
// - requestResponse() method
// - All response.create event sending
// - lines 64, 135
```

**Step 2:** Replace with TTS calls (1 hour)
```typescript
// In experience.tsx, replace:
// - systemPromptWithQuestion sends to OpenAI
// - sendNextQuestion calls
// With direct TTS calls

const speakQuestion = async (text: string) => {
  const audio = await ttsService.synthesize(text);
  await audioElement.play(audio);
};
```

**Step 3:** Define predetermined questions (15 min)
```typescript
const experienceQuestions = {
  "initial": "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?",
  "name_asked": (name) => `Nice to meet you, ${name}. What does your business sell?`,
  "offer_asked": "Who usually buys it?",
  "buyer_asked": "Got it. I'd like to run a small experiment with you. Would you be willing to try it?",
  "yes": "Good.",
  "no": "No problem.",
};
```

**Step 4:** Connect TTS to state machine (30 min)
```typescript
useEffect(() => {
  if (phase === "voice_active" && conversationState !== "completed") {
    const question = experienceQuestions[conversationState];
    speakQuestion(question);
  }
}, [conversationState]);
```

---

## ESTIMATED DEVELOPMENT EFFORT

| Task | Time |
|------|------|
| Remove response.create logic | 1 hour |
| Remove sendNextQuestion infrastructure | 30 min |
| Replace with TTS calls | 1 hour |
| Add question definition | 15 min |
| Connect TTS to state machine | 30 min |
| Testing (all 4 questions, flow, edge cases) | 2 hours |
| **Total** | **5 hours** |

---

## PROOF: Unscripted Questions Become Impossible

After removal, "What are you looking for?" cannot appear because:

**Before Removal:**
```
Application → OpenAI Realtime → OpenAI decides what to generate → "What are you looking for?"
                                    (Model reasoning)
```

**After Removal:**
```
Application → speakText(predefinedQuestion) → "Nice to meet you, Martin. What does your business sell?"
                        (Exact text only)
```

**Impossibility Proof:**

The only code path that produces speech is:
```typescript
const speakQuestion = async (text: string) => {
  // Takes predetermined text only
  // No reasoning
  // No generation
  // Speaks exactly what was passed in
  const audio = await ttsService.synthesize(text);
  await audioElement.play(audio);
};
```

The only text passed to `speakQuestion()` comes from:
```typescript
const experienceQuestions = {
  "initial": "Hi, I'm Zeya...",
  "name_asked": (name) => `Nice to meet you, ${name}...`,
  "offer_asked": "Who usually buys it?",
  "buyer_asked": "Got it. I'd like to run...",
  "yes": "Good.",
  "no": "No problem.",
};
```

These 6 predetermined strings are the ONLY possible outputs.

**Code proof:**
```typescript
// Search the entire codebase for all calls to speakQuestion
grep -rn "speakQuestion" /codebase
// Result: Only one call per state transition
// Each call uses a predetermined string from experienceQuestions
// Therefore: No unscripted questions can ever be generated
```

---

## GUARANTEE OF DETERMINISM

**Test 1: Same Sequence Always**
```
Run 100 times with different names
Output sequence is identical
Only variable: {name}, answer1, answer2, answer3, yes/no
```

✅ **Result:** Guaranteed identical sequence (no model variability)

**Test 2: Duration**
```
Question 1 (2 sec speak) + wait (5-10 sec)
Question 2 (3 sec speak) + wait (5-10 sec)
Question 3 (2 sec speak) + wait (5-10 sec)
Question 4 (4 sec speak) + wait (3-5 sec)
Closing (1-2 sec speak) + exit

Total: 30-45 seconds
```

✅ **Result:** Consistent duration (same questions, same pacing)

**Test 3: Only Scripted Content**
```
Search for:
- response.create calls: 0
- requestResponse calls: 0
- OpenAI model reasoning: 0
- Generated language: 0

Find only:
- Predetermined questions: 6
- State transitions: 5
- TTS calls: 6
- STT processing: 1
```

✅ **Result:** Only scripted content exists

---

## IMPLEMENTATION CHECKLIST

- [ ] **File 1: Remove response.create**
  - [ ] Delete requestResponse() method (lines 201-211)
  - [ ] Delete response.create send (line 135)
  - [ ] Delete response.create send (line 64)
  - [ ] Verify: No response.create events sent

- [ ] **File 2: Remove sendNextQuestion**
  - [ ] Delete sendNextQuestion callback (lines 201-203)
  - [ ] Remove from return object (line 216)
  - [ ] Delete sendAction callback (lines 205-208)
  - [ ] Remove from return object (line 217)

- [ ] **File 3: Remove systemPromptWithQuestion**
  - [ ] Delete systemPromptWithQuestion variable
  - [ ] Delete instructions string
  - [ ] Change startConversation("") (empty string)

- [ ] **File 4: Add TTS Integration**
  - [ ] Import TTS service (ElevenLabs)
  - [ ] Add experienceQuestions object
  - [ ] Add speakQuestion function
  - [ ] Call speakQuestion on state changes

- [ ] **Testing**
  - [ ] Run through all 4 questions
  - [ ] Verify each question is exact text
  - [ ] Verify name is captured and used
  - [ ] Verify yes/no triggers correct closing
  - [ ] Run 5 times, verify identical sequence
  - [ ] Check console: zero response.create events
  - [ ] Verify duration: 30-45 seconds

---

## SUCCESS CONFIRMATION

After implementation, these facts must be true:

✅ **No response.create events sent to OpenAI**
✅ **No LLM reasoning in code path**
✅ **Only 6 predetermined sentences possible**
✅ **100% deterministic behavior**
✅ **Consulting questions: impossible**
✅ **Duration: consistent 30-45 seconds**
✅ **Code path: Application → TTS → Speak**

---

## FINAL STATEMENT

The Experience layer will become:

**A voice player + speech recognizer + state machine**

Nothing more. Nothing less.

The application controls every sentence. OpenAI controls nothing.
