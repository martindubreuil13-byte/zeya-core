# Execution Path Audit: Finding the Leak

**Goal:** Identify where consulting questions are being generated and why the state machine is not controlling them.

**Status:** Audit (no fixes yet)

---

## CRITICAL FINDINGS

### Finding 1: response.create Semantics Issue

The code sends questions via `response.create` with an `instructions` field:

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
  this.sendEvent(event);
}
```

**Problem:** In the OpenAI Realtime API, `instructions` is meant for system prompts/guidance, NOT for exact text to speak.

When you send:
```json
{
  "type": "response.create",
  "response": {
    "instructions": "Hi, I'm Zeya. What's your name?"
  }
}
```

OpenAI interprets this as: **"Use this as a system instruction and generate a response"**

OpenAI does NOT interpret this as: **"Speak this exact text"**

The model can (and does) interpret the instruction and generate its own response based on conversation context.

### Finding 2: No "Exact Text" Mechanism in Realtime API

The OpenAI Realtime API has NO field to force exact text output. Available fields in `response.create`:
- `modalities`: ["text", "audio"]
- `instructions`: system guidance (NOT exact text)
- `temperature`: creativity level
- `model`: which model
- `tools`: function calling

There is NO:
- `text`: "speak this exactly"
- `exact_response`: "say this verbatim"
- `format`: { "type": "exact_text" }

**Conclusion:** The API does not support forcing exact model output. It only supports guidance via instructions.

### Finding 3: Subsequent response.create Events May Not Be Reaching the API

Evidence needed:
1. Is the useEffect at line 103-115 of `app/experience/page.tsx` actually firing?
2. Is `voice.sendNextQuestion?.()` being called?
3. Is the `response.create` event being sent to OpenAI?
4. Is OpenAI receiving it?
5. If received, is OpenAI processing it?

Current code sends it but provides NO verification that it's being received or used.

---

## EXECUTION FLOW ANALYSIS

### T0: Initial Connection

**Code Path:**
```
handleStartExperience()
  ↓
startConversation(systemPromptWithQuestion)
  ↓
useRealtimeOnboardingSession.ts startConversation()
  ↓
clientRef.current?.connect(systemPromptWithQuestion)
  ↓
openai-realtime-client.ts connect() [line 60]
  ↓
const dc = pc.createDataChannel("oai-events");
this.dataChannel = dc;
this.attachDataChannel(dc);
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);  // ← LINE 135
}
```

**What's Sent:** response.create event with instructions containing both:
- System prompt: "You are Zeya. Speak the exact line..."
- Opening question: "Hi, I'm Zeya. What's your name?"

**What OpenAI Receives:**
```json
{
  "type": "response.create",
  "response": {
    "instructions": "You are Zeya. Speak the exact line provided by the application...The line to speak is: Hi, I'm Zeya..."
  }
}
```

**What OpenAI Does:**
- Reads the instructions
- Interprets them as guidance
- Generates a response
- Response happens to match the requested line (so far ✓)

---

### T1: User Speaks

**What Happens:**
- User speaks "My name is Martin"
- Audio is transmitted via WebRTC
- Realtime API transcribes it
- Transcript added to voiceTranscript with `role: "user"`, `isFinal: true`

**No sendNextQuestion Called Yet** ⚠️

---

### T2: State Tracking Detects Response

**Code Path:**
```
voiceTranscript updated
  ↓
useEffect at line 49-100 watches voiceTranscript
  ↓
Filters: entry.role === "user" && entry.isFinal && entry.text?.trim()
  ↓
Finds userMessages.length === 1
  ↓
conversationState === "initial" && completedAnswers === 1
  ↓
CONDITION MET
  ↓
setVisitorName("Martin")
setConversationState("name_asked")
```

**Application State Changes:** ✅ "initial" → "name_asked"

---

### T3: Next Question useEffect Fires

**Code Path:**
```
conversationState changes to "name_asked"
  ↓
useEffect at line 103-115 watches conversationState
  ↓
if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;
  ↓ [phase === "voice_active" ✓, conversationState === "name_asked" ✓]
  ↓
const nextQuestion = getNextQuestion();
  ↓ [returns: "Nice to meet you, Martin. What does your business sell?"]
  ↓
setTimeout(() => {
  voice.sendNextQuestion?.(nextQuestion);
}, 300);
```

**Expected:** response.create sent to OpenAI with next question
**Actual:** ???

### ⚠️ CRITICAL UNKNOWN

**Does sendNextQuestion actually get called?**

The code structure suggests it should, BUT:
1. No logging proves it's called
2. No confirmation that response.create is sent
3. No verification that OpenAI receives it
4. No verification that it's processed

**Hypothesis:** One of these is NOT happening:
- A) sendNextQuestion is not called (useEffect not firing)
- B) response.create is not sent (method broken)
- C) response.create is sent but not received (network issue)
- D) response.create is received but ignored (API issue)
- E) response.create is processed but overridden (API behavior)

---

## WHERE THE CONSULTING QUESTIONS COME FROM

If consulting questions ("What are you looking for?", etc.) are being spoken, they are coming from OpenAI.

**Possible Paths:**

### Path A: Initial Instructions Are Being Interpreted Freely

**Scenario:**
```
T0: response.create sent with: "Speak the exact line: Hi, I'm Zeya..."
T1: Model generates: "Hi, I'm Zeya. What's your name?" ✓
T2: User speaks
T3: Model thinks: "What should I do next?"
T4: Model looks at instructions
T5: Instructions say: "Speak the exact line provided by the application"
T6: But no new line was provided!
T7: Model improvises: "What are you looking for?" ❌
```

**Evidence Would Show:** Model is freestyling because no new response.create event reached it.

### Path B: Second response.create Never Sent

**Scenario:**
```
T3: sendNextQuestion should fire
T3A: useEffect doesn't fire (bug in dependencies?)
T3B: OR sendNextQuestion method is broken
T3C: OR voice object doesn't have sendNextQuestion method
T3D: Result: No response.create event sent
T4: Model never receives the next question
T5: Model continues conversation based on initial instructions
T6: Model generates consulting questions
```

**Evidence Would Show:** Console logs in sendNextQuestion never fire. No response.create events beyond the first one.

### Path C: response.create Sent But Not Processed

**Scenario:**
```
T3: sendNextQuestion IS called
T3A: response.create IS sent
T3B: But OpenAI ignores it or processes it after generating the next response
T3C: OpenAI has already decided what to say based on initial instructions
T3D: New response.create event comes too late or is queued behind previous response
T4: Model speaks the previous response (consulting question)
T5: New response.create event is then processed for the next turn
```

**Evidence Would Show:** response.create events ARE being sent, but with gaps or delays that allow model to generate its own response.

### Path D: instructions Field Is Not How to Send Exact Text

**Scenario:**
```
T0: response.create sent with instructions field
T0A: Realtime API treats "instructions" as system guidance, not exact text
T0B: Model reads: "I should guide the user conversationally"
T0C: User speaks
T0D: Model continues conversationally
T0E: Model generates: "What are you looking for?" (natural conversation flow)
T3: Second response.create sent
T3A: But still via instructions field
T3B: Model again interprets as guidance
T3C: Model continues to freestyle because instructions don't lock it down
```

**Evidence Would Show:** The API simply doesn't support deterministic responses via instructions field.

---

## WHAT TO LOG TO FIND THE LEAK

### Log Point 1: useEffect Firing

In `app/experience/page.tsx`, inside the useEffect at line 103:

```typescript
useEffect(() => {
  console.log(`[STATE_MACHINE] useEffect firing:`, {
    phase,
    conversationState,
    initial: conversationState === "initial",
    completed: conversationState === "completed",
    shouldReturn: phase !== "voice_active" || conversationState === "initial" || conversationState === "completed"
  });
  
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") {
    console.log(`[STATE_MACHINE] Returning early`);
    return;
  }

  const nextQuestion = getNextQuestion();
  console.log(`[STATE_MACHINE] Next question:`, nextQuestion);
  
  const timer = setTimeout(() => {
    console.log(`[STATE_MACHINE] Calling sendNextQuestion with:`, nextQuestion);
    voice.sendNextQuestion?.(nextQuestion);
    console.log(`[STATE_MACHINE] sendNextQuestion call completed`);
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase, voice]);
```

**What to look for:**
- Does "useEffect firing" appear in console?
- Does "Calling sendNextQuestion" appear?
- If not, the useEffect is not firing (problem is in state tracking)
- If yes, continue to next log point

### Log Point 2: sendNextQuestion Called

In `hooks/realtime/useRealtimeOnboardingSession.ts`, line 201:

```typescript
const sendNextQuestion = useCallback((question: string) => {
  console.log(`[REALTIME] sendNextQuestion called with:`, question);
  const result = clientRef.current?.requestResponse(question);
  console.log(`[REALTIME] requestResponse returned:`, result);
}, []);
```

**What to look for:**
- Does "sendNextQuestion called with: Nice to meet you..." appear?
- If not, the useEffect is calling `voice.sendNextQuestion?.()` but voice object doesn't have the method
- If yes, requestResponse is being called

### Log Point 3: response.create Event Sent

In `lib/realtime/openai-realtime-client.ts`, line 201:

```typescript
requestResponse(instructions?: string) {
  console.log(`[REALTIME_CLIENT] requestResponse called with instructions:`, instructions);
  
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions
      ? {
          instructions,
        }
      : undefined,
  };
  
  console.log(`[REALTIME_CLIENT] Sending response.create event:`, event);
  
  devLog("response.create sent", { hasInstructions: Boolean(instructions) });
  this.sendEvent(event);
  
  console.log(`[REALTIME_CLIENT] Event sent to WebRTC`);
}
```

**What to look for:**
- Does "Sending response.create event" appear multiple times?
- How many times does it appear? (Should be once at startup, then once per state transition)
- If it only appears once, subsequent response.create events are not being sent

### Log Point 4: Realtime Events Received

In `openai-realtime-client.ts`, in the handleDataChannelMessage method, add:

```typescript
// When receiving response.created event:
case "response.created": {
  console.log(`[REALTIME_CLIENT] response.created received`);
  // existing code...
}

// When receiving response_text_delta event:
case "response.content_block_delta": {
  console.log(`[REALTIME_CLIENT] response_text_delta:`, event.delta?.text);
  // existing code...
}
```

**What to look for:**
- How many times does response.created appear?
- What text is in each response_text_delta?
- If a response has consulting questions, what event triggered it?

---

## DIAGNOSIS HYPOTHESIS

Based on code analysis, the most likely scenario is:

**Path B: Subsequent response.create Events Are Not Being Sent**

Evidence:
1. The useEffect has the right dependencies
2. The getNextQuestion() function is correct
3. But there's no logging to prove sendNextQuestion is being called
4. The voice object might not have the method available
5. OR sendNextQuestion is being called but the requestResponse event is not reaching OpenAI

---

## SMALLEST FIX REQUIRED

Once the leak is identified via logging:

- **If problem is A:** Initial instructions need better guidance (not just "speak the line")
- **If problem is B:** sendNextQuestion is not being called - fix useEffect or method availability
- **If problem is C:** response.create events need to cancel previous responses or be prioritized
- **If problem is D:** Need different API usage pattern (not via instructions field)

---

## PROOF REQUIRED

Before any fix, demonstrate:

1. ✅ Point in time when consulting question is spoken
2. ✅ Which response.create event (if any) triggered it
3. ✅ Whether subsequent response.create events are being sent after the first one
4. ✅ Whether the voice object actually has sendNextQuestion method
5. ✅ Whether the Realtime API supports exact text output (spoiler: probably not via instructions)

---

## NEXT STEP

Add the logging suggested above and run a test conversation.

Capture the console output showing:
- When sendNextQuestion is called
- What questions are sent
- What responses are received
- When consulting questions appear

Share that log output.

That will definitively show which of the paths (A, B, C, or D) is the real problem.
