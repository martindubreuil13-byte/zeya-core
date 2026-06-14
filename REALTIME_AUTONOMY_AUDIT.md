# Audit: Where Model Autonomy Begins in Realtime

**Question:** Can the model be reduced to executing application-provided utterances only, while preserving Realtime's voice/latency/presence?

**Answer:** YES, with one critical fix.

---

## THE PROBLEM: Model Generating When It Should Only Execute

The Realtime API is being used to ask the model to **generate** responses. The model, being generative, interprets guidance and adds consulting questions.

What we need: The model should **execute** application-provided utterances only.

---

## POINT 1: Where Application Control is Lost

**File:** `app/experience/page.tsx`  
**Lines:** 136-148  
**Function:** `handleStartExperience()`

**Current Code:**
```typescript
const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.

The line to speak is:

"Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`;

await startConversation(systemPromptWithQuestion);
```

**What Happens:**
1. Application sends instructions to Realtime
2. Model reads instructions
3. Model interprets: "I should speak this line"
4. Model generates response based on interpretation
5. **Model controls the response** (this is where autonomy begins)

**Why Drift Occurs:**
- Instructions are guidance, not mandates
- Model sees conversation context (system instruction about states + opening question)
- Model thinks: "The user is telling me I'm Zeya in a conversation flow"
- Model interprets next turn as: "I should naturally continue the discovery conversation"
- Model generates: "What are you looking for?" (natural next step in discovery)

**The Leak:** The model receives GUIDANCE, not EXACT UTTERANCES.

---

## POINT 2: Where AI Autonomy Begins

**File:** `lib/realtime/openai-realtime-client.ts`  
**Method:** `requestResponse(instructions?: string)`  
**Event:** `response.create`

**Current Event Structure:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "Speak exactly: 'Hi, I'm Zeya...'"
  }
}
```

**What the Model Receives:**
```
Realtime API interprets this as:
"Here are instructions for generating a response"
```

**What Should Be Sent:**
```
Realtime API should interpret this as:
"Here is the exact text to speak, nothing more"
```

**The Critical Difference:**
- `instructions` field = "Here's guidance"
- Needed = "Here's the exact text"

**Why This Matters:**
The Realtime API's `instructions` field is designed for:
- System prompts ("You are helpful...")
- Behavior guidance ("Be concise...")
- Context ("The user just said...")

It is NOT designed for:
- Exact-text enforcement
- Locked-down utterances
- No-modification requirements

---

## POINT 3: Can Those Decisions Be Moved to Application Code?

**Short Answer:** YES

**Current Flow:**
```
Application (decides state)
  ↓
Realtime API (receives instruction)
  ↓
Model (decides how to execute instruction)  ← DECISION POINT
  ↓
Model generates response
  ↓
Model streams audio
```

**Target Flow:**
```
Application (decides state AND exact utterance)
  ↓
Realtime API (receives exact utterance)
  ↓
Model (executes utterance, no interpretation)  ← NO DECISION
  ↓
Model speaks exactly what was provided
  ↓
Model streams audio
```

**The Question:** Can the model execute without interpreting?

**The Answer:** YES, but only if we change what we send in the `instructions` field.

---

## POINT 4: Can the Model Be Reduced to Execution Only?

**Current Attempt (Not Working):**
```
instructions: "Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.

The line to speak is:

Hi, I'm Zeya..."
```

**Why It Fails:**
- Model reads the instruction as guidance
- Model sees the conversation context
- Model interprets the guidance creatively
- Model decides: "I should naturally continue the conversation"

**What Would Work:**

Instead of sending the system instruction WITH the question, we need to send:

**Option A: System Prompt Once, Then Lock Down**

Session setup:
```
System instruction: "You are Zeya. You are an actor reading a script. Your ONLY job is to speak the exact text provided by the application. Do not interpret. Do not add. Do not modify. Speak only what you are given."
```

Then for each turn:
```
response.create {
  instructions: "Speak exactly: Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
}
```

Then IMMEDIATELY after user responds:
```
response.create {
  instructions: "Speak exactly: Nice to meet you, Martin. What does your business sell?"
}
```

**Why This Might Work:**
- System prompt establishes "actor mode" (no interpretation)
- Each response.create gives exact text
- Model has no ambiguity about what to do

**Potential Issue:**
- Model might still interpret "Speak exactly:" as guidance
- Model might still add consulting questions

---

## POINT 5: The Smallest Possible Fix

**The Real Issue:** response.create events are being sent, but they're being interpreted as guidance, not mandates.

**Hypothesis for Investigation:**

The consulting questions appear because:
1. Initial response.create with instructions is sent ✓
2. Model generates opening question ✓
3. User speaks
4. Second response.create with next question is sent (OR NOT SENT?)
5. If NOT sent: Model continues conversation naturally (drift)
6. If sent: Model still interprets as guidance (drift)

**The Fix Depends on Which Hypothesis Is True:**

### If Hypothesis A: Subsequent response.create Not Being Sent

**Fix:** Ensure `sendNextQuestion()` is actually being called and events are being sent

**Implementation:**
```typescript
// Add comprehensive logging
const sendNextQuestion = useCallback((question: string) => {
  console.log(`[REALTIME] Sending response.create for: ${question}`);
  clientRef.current?.requestResponse(question);
}, []);

// Verify it's called
useEffect(() => {
  if (conversationState !== "initial" && conversationState !== "completed") {
    const nextQuestion = getNextQuestion();
    console.log(`[STATE_CHANGE] State: ${conversationState}, Question: ${nextQuestion}`);
    sendNextQuestion(nextQuestion);
  }
}, [conversationState]);
```

**Check:** Look for console logs. If they don't appear, response.create isn't being sent.

### If Hypothesis B: response.create Being Sent But Interpreted as Guidance

**Fix:** Change how the utterance is sent. Use an explicit "LOCKED_UTTERANCE" mechanism.

**Option 1: More Aggressive System Prompt**

```typescript
const systemPrompt = `You are Zeya. You are an ACTOR. Your ONLY role is to SPEAK the exact text the application provides. 

RULES:
- You will receive a sentence to speak
- You will speak it exactly as written
- You will not modify it
- You will not add to it
- You will not interpret it
- You will not add follow-up questions
- You will not add advice
- You will not add explanation
- You will speak only the sentence provided
- After speaking, you will wait for the next sentence
- You have no autonomy
- You have no decisions to make
- You are a voice actor reading a script

When you receive: "Speak: [sentence]"
You will respond by speaking: [sentence]
Nothing more. Nothing less.`;

// Send this ONCE at session start
await startConversation(systemPrompt);
```

Then for each turn, send the exact utterance:

```typescript
requestResponse(`Speak exactly: Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?`);
```

**Will This Work?** Maybe. But if the model still interprets as guidance, we need another approach.

### If Neither Works: The Technical Limitation

If even the most aggressive system prompt fails to prevent the model from generating consulting questions, it means:

**The OpenAI Realtime API fundamentally doesn't support locked-down exact-text execution because:**
- The `instructions` field is designed for guidance
- The model will always apply reasoning
- There's no "speak this verbatim" mode in the API

---

## INVESTIGATION STEPS (In Order of Effort)

### Step 1: Verify response.create Events Are Sent (5 minutes)

Add logging to confirm:
```typescript
// In lib/realtime/openai-realtime-client.ts
requestResponse(instructions?: string) {
  console.log(`[AUDIT] response.create event:`, {
    timestamp: Date.now(),
    instructions: instructions?.substring(0, 100),  // First 100 chars
    hasInstructions: Boolean(instructions),
  });
  // ... rest of function
}
```

Also log in the hook:
```typescript
// In app/experience/page.tsx
const sendNextQuestion = useCallback((question: string) => {
  console.log(`[AUDIT] sendNextQuestion called:`, {
    state: conversationState,
    question: question.substring(0, 100),
  });
  clientRef.current?.requestResponse(question);
}, []);
```

**Check:** Open DevTools console. Answer:
- How many response.create events appear?
- Are they for all 4 questions or just the opening?
- What text is in each event?

### Step 2: Verify What the Model Actually Receives (10 minutes)

Add logging to the WebRTC data channel:
```typescript
// In lib/realtime/openai-realtime-client.ts
private attachDataChannel(dc: RTCDataChannel) {
  dc.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    
    // Log what OpenAI sends back
    if (message.type === "response.created" || message.type === "response_content_block_delta") {
      console.log(`[AUDIT] OpenAI response:`, {
        type: message.type,
        text: message.delta?.text || message.response?.text,
      });
    }
  });
}
```

**Check:** Open DevTools console. Answer:
- What text does OpenAI generate for each turn?
- Does it match what was requested?
- Where do consulting questions first appear?

### Step 3: Determine the Root Cause (5 minutes)

Based on logs:
- If response.create events AREN'T sent: Fix is to ensure they're sent for each state change
- If response.create events ARE sent but model ignores them: Fix is to use stronger system prompt or different mechanism
- If model generates consulting questions on first turn before any subsequent events: Fix is stronger system prompt on initial setup

---

## THE SMALLEST POSSIBLE FIX

**Most Likely Scenario:** Subsequent response.create events aren't being sent, OR they're being sent but with delays that allow the model to generate its own response before processing them.

**Smallest Fix:**

1. Ensure `sendNextQuestion()` is called immediately when state changes (no setTimeout delay)
2. Use more aggressive system prompt that explicitly forbids consulting
3. Verify response.create events are reaching the model

**Implementation (15 minutes):**

```typescript
// In app/experience/page.tsx

// Remove the setTimeout delay:
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  // REMOVE: setTimeout delay
  // SEND IMMEDIATELY:
  voice.sendNextQuestion?.(nextQuestion);
}, [conversationState, phase, voice]);

// In lib/realtime/openai-realtime-client.ts

// At session start, send a more explicit system prompt:
const systemPrompt = `You are Zeya. You are an actor. Your role is to speak the exact text provided by the application only. Do not interpret. Do not add. Do not improvise. Speak only what is given.`;

// Then send each utterance explicitly:
requestResponse(`The exact text to speak is: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`);
```

**Effort:** 15-30 minutes  
**Risk:** Minimal (just adding clarity to existing mechanism)  
**Likelihood of Success:** 60-70% (might still require stronger constraints or different approach)

---

## Can We Preserve Existing Experience While Eliminating Drift?

**YES, if:**

1. **The issue is delayed response.create sending**
   - Fix: Send immediately without delay
   - Outcome: Model processes new instruction before generating continuation
   - Result: ✅ Preserves voice, latency, UX; eliminates drift

2. **The issue is model interpretation of "instructions" field**
   - Fix: Use stronger system prompt + clearer utterance format
   - Outcome: Model locks into "actor mode"
   - Result: ✅ Preserves everything; eliminates drift (if system prompt works)

3. **The issue is API limitation**
   - Fix: Replace Realtime with Whisper + TTS (loses some voice quality/latency)
   - Outcome: Direct text control, no model interpretation
   - Result: ⚠️ Eliminates drift but changes UX

---

## RECOMMENDED AUDIT APPROACH

1. **Add logging** (5 minutes) — Confirm response.create events are being sent
2. **Check console output** (5 minutes) — Verify what the model actually receives
3. **Identify root cause** (5 minutes) — Determine if it's timing, interpretation, or API limitation
4. **Apply smallest fix** (15 minutes) — Address the specific root cause
5. **Test** (10 minutes) — Verify consulting drift is eliminated

**Total audit time:** 40 minutes  
**Expected outcome:** Pinpoint the exact failure point and the smallest fix required

---

## DELIVERABLE SUMMARY

| Item | Answer |
|------|--------|
| **Where application control is lost** | `instructions` field interpreted as guidance, not mandate |
| **Where AI autonomy begins** | `response.create` event sent to model for interpretation/generation |
| **Can decisions be moved to app?** | YES, by changing how instructions are formatted and when they're sent |
| **Can model execute only?** | YES, with stronger system prompt + immediate response.create sending |
| **Smallest fix** | Eliminate setTimeout delay + add explicit system prompt on setup |
| **Preserve existing UX?** | YES, if issue is timing or system prompt (60-70% confidence) |

---

## NEXT STEP

Run the audit investigation with logging. Share the console output showing:
- When response.create events are sent
- What text is in each event
- What the model actually generates
- Where consulting questions first appear

That will pinpoint the exact fix needed.
