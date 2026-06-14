# Event Trace Analysis: Why State Machine Is Advancing Without User Input

**Problem:** State machine advances through all questions without waiting for user responses.

**Observations:**
1. Zeya introduces herself as "AI companion" (not scripted opening)
2. Multiple questions fired in quick succession
3. States advance without user input detected
4. Suggests model generating responses, not following instructions

---

## TRACE: WHAT SHOULD HAPPEN

```
T0: User clicks "Start"
    └─ handleStartExperience() called
       └─ phase = "voice_active"
       └─ conversationState = "initial"
       └─ minimalPrompt sent to startConversation()

T1: RTCPeerConnection opens
    └─ voiceState = "connecting"

T2: Data channel attached
    └─ requestResponse(minimalPrompt) sent to OpenAI
       Message: "You are Zeya. Speak the exact line provided..."

T3: Connection completes
    └─ voiceState = "listening"
    └─ onConnected callback fires

T4: useEffect detects voiceState === "listening"
    └─ calls sendNextQuestion(getNextQuestion())
    └─ minimalPrompt + first question sent: "Hi, I'm Zeya..."

T5: OpenAI generates response
    └─ response.created event
    └─ Zeya speaks: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"

T6: User speaks
    └─ User says: "Alex"

T7: OpenAI transcribes
    └─ input_audio_buffer.committed event
    └─ response_created event
    └─ response_text_delta events as audio is generated
    └─ voiceTranscript updated with user message:
       { role: "user", text: "Alex", isFinal: true }

T8: State tracking useEffect fires
    └─ Watches voiceTranscript
    └─ Filters: entry.role === "user" && entry.isFinal && entry.text
    └─ Finds userMessages.length === 1
    └─ conversationState === "initial" && userMessages.length >= 1
    └─ ✅ Condition met: ADVANCE TO name_asked
    └─ setVisitorName("Alex")
    └─ setConversationState("name_asked")

T9: Next question useEffect fires
    └─ Watches conversationState change
    └─ conversationState !== "initial" and !== "completed"
    └─ getNextQuestion() returns: "Nice to meet you, Alex. What does your business sell?"
    └─ sendNextQuestion() called
    └─ response.create event sent

T10: Cycle repeats for states 2, 3, 4
```

---

## TRACE: WHAT'S ACTUALLY HAPPENING (HYPOTHESIS)

```
T0: User clicks "Start"
    └─ handleStartExperience() called
       └─ phase = "voice_active"
       └─ conversationState = "initial"
       └─ minimalPrompt sent: "Speak the exact line provided by the application..."

T1: RTCPeerConnection opens
    └─ voiceState = "connecting"

T2: Data channel attached
    └─ requestResponse(minimalPrompt) sent
       ⚠️ PROBLEM: Only the minimal prompt is sent
       ⚠️ No specific line for the model to speak!

T3: Connection completes
    └─ voiceState = "listening"
    └─ onConnected fires

T4: useEffect triggers to send initial question
    └─ voiceState === "listening"
    └─ setTimeout(..., 100ms)
    └─ Calls sendNextQuestion("Hi, I'm Zeya...")

T4.5: ⚠️ RACE CONDITION
    └─ But the model already has the minimal prompt!
    └─ Model thinks: "I should speak something, but no line given"
    └─ Model starts generating its own intro:
       "Hi, I'm Zeya, an AI companion helping businesses..."
    └─ response.created event fires BEFORE the first question arrives!

T5: Zeya speaks her own generated intro
    └─ voiceTranscript updated with agent message:
       { role: "agent", text: "Hi, I'm Zeya...", isFinal: false/true }

T5.5: First question sendNextQuestion finally arrives
    └─ response.create event sent with "Hi, I'm Zeya..."
    └─ But there's ALREADY an active response!
    └─ This might create a second response or confuse the state

T6: Zeya continues speaking (second response?)
    └─ Multiple questions rapid-fired

T7: voiceTranscript is now confused
    └─ Contains agent messages from multiple responses
    └─ State machine tries to filter for user messages

T8: ⚠️ KEY PROBLEM
    └─ voiceTranscript might include:
       [
         { role: "agent", text: "Hi, I'm Zeya...", isFinal: true },
         { role: "agent", text: "What's your name?", isFinal: true },
         { role: "agent", text: "What does your business sell?", isFinal: true }
       ]
    └─ State machine filters for role === "user"
    └─ Finds no user messages
    └─ But state transitions keep happening

T9: ⚠️ OR ALTERNATIVE PROBLEM
    └─ State transitions are triggered by something OTHER than userMessages.length
    └─ Possible causes:
       - voiceTranscript.length is being used instead of filtered count
       - response.completed events are triggering transitions
       - assistant messages are being counted as user messages
       - states are advancing based on time, not transcript
```

---

## ROOT CAUSES TO INVESTIGATE

### 1. Is the Initial Question Being Sent Too Late?

**Problem Code:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  setConversationState("initial");

  // ⚠️ Only the minimal prompt is sent
  const minimalPrompt = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.`;
  
  // ⚠️ This happens immediately, but sendNextQuestion happens later in a useEffect
  await startConversation(minimalPrompt);
};
```

**What happens:**
1. `startConversation()` sends minimal prompt to OpenAI
2. OpenAI receives: "Speak the exact line..."
3. But NO LINE is provided yet!
4. OpenAI thinks: "I should speak, but what should I say?"
5. OpenAI generates its own intro

**The useEffect that sends the question:**
```typescript
useEffect(() => {
  if (phase === "voice_active" && voiceState === "listening" && conversationState === "initial") {
    const initialQuestion = getNextQuestion();
    setTimeout(() => {
      voice.sendNextQuestion?.(initialQuestion);
    }, 100);
  }
}, [voiceState, phase, conversationState, voice]);
```

**Problem:**
- This useEffect runs AFTER the connection is established
- There's a time gap between `startConversation()` and `sendNextQuestion()`
- During this gap, OpenAI has the minimal prompt but no specific instruction
- So it generates its own response

---

### 2. Are Multiple response.create Events Being Sent?

**Sequence:**
```
T=0ms:  startConversation(minimalPrompt)
        └─ Calls client.connect(minimalPrompt)
           └─ Inside connect:
              const dc = pc.createDataChannel("oai-events");
              this.attachDataChannel(dc);
              if (initialResponseInstructions) {
                this.requestResponse(initialResponseInstructions);  // ← Sends first response.create
              }

T=100ms: voiceState === "listening" detected
         └─ useEffect fires
            └─ setTimeout(..., 100ms) calls sendNextQuestion()
               └─ Calls requestResponse(firstQuestion)  // ← Sends SECOND response.create
```

**Problem:**
- Two `response.create` events sent in quick succession
- First one has minimal prompt (no specific line)
- Second one has the first question
- Model might process both or be confused about which to use

---

### 3. Is the State Machine Advancing on Assistant Messages?

**Current Filter Code:**
```typescript
const userMessages = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text);

if (conversationState === "initial" && userMessages.length >= 1) {
  setConversationState("name_asked");
}
```

**Possible Issues:**
- ✅ Filter looks correct: `role === "user"`
- ❓ But what if assistant messages are being added to transcript with role: "user"?
- ❓ What if the realtime event types are being misinterpreted?

**Need to check:**
- What does voiceTranscript actually contain when Zeya speaks multiple questions?
- Are agent responses being included as separate entries?
- What are the actual role values in the transcript?

---

### 4. Is response.completed Triggering Transitions?

**Possible Hidden State Transitions:**
- The code I wrote only looks at `voiceTranscript` length
- But the realtime client might be firing other events
- `response.completed` events might trigger state changes elsewhere

**Check:**
- Is there a separate effect watching for `response.completed`?
- Are there event listeners that advance state based on realtime events?
- Is the monitor or some other system advancing state?

---

### 5. Is the Original Realtime Prompt Still Active?

**Hypothesis:**
- Maybe the session creation endpoint is STILL sending the old state machine prompt
- Maybe the old prompt is cached somewhere
- Maybe my changes didn't fully replace the old logic

**Check:**
- Look at what `startConversation()` actually sends
- Verify the minimal prompt is what reaches OpenAI
- Confirm the old state machine prompt is not being sent from anywhere else

---

## DETAILED CODE TRACE: WHERE STATE CHANGES

### Entry Point 1: Initial State Set
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");           // ← Phase changes
  setConversationState("initial");     // ← State set to initial
  
  const minimalPrompt = `...`;
  await startConversation(minimalPrompt);
};
```

### Entry Point 2: Send Initial Question
```typescript
useEffect(() => {
  if (phase === "voice_active" && voiceState === "listening" && conversationState === "initial") {
    const initialQuestion = getNextQuestion();
    setTimeout(() => {
      voice.sendNextQuestion?.(initialQuestion);  // ← ONLY SENDS QUESTION
                                                    // ← DOES NOT CHANGE STATE
    }, 100);
  }
}, [voiceState, phase, conversationState, voice]);
```

### Entry Point 3: Track User Responses & Advance State
```typescript
useEffect(() => {
  if (phase !== "voice_active" || !voice) return;

  const userMessages = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text);

  // ⚠️ THIS IS THE ONLY PLACE STATE ADVANCES
  if (conversationState === "initial" && userMessages.length >= 1) {
    setConversationState("name_asked");  // ← STATE CHANGES HERE
  }
  else if (conversationState === "name_asked" && userMessages.length >= 2) {
    setConversationState("offer_asked");  // ← AND HERE
  }
  // ... etc
}, [voiceTranscript, conversationState, phase, voice, stopConversation]);
```

**KEY QUESTION:** Is `userMessages.length >= 1` being satisfied without actual user messages?

---

## CRITICAL DEBUGGING QUESTIONS

1. **What is in voiceTranscript when state advances?**
   - Log every entry when filtering
   - Show role, text, isFinal for each
   - Count how many have role === "user"

2. **When does state first advance from "initial" to "name_asked"?**
   - Log the voiceTranscript at that moment
   - Show all entries with role === "user"
   - Verify at least one has isFinal === true

3. **How many response.create events are being sent?**
   - Log each call to requestResponse()
   - Show the exact instructions being sent
   - Show timing of each event

4. **What does the realtime client receive from OpenAI?**
   - Log all response.created events
   - Log all response_content_block_done events
   - Show the order and timing

5. **Is voiceState === "listening" firing multiple times?**
   - Log each time the initial question useEffect runs
   - Show how many times sendNextQuestion is called

---

## HYPOTHESIS: MOST LIKELY ROOT CAUSE

**The problem is likely this sequence:**

```
T0: startConversation(minimalPrompt)
    └─ Sends: "Speak the exact line..."
    └─ Model: "No line provided. I'll introduce myself."

T1: Model generates intro without waiting for first question

T2: useEffect sends first question

T3: Model now has TWO instructions/prompts to process
    └─ Minimal prompt (old)
    └─ First question (new)

T4: Model might interpret this as:
    └─ "Generate multiple responses" or
    └─ "These are separate turns in the conversation"

T5: voiceTranscript fills with multiple agent messages

T6: State tracking useEffect runs
    └─ Filters for userMessages
    └─ But if response.created is structured differently than expected,
       it might be counting agent messages OR
       the filter is working but the logic is broken
```

**The fix requires:**
1. Send the first question AS PART OF the initial connect, not after
2. OR, send a proper system prompt that tells the model to wait
3. OR, don't send two separate response.create events

---

## WHAT NEEDS TO HAPPEN NEXT

Before I modify code, I need to:

1. ✅ Identify exactly where state advances (DONE - it's the useEffect)
2. ⏳ Verify what voiceTranscript contains when state advances (NEED YOUR HELP)
3. ⏳ Confirm the filter is working correctly (NEED YOUR HELP)
4. ⏳ Check if the initial question is being sent correctly (NEED YOUR HELP)
5. ⏳ Verify only response.create events are being sent, not multiple (NEED YOUR HELP)

I recommend:
- Add console.log in the state tracking useEffect to show voiceTranscript
- Add console.log in getNextQuestion() to show when questions are sent
- Check the browser console during a conversation
- Share what you see in the transcript
