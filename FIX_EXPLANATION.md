# Fix: Race Condition in State Machine Initialization

**Problem:** State machine was advancing without waiting for user input.

**Root Cause:** Sending minimal prompt without the first question created a race condition where the model generated its own response before receiving the scripted opening line.

---

## THE PROBLEM

### Original (Broken) Sequence

```
T0: handleStartExperience() called
    └─ startConversation(minimalPrompt)
       └─ Sends: "You are Zeya. Speak the exact line provided..."
       ⚠️ PROBLEM: No line provided!

T1: OpenAI receives minimal prompt
    └─ Model thinks: "I should introduce myself"
    └─ Model generates own intro: "Hi, I'm an AI companion..."

T2: useEffect detects voiceState === "listening"
    └─ Calls sendNextQuestion(firstQuestion)
    └─ Sends: "Hi, I'm Zeya. What's your name?"
    ⚠️ TOO LATE: Model already generating response

T3: Multiple responses in flight
    └─ response.create event 1: minimal prompt
    └─ response.create event 2: first question
    └─ Model confusion: Which instruction to follow?

T4: voiceTranscript fills with multiple agent messages
    └─ State machine filters for user messages
    └─ Finds none (all are agent messages)
    └─ But somehow state still advances
```

**Result:** Zeya fires multiple questions without waiting, introduces herself as "AI companion", states advance incorrectly.

---

## THE FIX

### Solution: Combine Prompt + Question

Send the minimal prompt **and** the first question **together** in a single response.create event.

```
T0: handleStartExperience() called
    └─ startConversation(systemPromptWithQuestion)
       └─ Sends combined prompt + first question
       ✅ Model receives exact instruction immediately

T1: OpenAI receives complete instruction
    └─ System: "Speak the exact line..."
    └─ Line: "Hi, I'm Zeya. What's your name?"
    └─ Model: "I have my instruction. I speak this line."

T2: Model speaks scripted opening
    └─ No improvisation
    └─ No own introduction

T3: User speaks name
    └─ Transcript records: { role: "user", text: "Alex", isFinal: true }

T4: State tracking useEffect detects user message
    └─ Filters: role === "user" && isFinal && text
    └─ Finds: userMessages.length === 1
    └─ State transitions: "initial" → "name_asked"

T5: Next question useEffect fires
    └─ Watches conversationState change
    └─ Calls sendNextQuestion(getNextQuestion())
    └─ Sends: "Nice to meet you, Alex. What does your business sell?"

T6: Cycle continues for remaining states
```

---

## CODE CHANGES

### Change 1: Combine Prompt and Question

**Before:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  setConversationState("initial");

  const minimalPrompt = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.`;
  await startConversation(minimalPrompt);  // ← Only minimal prompt, no question
};
```

**After:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  setConversationState("initial");

  // System prompt + first question sent TOGETHER
  const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.

The line to speak is:

"Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"`;

  await startConversation(systemPromptWithQuestion);  // ← Prompt + question together
};
```

**Why:** Eliminates the race condition by giving the model the complete instruction (what to say AND what to say) in a single event.

---

### Change 2: Remove Initial Question useEffect

**Removed:**
```typescript
// This useEffect is no longer needed because the first question is now sent at startup
useEffect(() => {
  if (phase === "voice_active" && voiceState === "listening" && conversationState === "initial") {
    const initialQuestion = getNextQuestion();
    setTimeout(() => {
      voice.sendNextQuestion?.(initialQuestion);  // ← No longer needed
    }, 100);
  }
}, [voiceState, phase, conversationState, voice]);
```

**Why:** The first question is now sent as part of the initial connection, so this delayed send is unnecessary and was causing confusion.

---

### Change 3: Improve State Transition Logic

**Enhanced Filter:**
```typescript
// Get all final user messages (filter out agent messages and partial entries)
const userMessages = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text?.trim());

// Only process complete answers
const completedAnswers = userMessages.length;

// State transitions based on completed answers count
if (conversationState === "initial" && completedAnswers === 1) {
  // User answered name question
  ...
} else if (conversationState === "name_asked" && completedAnswers === 2) {
  // User answered offer question
  ...
}
```

**Why:** 
- More explicit about what constitutes a "complete answer" (final + non-empty)
- Uses exact count (`=== 1`, `=== 2`, etc.) instead of >= to prevent multiple transitions
- Clearer logic: only advance when you have exactly the right number of answers

---

## SEQUENCE WITH FIX

### Message Flow

```
SESSION START
  ↓
startConversation() receives:
  "You are Zeya. Speak the exact line provided...
   
   The line to speak is:
   
   "Hi, I'm Zeya...What's your name?""
  ↓
OpenAI receives complete instruction in single response.create event
  ↓
Model speaks: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
  ↓
[User speaks name]
  ↓
Transcript: { role: "user", text: "Alex", isFinal: true }
  ↓
State tracking useEffect checks:
  - conversationState === "initial"? ✅ Yes
  - userMessages.length === 1? ✅ Yes (only Alex)
  ↓
Transitions to "name_asked"
  ↓
Next question useEffect fires:
  - conversationState !== "initial"? ✅ True
  - conversationState !== "completed"? ✅ True
  ↓
Sends: "Nice to meet you, Alex. What does your business sell?"
  ↓
[User speaks offer]
  ↓
Transcript: { role: "user", text: "I run a fitness studio", isFinal: true }
  ↓
State tracking checks:
  - conversationState === "name_asked"? ✅ Yes
  - userMessages.length === 2? ✅ Yes (Alex + offer)
  ↓
Transitions to "offer_asked"
  ↓
(Continues same pattern for remaining states)
```

---

## WHY THIS FIXES THE PROBLEM

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Zeya introduces herself as AI | Model generated own intro with minimal prompt | Provide exact intro in initial prompt |
| Multiple questions fired | Two response.create events confused model | Send question with prompt, not separately |
| States advancing without user input | Unclear what triggered transitions | Use exact count (=== 1, 2, 3, 4) not >= |
| Model treating own messages as user | Race condition | Eliminate the race by sending both at once |

---

## SAFEGUARDS ADDED

1. **Explicit count-based transitions** (`=== 1` instead of `>= 1`)
   - Prevents advancing on empty or duplicate messages
   - More predictable state flow

2. **Text validation** (`entry.text?.trim()`)
   - Ignores whitespace-only answers
   - Ensures answers are non-empty

3. **Single response per state**
   - Each state transitions exactly once
   - No duplicate transitions on same answer

---

## NEW EXPECTED BEHAVIOR

```
[User clicks "Start"]
  ↓ (instant)
[Zeya speaks opening from initial prompt]
  ↓ (waits for user to speak)
[User says name]
  ↓ (state advances only when user message received)
[Zeya speaks question 2 with name interpolated]
  ↓ (waits for user to speak)
[User says what they sell]
  ↓ (state advances only when user message received)
[Zeya speaks question 3]
  ↓ (etc.)
```

**Key property:** Each state transition happens ONLY when a new user message arrives.

---

## BUILD STATUS

✅ **Compilation:** Success
✅ **TypeScript:** No errors
✅ **No warnings:** 0
✅ **Ready for testing:** Yes

---

## TESTING THE FIX

To verify the fix works:

1. **Opening question:**
   - Zeya should say: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
   - NOT: "Hi, I'm an AI companion..."

2. **No rapid-fire questions:**
   - Zeya should ask only ONE question
   - Then WAIT for user response
   - No multiple questions in sequence

3. **State transitions on user input only:**
   - State should only change after user speaks
   - Name should be captured and used in question 2

4. **Deterministic behavior:**
   - Run 3 times with different visitors
   - Should see identical Zeya responses
   - Should see same sequence of questions

---

## WHAT DIDN'T CHANGE

- ✅ Voice infrastructure (realtime client, WebRTC)
- ✅ OpenAI session creation
- ✅ Supabase dispatch
- ✅ Telnyx worker brief
- ✅ Monitor infrastructure

Only the Experience flow controller changed.
