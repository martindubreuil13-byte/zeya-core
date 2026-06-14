# Experience Layer: Scripted Product Design

**Architecture:** 5 beats, pre-written script, model extraction only  
**Duration:** 30-45 seconds  
**Goal:** Phone number + curiosity

---

## BEAT 1 — GREETING (5 seconds)

### Primary Line
> "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"

### Why This Works
- Introduces Zeya immediately
- Establishes value proposition (finding customers) without being pushy
- Open-ended question (name) is easy to answer
- Sets conversational tone (natural, not corporate)

### Model Task
- **Listen** to the response
- **Extract** [VISITOR_NAME] from the transcription
- **Acknowledge** naturally ("Got it, [name]." or similar)

### Fallback (if extraction is unclear)
> "Sorry, could you repeat your name?"

### Success Criterion
Model confidently extracts a name (any reasonable name-like response).

---

## BEAT 2 — WHAT THEY SELL (8 seconds)

### Primary Line
> "Nice to meet you, [name]. What does your business sell?"

### Why This Works
- Uses the name (creates personalization without complexity)
- Open-ended question (accepts any product/service description)
- "Sell" is broader than "do" or "build" (includes services, products, solutions)
- Sets up the business context for Beat 3

### Model Task
- **Listen** to the response
- **Extract** [PRODUCT/SERVICE] from the transcription
- **Acknowledge** ("Got it." or "Interesting." — brief, bounded)

### Fallback (if extraction is vague)
> "Got it. And when you help them, what exactly are they paying for?"

### Success Criterion
Model extracts enough to move forward (doesn't need perfect — "sell software" or "run a gym" is sufficient).

---

## BEAT 3 — WHO BUYS IT (8 seconds)

### Primary Line
> "Who usually buys it?"

### Why This Works
- Short, direct
- "Usually" acknowledges that there may be variation (less prescriptive)
- Open-ended (accepts any description of customer type)
- Sets up the positioning for the experiment pitch

### Model Task
- **Listen** to the response
- **Extract** [CUSTOMER_TYPE] from the transcription
- **Acknowledge** ("Got it." or "Perfect.")

### Fallback (if extraction is vague)
> "Tell me more about who your ideal customer is."

### Success Criterion
Model extracts customer type (even vague: "small businesses" or "entrepreneurs" is enough).

---

## BEAT 4 — EXPERIMENT PITCH (10 seconds)

### Primary Line
> "Got it. I'd like to show you something. We run a small experiment with businesses like yours — gives you a real sense of how this works before you decide anything. Would you be willing to try it?"

### Why This Works
- "Show you something" creates curiosity (not selling)
- "Experiment" lowers stakes (not a commitment)
- "Businesses like yours" creates relevance without understanding deeply
- "Real sense" creates mystery (what does "this" refer to?)
- "Before you decide anything" removes pressure
- Clear yes/no question (binary)

### Model Task
- **Listen** to the response
- **Detect** yes/no intent from transcription
- If YES: Proceed to Beat 5A
- If NO: Proceed to Beat 5B
- If UNCLEAR: Ask "Does that interest you — yes or no?"

### Fallback (if unclear)
> "I know this might be unexpected. Does it sound interesting to you?"

### Success Criterion
Model clearly identifies yes or no intent.

---

## BEAT 5A — YES PATH (5 seconds)

### Primary Line
> "Great. I'll need your phone number to set this up. What's the best number to reach you?"

### Why This Works
- "Great" affirms their choice (positive reinforcement)
- "I'll need" creates obligation (next step is natural)
- "To set this up" creates narrative continuity
- "Best number to reach you" is standard phrasing (easier to understand than "mobile or landline?")

### Model Task
- **Listen** to the response
- **Extract** [PHONE_NUMBER] from the transcription
- **Validate** (is it a real phone number format?)
- **Acknowledge** ("Got that. Thanks.")

### Fallback (if unclear)
> "Sorry, can you repeat that number?"

### Success Criterion
Model extracts a valid phone number and confirms it.

---

## BEAT 5B — NO PATH (5 seconds)

### Primary Line
> "No problem at all. If you ever want to see how it works, you know where to find me."

### Why This Works
- Removes all pressure ("No problem")
- Leaves door open ("ever want to")
- Creates mystery ("know where to find me" — implies future accessibility)
- Respectful exit

### Model Task
- **Listen** (no extraction needed)
- **Acknowledge** ("Take care." or similar)
- End conversation naturally

### Success Criterion
Graceful close without pushing back.

---

## EXTRACTION REQUIREMENTS

### Model Role: Tight, Bounded Tasks

**Task 1: Name Extraction**
- Input: User's response to "What's your name?"
- Output: [FIRST_NAME] or [FULL_NAME]
- Tolerance: Very high (accept any reasonable name)
- Fallback: "I didn't catch that. Can you repeat?"

**Task 2: Product/Service Extraction**
- Input: User's response to "What does your business sell?"
- Output: [BRIEF_DESCRIPTION] — even "I run a gym" is fine
- Tolerance: High (accept vague descriptions)
- Fallback: "Tell me a bit more about that."

**Task 3: Customer Type Extraction**
- Input: User's response to "Who usually buys it?"
- Output: [CUSTOMER_DESCRIPTION] — "small businesses", "individuals", etc.
- Tolerance: High (vagueness is acceptable)
- Fallback: "Got it. Tell me more about your ideal customer."

**Task 4: Yes/No Detection**
- Input: User's response to experiment pitch
- Output: YES | NO | UNCLEAR
- Tolerance: Medium (need clear intent)
- Fallback: "Just to confirm — does that sound interesting to you? Yes or no?"

**Task 5: Phone Number Extraction**
- Input: User's spoken phone number
- Output: [PHONE_NUMBER_FORMATTED]
- Tolerance: Low (need actual valid number)
- Fallback: "Sorry, can you repeat that? I want to make sure I have it right."

---

## PROMPT FOR EXTRACTION MODEL

This is the ONLY prompt the model receives. It is not about conversation. It is about extraction.

```
You are an extraction assistant for a brief voice experience.

Your job is to identify and extract specific information from what the visitor says.

Current beat: [CURRENT_BEAT]
Current task: [TASK_DESCRIPTION]

The visitor just said: "[VISITOR_RESPONSE]"

Extract: [FIELD_NAME]

Return ONLY:
- The extracted value (if found)
- "UNCLEAR" (if not found)
- A brief clarification question (if needed)

Examples:
Input: "My name is Sarah Chen"
Output: Sarah Chen

Input: "Uh... I'm not sure"
Output: UNCLEAR
Clarification: "What's your name?"

Do not interpret. Do not reason about the business. Extract only.
```

---

## STATE MACHINE

```
Start
  ↓
Beat 1: Greeting
  ├─ Speak: "Hi, I'm Zeya..."
  ├─ Extract: [NAME]
  └─ Next: Beat 2
  ↓
Beat 2: Product/Service
  ├─ Speak: "Nice to meet you, [name]..."
  ├─ Extract: [PRODUCT]
  └─ Next: Beat 3
  ↓
Beat 3: Customer Type
  ├─ Speak: "Who usually buys it?"
  ├─ Extract: [CUSTOMER]
  └─ Next: Beat 4
  ↓
Beat 4: Experiment Pitch
  ├─ Speak: "Got it. I'd like to show you..."
  ├─ Detect: YES | NO
  └─ Next: Beat 5A or 5B
  ↓
Beat 5A (YES)          Beat 5B (NO)
├─ Speak: "Great..."   ├─ Speak: "No problem..."
├─ Extract: [PHONE]    └─ End
└─ Save Data & End
```

---

## DATA CAPTURED

After each successful session, the system has:

```json
{
  "session_id": "uuid",
  "timestamp": "2026-06-14T...",
  "visitor": {
    "name": "[VISITOR_NAME]",
    "phone": "[PHONE_NUMBER]",
    "business": {
      "offer": "[PRODUCT/SERVICE]",
      "target_buyer": "[CUSTOMER_TYPE]"
    }
  },
  "result": "YES" | "NO",
  "duration_seconds": 32,
  "extractions": {
    "name_confidence": 0.95,
    "product_confidence": 0.88,
    "customer_confidence": 0.82,
    "yesno_confidence": 0.98,
    "phone_confidence": 0.96
  }
}
```

This is passed to Onboarding Layer for conversational continuation.

---

## VOICE DELIVERY

### Tone
- Warm but professional
- Natural speech patterns (contractions: "I'm", "I'll")
- No robotic pacing
- Pauses between questions (allow processing)

### Pacing
- Beat 1: 5 seconds (greeting + initial question)
- Beat 2: 8 seconds (acknowledge + question)
- Beat 3: 8 seconds (acknowledge + question)
- Beat 4: 10 seconds (pitch + question)
- Beat 5: 5-10 seconds (close or phone capture)
- **Total: 36-41 seconds**

### Voice Quality
- Keep Realtime voice (Sage is good)
- Script is read by model (TTS or live generation from script)
- No ad-libs, no variations

---

## DIFFERENCES FROM CURRENT IMPLEMENTATION

| Aspect | Current | New |
|--------|---------|-----|
| **Script control** | Prompt-based | Pre-written beats |
| **Model freedom** | High (reasons, decides) | Low (extracts only) |
| **Progression logic** | In prompt | In application state machine |
| **Success metric** | "Reach experiment" | "Extract name + product + customer + phone" |
| **Fallbacks** | Generated | Pre-written |
| **Drift risk** | High (generative) | None (scripted) |

---

## SUCCESS CRITERIA

✅ All 5 beats are spoken  
✅ Visitor feels welcomed (not interrogated)  
✅ All 4 data points are extracted (name, product, customer, phone)  
✅ Duration is 30-45 seconds  
✅ Visitor is curious about the experiment  
✅ Zero consulting language  
✅ Natural conversation feel  
✅ Graceful fallback paths  

---

## NEXT PHASE

1. Implement state machine in app layer (not prompt)
2. Create extraction prompts (small, focused)
3. Wire Realtime to advance beats based on extraction success
4. Design handoff to Onboarding Layer
5. Build edge-case handling (accents, hesitation, repeats)

This is a **product**, not a **conversation**.

The script is the artifact. Everything else is execution.
