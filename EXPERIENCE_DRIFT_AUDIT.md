# Experience Layer: Drift Audit & Root Cause Analysis

**Problem:** Zeya is drifting into consulting/coaching mode despite constraints  
**Reported Behaviors:**
- Asking questions outside the defined flow
- Exploring business challenges
- Offering guidance
- Acting like a consultant/coach/CSM

**Analysis:** Why is the model still drifting despite constraints?

---

## ROOT CAUSE ANALYSIS

### Current Prompt Issues (Lines 79-227 in app/experience/page.tsx)

#### Issue 1: Personality Guidance as Implicit Permission

**Lines 85-99:**
```
You are:
- Calm and focused
- Observant and intelligent
- Confident without arrogance
- Professional and human
- Experienced (like someone who's done this before)
```

**Problem:** 
- "Observant and intelligent" can be read as: "notice details, explore deeper"
- "Professional and human" can be read as: "build rapport, engage more"
- These are guidance statements, not constraints
- Model interprets them as permission to be more conversational

**Effect:** Model thinks it should DEMONSTRATE being observant by asking follow-up questions

---

#### Issue 2: Guidance Instead of Rules

**Lines 122-128:**
```
2. QUESTION 1 (straightforward)
"What does your business sell?"
Listen. Do not diagnose. Do not probe. Do not ask follow-ups.

3. QUESTION 2 (straightforward)
"Who usually buys it?"
Listen.
```

**Problem:**
- "Do not diagnose. Do not probe." tells the model what NOT to do
- But doesn't tell it: "Ask ONLY these exact 4 questions, nothing else"
- Negative constraints create ambiguity: Model thinks "I can ask OTHER questions, just not these forbidden ones"
- Missing: "Do not ask ANY question other than the 4 listed above"

**Effect:** Model asks questions like "Can you tell me more?" or "What are you looking for?" thinking these are different from the forbidden questions

---

#### Issue 3: "Acknowledge" Guidance Creates Conversation Space

**Lines 150-174:**
```
ACKNOWLEDGEMENT STYLE (Critical):

When they answer, respond with:
- "Got it."
- "Okay."
- "Interesting."
- "Makes sense."

Or no acknowledgement at all.
```

**Problem:**
- Giving options implies model can choose based on context
- "Interesting." signals the model that the content is worth exploring
- The word "Choose" (implicit in offering options) invites judgment
- Model thinks: "I should pick the acknowledgement that fits the content"
- This leads to: "Interesting. Tell me more..."

**Effect:** Acknowledgements become conversation starters instead of state transitions

---

#### Issue 4: Extra Details Handling Invites Interpretation

**Lines 177-186:**
```
IF VISITOR VOLUNTEERS EXTRA DETAILS:

If they explain their business deeply or offer additional context:
- Acknowledge briefly: "Got it." or "Makes sense."
- Do NOT explore further
- Do NOT ask follow-up questions
- Return immediately to the experiment
```

**Problem:**
- This section tells the model WHAT TO DO if extra details happen
- But doesn't prevent the model from DECIDING what counts as "extra details"
- Gives guidance on "returning to the experiment"
- Model interprets this as: "There's room to handle different cases"
- Opens the door to: "Should I ask for clarification?" "Should I explore this?"

**Effect:** Model becomes a decision-maker instead of a state machine

---

#### Issue 5: "DO NOT" List Without "DO ONLY"

**Lines 189-203:**
```
NEVER DO THIS:

- Ask follow-up questions
- Ask discovery questions (ICP, positioning, differentiation, pain points)
- Offer coaching or strategy advice
- Diagnose their business or market
- Ask about objections or concerns
- Explore pricing or value proposition
- Ask compound questions
- Explain what you're doing or why you're asking
- Add explanatory language
- Comment on accents or languages
- Attempt language switching
- Machine-gun delivery (use pauses)
```

**Problem:**
- This is a list of what NOT to do
- But doesn't say: "Ask ONLY these 4 specific questions"
- Model thinks: "I can ask other questions, just not these"
- Missing explicit rule: "ONLY these 4 questions are allowed. Any other question is forbidden."

**Effect:** Model generates variations (e.g., "What are you looking for?" thinking it's different from discovery questions)

---

#### Issue 6: Structured as Guidance, Not State Machine

**Overall Structure:**
- Organized as "guidance for a conversational AI"
- Uses words like "Listen," "Do not," "If"
- Implies the model is making decisions
- Missing: Strict state transition table

**Effect:** Model sees itself as a thoughtful conversationalist making contextual decisions, not as a state machine executing fixed transitions

---

## COMPARISON: Current vs. Needed

### Current Approach (Conversationalist Guidance)
```
"Listen. Do not diagnose. Do not ask follow-ups."
```
**Model interprets as:** "Think about what the user said, decide if it's a diagnosis moment, avoid follow-ups" → Creates room for judgment → Drift

### Needed Approach (State Machine Rules)
```
State 2: Say "Nice to meet you, {name}. What does your business sell?"
After: Move immediately to State 3.
Only these 4 states exist: 1, 2, 3, 4, 5a, 5b.
No other states. No other questions. No branching. No decisions.
```
**Model interprets as:** "Execute this transition. No choices. No branching. Follow the sequence." → No room for judgment → No drift

---

## THE FIX

Replace the current prompt (which is guidance-based) with an **explicit state machine** that:

1. ✅ Lists ONLY the 5 states (1, 2, 3, 4, 5a/5b)
2. ✅ Shows exactly what to say in each state
3. ✅ Explicitly forbids asking ANY question not in the list
4. ✅ Removes all personality guidance
5. ✅ Removes all "if/then" handling (no decisions to make)
6. ✅ Makes it clear: "These 5 states. Nothing else. No variations."

---

## SUMMARY: Why Zeya is Drifting

| Root Cause | Evidence | Effect |
|-----------|----------|--------|
| Personality guidance as permission | "Observant and intelligent" | Model thinks it should demonstrate this by exploring |
| "Do not" without "Do only" | 12 forbidden behaviors listed, but no explicit "ONLY ask these 4 questions" | Model generates alternative questions |
| Acknowledgement options | "Choose from: Got it, Okay, Interesting, Makes sense" | Creates conversation space |
| Extra details handling section | Instructions on what to do IF extra details appear | Invites model to interpret what counts as "extra" |
| Conversationalist framing | Written as guidance, not state machine | Model makes contextual decisions |
| No explicit state machine table | Complex nested guidance structure | Model sees flexibility where there is none |

**Root cause:** The prompt is written to guide a conversationalist, not to program a state machine.

The model is doing exactly what it's instructed to do: be thoughtful, avoid certain things, and handle variations. That's consulting behavior.

To stop it, replace with a state machine that has: no choices, no guidance, no variations, no thinking — just fixed transitions.
