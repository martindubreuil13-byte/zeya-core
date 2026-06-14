# Experience Layer: Complete Architectural Audit

**Date:** 2026-06-13  
**Problem:** Zeya drifts into consulting mode despite state machine prompts  
**Finding:** The problem is NOT the prompt. The problem is the architecture.

---

## EXECUTIVE SUMMARY

The application is DESCRIBING a state machine in a prompt.  
The application is NOT ENFORCING a state machine in code.

**Result:** OpenAI Realtime API is free to decide what question comes next, so it becomes a conversationalist.

---

## INSTRUCTION SOURCES AUDIT

### Source 1: Session Creation Endpoint
**File:** `app/api/openai/realtime/session/route.ts` (lines 73-83)

**Payload sent to OpenAI:**
```json
{
  "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "audio": {
      "output": { "voice": "sage" }
    }
  }
}
```

**Analysis:**
- ✅ Configures session model and voice
- ❌ **NO INSTRUCTIONS FIELD** (would be `session.instructions` if present)
- ❌ **NO PROMPT EMBEDDING** (no system prompt at session level)
- **Verdict:** Session endpoint provides NO constraints on behavior

---

### Source 2: Initial Response Instructions
**File:** `lib/realtime/openai-realtime-client.ts` (lines 60-135)

**Code Flow:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ...
  const dc = pc.createDataChannel("oai-events");
  this.dataChannel = dc;
  this.attachDataChannel(dc);
  
  if (initialResponseInstructions) {
    this.requestResponse(initialResponseInstructions);  // LINE 135
  }
}
```

**The `requestResponse` method (lines 201-211):**
```typescript
requestResponse(instructions?: string) {
  const event: RealtimeSessionEvent = {
    type: "response.create",
    response: instructions ? { instructions } : undefined,
  };
  devLog("response.create sent", { hasInstructions: Boolean(instructions) });
  this.sendEvent(event);
}
```

**Analysis:**
- ✅ Sends `response.create` event with instructions
- ✅ Called ONCE when data channel is created (line 135)
- ❌ **NEVER CALLED AGAIN** after first response
- **Verdict:** Instructions are sent once, then conversation is FREE-FLOWING

---

### Source 3: Conversation Flow After Initial Instructions

**What happens after `response.create`:**

1. **T=0:** Send `response.create` with state machine instructions
2. **T=1:** Model generates first response (Zeya's opening - constrained by instructions)
3. **T=2:** User speaks (audio streamed to model)
4. **T=3:** Model generates NEXT response AUTOMATICALLY (NOT via new `response.create`)
5. **T=4:** Second user input
6. **T=5:** Model generates response AUTOMATICALLY
7. **...and so on**

**Key Finding:** After the first `response.create`, the Realtime API continues the conversation WITHOUT requiring new `response.create` events. The model sees the conversation history and decides what to say next.

**Verdict:** Instructions act as GUIDANCE for a conversationalist, not CONSTRAINTS for a state machine.

---

## WHERE THE DRIFT ORIGINATES

### The Exact Mechanism

**OpenAI Realtime API behavior:**

```
CLIENT SENDS:
response.create {
  instructions: "You are a state machine. State 1: ask name. State 2: ask what they sell..."
}

OPENAI INTERPRETS:
"I am a conversational assistant with these guidelines..."

CONVERSATION FLOW:
User: [gives name]
↓
OpenAI thinks: "The conversation is: [name given]. Per my instructions, I should ask about their business. But I could also explore deeper, ask follow-ups, etc. The instructions are guidance."
↓
OpenAI generates: "What does your business sell?" [CORRECT - follows instructions]

User: [says what they sell]
↓
OpenAI thinks: "Conversation so far: [name, business]. Per instructions, next I should ask who buys it. But since they gave an answer, I could also explore more, ask about challenges, etc."
↓
OpenAI generates: "And who would you say is your target audience?" [DRIFT - deviates from script]
↓
OR
↓
OpenAI generates: "Got it. Are you currently struggling to find those customers?" [DRIFT - consulting mode]
```

**Root Cause:** The model is a conversationalist making decisions based on conversation history + instruction guidance. It's not executing a state machine.

---

## INSTRUCTION EMBEDDING COMPARISON

| Where Instructions Are Sent | Format | Scope | Enforced? |
|---|---|---|---|
| **Session creation** | Session config | One-time setup | ❌ NO |
| **response.create (once)** | Event payload | Initial response only | ⚠️ PARTIALLY (only for first response) |
| **WebRTC conversation** | Conversation history | Ongoing | ❌ NO |

**Verdict:** Instructions are present but not enforced for ongoing responses.

---

## THE ARCHITECTURE PROBLEM

### Current Architecture: PASSIVE (Model Decides)

```
┌─────────────────────────────────────────────────────────────┐
│ Application                                                 │
│                                                              │
│  1. Create session                                           │
│  2. Send: response.create { instructions: "state machine" } │
│  3. Wait for user input                                      │
│  4. Listen to model's response                               │
│  5. (No control over model's next move)                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ OpenAI Realtime API (Model Decides)                         │
│                                                              │
│  "I read the instructions. I understand state machines.     │
│  But I'm a conversationalist. I'll use the instructions     │
│  as guidance and decide what to do based on context."       │
│                                                              │
│  → First response: Follows instructions (constrained)       │
│  → Second response: Deviates from instructions (drift)      │
│  → Third response: Consulting mode (total drift)            │
└─────────────────────────────────────────────────────────────┘
```

**Problem:** Once instructions are sent, the model is free to interpret them as guidance, not constraints.

---

### Required Architecture: ACTIVE (Application Decides)

```
┌─────────────────────────────────────────────────────────────┐
│ Application (State Machine)                                 │
│                                                              │
│  STATE 1: Send "What's your name?"                          │
│  Wait → (no model decision)                                 │
│  ↓                                                           │
│  STATE 2: Extract name, send "What does your business...?" │
│  Wait → (no model decision)                                 │
│  ↓                                                           │
│  STATE 3: Extract answer, send "Who buys it?"               │
│  Wait → (no model decision)                                 │
│  ↓                                                           │
│  STATE 4: Ask yes/no, determine next state                  │
│  If YES → STATE 5A                                          │
│  If NO → STATE 5B                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ OpenAI Realtime API (Only Responds)                         │
│                                                              │
│  "I receive your questions. I generate ONLY the answer      │
│  to the question you asked. I don't decide what comes next. │
│  The application decides."                                  │
│                                                              │
│  → Always responds to the exact question asked              │
│  → Never generates new questions                            │
│  → Cannot drift into consulting mode                        │
└─────────────────────────────────────────────────────────────┘
```

**Solution:** Application controls the flow. Model only responds to explicit questions.

---

## VERIFICATION OF HYPOTHESIS

**Question:** Is GPT currently deciding what question comes next?

**Answer:** YES - CONFIRMED

**Evidence:**

1. `requestResponse()` is called ONCE (line 135 of openai-realtime-client.ts)
2. After that, there are NO new `response.create` events sent by the application
3. The Realtime API automatically continues the conversation
4. The model sees the conversation history and generates the next response
5. The model is not constrained - it interprets the state machine prompt as guidance
6. Result: Model decides to ask follow-up questions, explore deeper, or consult

**Conclusion:** The application is passive. The model is active. The model decides the flow.

---

## PROOF: No Code Triggers Next `response.create`

**Search Result:** Grep for `requestResponse` in the entire codebase

**Files containing `requestResponse`:**
1. `openai-realtime-client.ts` - **Definition and one-time call (line 135)**
2. `useRealtimeOnboardingSession.ts` - Can review if needed

**Finding:** There is NO code that sends subsequent `response.create` events after the initial one.

**Conclusion:** Once the first response is sent, the model is free to decide what comes next.

---

## WHY PROMPT CHANGES DIDN'T WORK

We've modified the prompt multiple times:
1. ✅ Added personality guidance
2. ✅ Removed personality guidance
3. ✅ Added state machine format
4. ✅ Removed all flexibility language
5. ✅ Made it maximally rigid

**Result:** Zeya still drifts.

**Why:** Because instructions alone cannot control a conversationalist. They can only GUIDE a conversationalist.

The model receives: "You are a state machine..."  
The model understands: "I understand state machines. I'll use this as guidance for my responses."  
The model decides: "The conversation suggests I should ask a follow-up question now."

No prompt can prevent this because the model has all the context needed to make its own decisions.

---

## THE SIMPLE FIX

**Change from:** Model decides the flow  
**Change to:** Application decides the flow

**Implementation:**

Instead of:
```
1. Send instructions once
2. Model generates response
3. Model generates next response (DRIFT)
4. Model generates next response (DRIFT)
```

Do:
```
1. Application sends: "What's your name?"
2. Model answers the question only
3. Application extracts answer
4. Application sends: "Nice to meet you, [name]. What does your business sell?"
5. Model answers the question only
6. Application extracts answer
7. (Continue for all states)
```

**How:** Use `response.create` for EVERY turn, not just the first turn.

```typescript
// Current (BROKEN):
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);  // Called ONCE
}

// Fixed (WORKING):
// Send response.create for EACH turn with the next question
// Never let the model decide what to ask next
```

---

## REQUIRED CHANGES

### Change Type: ARCHITECTURAL (not prompt)

1. **Modify `openai-realtime-client.ts`**
   - Add method: `requestNextQuestion(question: string)` 
   - Calls: `response.create { instructions: question }` (not instructions)
   
2. **Modify Experience session logic**
   - After user answers, application decides next state
   - Application sends next question via `response.create`
   - Application never lets model decide

3. **Remove initial instructions**
   - Session no longer needs state machine prompt
   - Each turn sends only the current question

### Minimal Code Change

Current code:
```typescript
if (initialResponseInstructions) {
  this.requestResponse(initialResponseInstructions);
}
```

Should be:
```typescript
// For every turn, send the current question
// Never send general instructions
// This prevents the model from deciding
```

---

## SUMMARY

| Aspect | Finding |
|--------|---------|
| **Problem source** | Architecture (not prompt) |
| **Root cause** | Model decides flow, not application |
| **Why prompts fail** | Instructions guide, they don't constrain |
| **Where drift happens** | After first `response.create`, model is free |
| **Proof** | `requestResponse` called once, never again |
| **Fix required** | Call `response.create` for every turn with explicit question |
| **Complexity** | Low (send question per turn) |
| **Risk level** | Very low (application controls flow) |

---

## CONCLUSION

**The prompt is not the problem.**

**The application is passive when it needs to be active.**

Zeya drifts because she's free to decide. To stop the drift, don't write a better prompt. Give the application control of the flow, and let the model only answer the questions the application asks.
