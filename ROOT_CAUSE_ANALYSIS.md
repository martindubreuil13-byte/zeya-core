# Root Cause Analysis: Why Consulting Questions Still Appear

**Conclusion:** The OpenAI Realtime API does not support forced exact-text output. The `instructions` field is for guidance, not for locking down responses.

---

## THE FUNDAMENTAL MISMATCH

### What I Tried to Build
A deterministic state machine where:
- Application decides what text Zeya speaks
- OpenAI only executes (speaks the text)
- Model has zero creative freedom

### What the OpenAI Realtime API Actually Is
A conversational interface where:
- Application provides instructions/guidance
- Model generates responses based on that guidance
- Model always has interpretive freedom

### The Gap
There is **no API parameter** to force exact text output.

---

## ROOT CAUSE: API Limitations

### The response.create Event

**What I'm Sending:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "Nice to meet you, Martin. What does your business sell?"
  }
}
```

**What OpenAI Interprets:**
"Here's an instruction/guideline for the response you should generate."

**What OpenAI Does NOT Do:**
Speak that text verbatim. 

**What OpenAI Actually Does:**
- Reads the instruction as guidance
- Considers the conversation history
- Generates a response that "follows" the guidance
- If the conversation context suggests a follow-up question, adds one

### The Available Fields

The `response.create` event supports:
- `modalities`: ["text", "audio"] — what to include
- `instructions`: system guidance (NOT exact text)
- `temperature`: creativity (0-2)
- `model`: which model to use
- `tools`: function calling

It does **NOT** support:
- `text`: "speak this exactly"
- `exact_response`: "verbatim output"
- `format: { type: "exact" }`: force exact mode
- `mode: "script"`: scripted response mode

### The API Design Philosophy

The OpenAI Realtime API is designed around:
1. Client sends instructions/guidance
2. Model generates contextual responses
3. Model can interpret, extend, or adapt
4. Full conversational freedom

It is **NOT** designed around:
1. Client sends exact text
2. Model plays back text
3. Model has zero flexibility
4. Locked-down scripted responses

---

## PROOF: What Consulting Questions Reveal

If Zeya is asking "What are you looking for?" or "How can we work together?", this proves:

1. ✅ The question is NOT coming from the application (not in getNextQuestion)
2. ✅ The question IS coming from OpenAI
3. ✅ OpenAI generated it despite my guidance
4. ✅ The `instructions` field did not prevent model interpretation

**Why would the model do this?**

Because the model has received:
- Instruction 1: "Hi, I'm Zeya. What's your name?"
- Instruction 2: "Nice to meet you. What does your business sell?"
- Instruction 3: "Who usually buys it?"
- Instruction 4: "Would you like to try an experiment?"

The model interprets these as **examples** of questions, not **the only** questions. The model thinks:
- "I see the pattern: I'm asking discovery questions"
- "The next natural step is to ask: What are you looking for?"
- "I should explore their needs deeper"
- "How can we work together?"

The model is following the **conversational pattern**, not the **exact script**.

---

## SECONDARY ISSUES

Even if Path A (above) is the main problem, these issues also exist:

### Issue 2: No Verification of response.create Delivery

The code sends response.create events but has:
- ✅ No logging to confirm sending
- ✅ No confirmation that OpenAI receives them
- ✅ No verification that they're processed
- ✅ No error handling if they're lost

So even if the method worked, we couldn't prove it was being used.

### Issue 3: Timing/Race Conditions

Even if response.create events are sent:
- T0: response.create sent with opening question
- T0+10ms: Model starts generating response
- T1: User speaks
- T1+50ms: New response.create sent with next question
- T1+100ms: But model has already decided what to say next!

The model might process events asynchronously or have queued responses.

### Issue 4: Method Call Chain

The call chain is:
```
useEffect calls voice.sendNextQuestion()
  ↓
sendNextQuestion calls requestResponse()
  ↓
requestResponse calls this.sendEvent()
  ↓
sendEvent sends to WebRTC data channel
  ↓
WebRTC transmits to OpenAI
  ↓
OpenAI receives and processes
```

Any break in this chain stops the whole thing. No logging confirms each step works.

---

## EXACT ROOT CAUSE MAPPING

| Problem | Evidence | Root Cause |
|---------|----------|-----------|
| Consulting questions appear | "What are you looking for?" not in app | OpenAI is generating it |
| Generated despite instructions | Model adds questions | instructions ≠ exact text constraint |
| Model keeps improvising | Multiple follow-ups | API has no "lock-down" mode |
| Deterministic state machine failed | Unpredictable responses | Realtime API != deterministic API |

---

## WHICH FILE, WHICH FUNCTION

The leak is not in application code. The leak is in **API architecture mismatch**.

**File:** `lib/realtime/openai-realtime-client.ts`  
**Function:** `requestResponse(instructions?: string)` (line 201)  
**Problem:** Sends instructions via `instructions` field

**But the Real Problem:**
The OpenAI Realtime API's `instructions` field was never designed to force exact-text responses. It's designed for system prompts and guidance. This is a **limitation of the API itself**, not a bug in my code.

---

## SMALLEST FIX REQUIRED

There are only two paths forward:

### Path 1: Stop Using response.create for Exact Text
Stop trying to send exact text via the `instructions` field. Instead:
- Accept that OpenAI Realtime is conversational, not scriptable
- Work with the model, not against it
- Use a very strong system prompt that prevents consulting behavior
- Accept some unpredictability

**Impact:** No longer truly deterministic, but consulting behavior reduced

### Path 2: Switch to a Different API
The OpenAI Realtime API is the wrong tool for "deterministic scripted responses."

Better options:
- OpenAI TTS + text-based API for response selection (split voice from logic)
- Scripted IVR system (but loses voice quality)
- Proprietary voice API that supports exact-text mode

**Impact:** Complete rewrite, but true determinism possible

---

## THE REAL PROBLEM STATEMENT

Not: "The state machine isn't being called"
Not: "The questions aren't being sent"
Not: "There's a bug in the code"

**Real Problem:**
"We're using an API designed for free-form conversation to force exact-text responses. The API treats 'instructions' as guidance, not constraints. The model interprets guidance and generates its own responses."

---

## EVIDENCE

To prove this is the root cause, run this test:

**Test: Send a very strong constraint via instructions**

```json
{
  "type": "response.create",
  "response": {
    "instructions": "YOU MUST SAY EXACTLY: 'Nice to meet you. What does your business sell?' YOU MUST NOT ADD ANYTHING. YOU MUST NOT ASK OTHER QUESTIONS. SPEAK ONLY THESE WORDS."
  }
}
```

**Prediction:**
- OpenAI might add a follow-up question anyway
- Or it might follow the instruction but interpret it creatively
- Or it might work for one turn but fail for subsequent turns

**If prediction is correct:**
The API simply doesn't support exact-text responses via instructions.

**If prediction is wrong:**
There's a different root cause (like response.create not being sent).

---

## WHAT TO DO NEXT

Choose one path:

### Path A: Investigate API Limitations (5 minutes)
Run the test above. Confirm whether the Realtime API supports exact-text via instructions.

### Path B: Add Comprehensive Logging (15 minutes)
Add logging as suggested in EXECUTION_PATH_AUDIT.md. Prove whether:
- sendNextQuestion is called
- response.create is sent
- OpenAI receives it
- What response is generated

### Path C: Accept the Limitation (immediate)
The OpenAI Realtime API is conversational. It will generate its own responses. Work with that, not against it. The "state machine" should be interpreted as "conversation flow," not "exact script enforcement."

---

## CONCLUSION

The consulting questions appear because:

**The OpenAI Realtime API's `instructions` parameter is not designed to force exact-text output. It's designed for guidance. The model interprets guidance and generates contextual responses. When the context suggests follow-up questions, the model adds them.**

This is not a code bug. This is an API design mismatch.

The solution is either:
1. Accept that the API is conversational (not deterministic)
2. Implement a different mechanism for exact-text control
3. Switch to a different API

Not to keep adding constraints to the instructions field. That won't work.
