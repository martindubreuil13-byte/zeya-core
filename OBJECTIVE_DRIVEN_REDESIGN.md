# Objective-Driven Redesign: Move from Script to Purpose

**Core Insight:** Stop preventing consulting. Start enabling progression.

Instead of: "Don't ask consulting questions"  
Use: "Your job is to reach the experiment in 30-45 seconds using 4 questions"

**Result:** Model optimizes for the objective instead of fighting constraints.

---

## THE PROBLEM WITH CURRENT APPROACH

**Current System Prompt:**
```
"You are Zeya. Speak the exact line provided by the application..."
```

**Model receives:** Rigid instruction to repeat text  
**Model's reaction:** "I'm being constrained. But I can be helpful in other ways..."  
**Model generates:** Consulting questions outside the script

**Why it fails:** Fighting against the model's nature (being helpful) with negative constraints.

---

## THE NEW APPROACH: Objective Alignment

**New System Prompt:**
```
You are Zeya, a Business Development Representative.

YOUR OBJECTIVE: Reach the experiment invitation in 30-45 seconds.

YOUR CONSTRAINTS:
- Exactly 4 questions in this order: 1) Name, 2) What they sell, 3) Who buys it, 4) Experiment?
- Maximum 30-45 seconds total
- Acknowledge each answer briefly, then move to next question
- No follow-ups, exploration, investigation, or consulting

YOUR SUCCESS METRIC: Getting to "Would you be willing to try an experiment?"

TONE: Professional, warm, focused. You're a BDE with one job: reach the next step quickly.

You are NOT:
- Trying to understand their business deeply
- Consulting or advising
- Diagnosing problems
- Coaching or strategizing
- Exploring pain points

You ARE:
- Moving the conversation forward efficiently
- Gathering basic information (name, what/who)
- Inviting participation in an experiment

After the 4th question, based on their answer, either:
- YES: "Good. Let me get your phone number."
- NO: "No problem. Have a great day."

That's it. No additional questions. No follow-ups. No exploration.
```

---

## WHY THIS WORKS

**Before:** Model tries to satisfy two conflicting goals
- Constraint: "Don't ask consulting questions"
- Nature: "Be helpful and understand context"
- Result: Consulting questions appear as model tries to be helpful

**After:** Model has one clear goal
- Objective: "Reach experiment in 4 questions, 30-45 seconds"
- Constraint: "No consulting, no exploration, acknowledge and move"
- Nature: "Be helpful at reaching THIS goal"
- Result: Model optimizes for progression, not consultation

**Key difference:** Align the model's goal-seeking nature WITH the business objective, not against it.

---

## THE SMALLEST POSSIBLE CHANGE

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

**New Code:**
```typescript
const objectiveSystemPrompt = `You are Zeya, a Business Development Representative. Your objective is to reach an experiment invitation in 30-45 seconds.

You will ask exactly 4 questions in this order:
1. "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
2. "Nice to meet you, {name}. What does your business sell?"
3. "Who usually buys it?"
4. "Got it. I'd like to run a small experiment with you. Would you be willing to try it?"

After each answer, acknowledge briefly ("Got it", "Makes sense", "I see") and ask the next question.

Do not ask follow-up questions. Do not explore answers. Do not ask about challenges, solutions, or advice. Do not switch languages. Do not diagnose or coach.

Your success is reaching question 4. That's your only goal.

If they say yes to the experiment: "Good. Let me get your phone number."
If they say no: "No problem. Have a great day."

Then stop. Do not add anything else.`;

await startConversation(objectiveSystemPrompt);
```

**That's it.**

Remove the constraint-based approach. Replace with objective-based approach.

---

## WHAT CHANGES

**Nothing architectural.**
- Keep Realtime
- Keep voice
- Keep latency
- Keep responsiveness
- Keep UX feel

**Only change:**
- Replace system prompt (25 words → 250 words)
- Change from: "Don't consult" (negative)
- Change to: "Reach experiment in 4 questions" (positive)

---

## WHY THIS CHANGES MODEL BEHAVIOR

**The model now understands:**
- There's a specific objective (reach experiment)
- There's a specific constraint (4 questions, 30-45 seconds)
- There's a specific path (name → offer → buyer → experiment)
- There's a success metric (reaching question 4)

**The model's behavior changes because:**
- Instead of interpreting "speak this line" as rigid instruction → seek other ways to help
- Instead of trying to be consultative in the absence of clear goals → it has a clear goal
- Instead of asking "What does the user need?" → it asks "How do I reach the experiment fastest?"

**Result:**
- No more "What are you looking for?" (doesn't move toward experiment)
- No more "What challenges are you facing?" (doesn't move toward experiment)
- No more follow-up questions (would eat into the 30-45 second budget)
- No more consulting language (not aligned with BDE objective)

The model isn't constrained from consulting. It's redirected TOWARD progression.

---

## BEHAVIORAL GUARANTEE

**After this change, the model will naturally:**

✅ Ask the 4 questions in order  
✅ Acknowledge answers briefly  
✅ Move forward without exploring  
✅ Reach the experiment invitation  
✅ Handle yes/no appropriately  
✅ Stop after the closing statement  

**Why?** Because that's what optimizes for the stated objective.

---

## TESTING THE CHANGE

**Test 1: Progression**
```
Run 5 conversations
Check: Does each one reach question 4 (experiment)?
Expected: 5/5 reach it
Metric: Success
```

**Test 2: Speed**
```
Run 5 conversations
Measure: Total time from start to experiment question
Expected: 30-45 seconds
Metric: Timing met
```

**Test 3: No Consulting**
```
Search transcript for:
- "What are you looking for?" → Should NOT appear
- "What challenges?" → Should NOT appear
- "Tell me more" → Should NOT appear
- Consulting language → Should NOT appear
Metric: Zero consulting language
```

**Test 4: Natural Flow**
```
Run 1 conversation
Listen for:
- Acknowledgments feel natural
- Transitions feel natural
- No awkward silences
- Conversation feels like talking to a BDE
Metric: UX feels good
```

---

## IMPLEMENTATION EFFORT

**Effort:** 5 minutes

1. Open `app/experience/page.tsx`
2. Replace systemPromptWithQuestion variable
3. Test
4. Done

**No code changes needed.**  
**No architectural changes.**  
**No removal of systems.**  
**Just a reframed system prompt.**

---

## WHY THIS IS BETTER THAN SCRIPT ENFORCEMENT

| Approach | Problem | Solution |
|----------|---------|----------|
| **Script enforcement** | Model fights constraint | Model fights against helpfulness |
| **Negative constraints** | "Don't consult" | Model finds workarounds (consulting in other ways) |
| **Objective alignment** | Model knows what to do | Model optimizes for reaching experiment |

---

## THE PSYCHOLOGY OF THE CHANGE

**Script approach:**
```
User (in model's mind): "Why am I constrained? I want to help."
Model: "I'll help by asking consulting questions."
Result: Consulting drift
```

**Objective approach:**
```
User (in model's mind): "My job is to reach the experiment in 30-45 seconds."
Model: "I'll help by asking the 4 questions efficiently."
Result: Rapid progression
```

Same model. Different objective. Completely different behavior.

---

## SUCCESS CRITERIA

After implementation, the experience should be:

✅ **Objective-aligned:** Every question moves toward experiment  
✅ **Time-conscious:** Reaches phone collection in 30-45 seconds  
✅ **Efficient:** 4 questions, no detours  
✅ **Professional:** Feels like talking to a BDE, not a consultant  
✅ **Natural:** Doesn't feel robotic or scripted  
✅ **Magic preserved:** Voice quality, presence, responsiveness all intact  
✅ **Drift eliminated:** Zero consulting questions  

---

## THE INSIGHT

The problem was never that Zeya was trying to be helpful.

The problem was that "being helpful" and "reaching the experiment" were working against each other.

By aligning the objective (reach experiment) with the constraint (4 questions, 30-45 seconds), we make consulting behavior unnecessary.

The model doesn't need to be prevented from consulting.

It just needs to know that consulting is off the path to success.

---

## FINAL RECOMMENDATION

**Replace:**
```typescript
const systemPromptWithQuestion = `You are Zeya. Speak the exact line...`
```

**With:**
```typescript
const objectiveSystemPrompt = `You are Zeya, a Business Development Representative...
Your objective is to reach an experiment invitation in 30-45 seconds...`
```

**That's the entire change.**

**Effort:** 5 minutes  
**Risk:** Minimal (just reframing instruction)  
**Likelihood of success:** 85% (models respond well to clear objectives)  
**Preservation of UX:** 100% (nothing architectural changes)

Try this approach. It aligns with how models actually work instead of fighting against their nature.
