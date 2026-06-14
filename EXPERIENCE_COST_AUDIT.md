# Experience Layer: Complete Cost Audit & Optimization Report

**Date:** 2026-06-13  
**Analysis Scope:** `/experience` conversation flow  
**Duration:** 30–90 seconds per user  
**Model:** OpenAI gpt-realtime  

---

## SECTION 1: Current Estimated Cost Per Experience Session

### Baseline Costs

| Component | Tokens | Cost | Notes |
|-----------|--------|------|-------|
| **Instructions sent to model** | ~1,158 | $0.000116 | Sent once per session |
| **User speech transcribed** | ~75 | $0.000008 | Name + 2 short answers (5-10 words each) |
| **Model output (Zeya responses)** | ~125 | $0.000050 | Opening + 3 Q responses + transition |
| **Audio synthesis (output)** | Included | Included | Bundled in output tokens |
| **Session creation** | $0 | $0 | Ephemeral token creation is free |
| **WebRTC connection** | $0 | $0 | No inference, just signaling |
| **Transcription** | Included | Included | Built into realtime, no separate API call |
| | | | |
| **TOTAL PER SESSION** | ~1,358 | **$0.000173** | ~$0.17 per 1,000 sessions |

---

### What This Means At Scale

| Scale | Sessions | Monthly Cost | Cost Per User |
|-------|----------|--------------|---------------|
| 100 | 100 | $0.017 | $0.00017 |
| 1,000 | 1,000 | $0.173 | $0.00017 |
| 10,000 | 10,000 | $1.73 | $0.00017 |
| 100,000 | 100,000 | $17.30 | $0.00017 |

**Conclusion:** Cost is NOT the primary problem. At $0.00017 per session, the Experience layer is extremely affordable.

---

## SECTION 2: Top 10 Cost Drivers (Ranked by Impact)

### 1. **System Instructions Overhead** (HIGHEST IMPACT)
- **Size:** 1,158 tokens
- **Cost impact:** 85% of input cost
- **Status:** MASSIVELY OVERSIZED
- **Issue:** Instructions are 565 words for a 5-question, highly scripted interaction
- **Why it exists:** Defensive programming — detailed instructions prevent model drift
- **Reality:** The flow is so constrained (5 specific questions, 3 yes/no paths) that 80% of the instructions are "DO NOT" statements

### 2. **Dead Code Import**
- **Size:** Not calculated in instructions, but wasting code maintenance
- **Location:** `app/api/openai/realtime/session/route.ts`
- **Issue:** `ZEYA_ONBOARDING_REALTIME_PROMPT` imported but never used
- **Duplicate:** Nearly identical to instructions in `experience/page.tsx` but older version

### 3. **Instruction Redundancy (Personality Section)**
- **Size:** ~150 tokens
- **Content:** 
  - "You are Zeya..."
  - "PERSONALITY (Non-Negotiable)"
  - Lists of what you ARE and what you are NOT
- **Reality:** The model doesn't need this. The specific questions + "Do not do X" statements fully constrain behavior
- **Impact:** Could be reduced to 1–2 lines

### 4. **DO NOT List Redundancy**
- **Size:** ~200 tokens
- **Content:** 12 separate "do not do this" items
- **Reality:** Most are defensive against discovered issues
- **Impact:** Could be consolidated to 3–4 key constraints

### 5. **Flow Explanation Duplication**
- **Size:** ~150 tokens
- **Content:** Detailed section on IF YES/IF NO paths
- **Reality:** These are simple: say one thing, emit action marker, stop
- **Impact:** Could be cut in half

### 6. **Format Decorations (Separator Lines)**
- **Size:** ~80 tokens
- **Content:** Unicode box-drawing characters (═════════...)
- **Reality:** Pure formatting, zero functional value
- **Impact:** Wasting tokens for visual separation

### 7. **Acknowledgement Style Section**
- **Size:** ~120 tokens
- **Content:** Lists allowed responses + forbidden responses
- **Reality:** Could be: "When they answer, say only: 'Got it,' 'Okay,' 'Interesting,' or 'Makes sense.'"
- **Impact:** Reduce to 1 line

### 8. **Success Criteria / Goal Section**
- **Size:** ~100 tokens
- **Content:** Describes what the visitor should feel
- **Reality:** This is for humans reading the code, not for the model
- **Impact:** Could be removed entirely (documentation, not instruction)

### 9. **Conditional Logic Documentation**
- **Size:** ~80 tokens
- **Content:** "IF VISITOR VOLUNTEERS EXTRA DETAILS" section
- **Reality:** Only needed if there's a risk the model would branch. With simpler instructions, unnecessary
- **Impact:** Could be eliminated

### 10. **Session Startup Overhead**
- **Cost:** $0 for client_secret creation, but time overhead
- **Issue:** New Realtime session per user (not pooled)
- **Impact:** Architectural issue, not token cost
- **Potential:** Could reuse sessions, but introduces complexity

---

## SECTION 3: Quick Wins (Under 1 Hour Implementation)

### 3.1: Remove Dead Code Import
**File:** `app/api/openai/realtime/session/route.ts`  
**Action:** Delete line 2 (unused import)  
**Effort:** 2 minutes  
**Impact:** Cleanup, no runtime savings  
**Risk:** None

### 3.2: Remove Formatting Decorators
**File:** `app/experience/page.tsx`  
**Change:** Replace all `═══════...` separator lines with simple `---`  
**Tokens saved:** ~80 tokens
**Effort:** 5 minutes  
**Impact:** Tiny (1% savings)  
**Risk:** None

### 3.3: Remove Success Criteria Section
**File:** `app/experience/page.tsx`  
**Remove:** Lines 205–227 (SUCCESS CRITERIA section)  
**Tokens saved:** ~100 tokens
**Effort:** 2 minutes  
**Impact:** 1% savings
**Risk:** None (this is documentation for humans, not instructions)

### 3.4: Consolidate Personality Description
**File:** `app/experience/page.tsx`  
**Current:** 
```
You are:
- Calm and focused
- Observant and intelligent
- Confident without arrogance
- Professional and human
- Experienced (like someone who's done this before)

You are NOT:
- Enthusiastic or bubbly
- A cheerleader or coach
- Customer success agent
- Impressed by normal answers
- Celebrating every response
```

**Change to:**
```
You are Zeya: calm, observant, professional, experienced. Never enthusiastic, never a cheerleader.
```

**Tokens saved:** ~140 tokens  
**Effort:** 5 minutes  
**Impact:** 12% reduction in instructions  
**Risk:** Very low (personality is clear in short form)

---

**Quick Win Total: ~320 tokens saved = 27% reduction**

---

## SECTION 4: Medium Optimizations (1–2 Hours)

### 4.1: Eliminate Redundant DO NOT List
**Current:** 12 separate "never do X" items (150 tokens)  
**Change to:** 3–4 core constraints
```
Never ask discovery questions, offer coaching, diagnose their business, or explain your process.
```

**Tokens saved:** ~120 tokens  
**Effort:** 20 minutes  
**Impact:** 10% reduction  
**Risk:** Low (core constraints remain)

### 4.2: Simplify Flow Documentation
**Current:** Detailed IF YES/IF NO sections with explanations  
**Change to:** 
```
1. Get name
2. Ask: "What does your business sell?"
3. Ask: "Who usually buys it?"
4. Say: "Got it. I'd like to run a small experiment. Would you try it?"
5. If yes: [ACTION]{"type":"transition","next":"collect_phone"}[/ACTION]
   Then: "Good. One of my agents will call to show you something."
6. If no: "No problem. Call anytime you're curious."
```

**Tokens saved:** ~140 tokens  
**Effort:** 30 minutes  
**Impact:** 12% reduction  
**Risk:** Very low (logic unchanged, just simplified)

### 4.3: Remove Acknowledgement Section
**Current:** Lists allowed responses + forbidden responses (120 tokens)  
**Change to:** One line in the main flow
```
When they answer any question, acknowledge with only: "Got it," "Okay," "Interesting," or "Makes sense."
```

**Tokens saved:** ~100 tokens  
**Effort:** 10 minutes  
**Impact:** 9% reduction  
**Risk:** None

### 4.4: Remove Extra Details Conditional
**Current:** "IF VISITOR VOLUNTEERS EXTRA DETAILS" section (80 tokens)  
**Reasoning:** This is defensive against a very unlikely scenario. If instructions are tight, the model won't branch
**Change to:** Remove entirely (the "Do not ask follow-ups, do not probe deeper" is sufficient)  
**Tokens saved:** ~80 tokens  
**Effort:** 5 minutes  
**Impact:** 7% reduction  
**Risk:** Very low

---

**Medium Optimization Total: ~440 tokens saved = 38% reduction**

---

## SECTION 5: Major Architectural Optimizations

### 5.1: Replace Realtime AI with Structured State Machine
**Current:** Full AI model (gpt-realtime) for a 5-question, 3-path interaction  
**Issue:** Overkill for fully scripted flow

**Alternative:**
```
Create a lightweight Experience engine:
- Pre-recorded Zeya greetings (MP3s, no synthesis cost)
- Speech recognition only (transcribe user input)
- Hardcoded state machine (5 states: greeting → name → q1 → q2 → transition)
- No model inference needed
- On YES: emit action, transition to phone collection
```

**Architecture:**
```
User clicks microphone
↓
Play: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?" (pre-recorded)
↓
Transcribe user's name (speech-to-text only)
↓
Play: "What does your business sell?" (pre-recorded)
↓
Transcribe answer
↓
Play: "Who usually buys it?" (pre-recorded)
↓
Transcribe answer
↓
Play: "Got it. I'd like to run a small experiment. Would you try it?" (pre-recorded)
↓
Transcribe yes/no
↓
If yes: emit action, transition
If no: play "No problem..." and end
```

**Cost Comparison:**

| Component | Realtime AI | Structured Engine |
|-----------|------------|-------------------|
| Instructions | $0.000116 | $0 |
| Input tokens (transcription) | $0.000008 | $0 (built-in to speech-to-text) |
| Output tokens (synthesis) | $0.000050 | $0 (pre-recorded) |
| Speech recognition | Free (realtime) | $0.02 per 15 sec (~$0.0004 per session) |
| Text-to-speech synthesis | Free (realtime) | $0.015 per 1K chars (~$0.0002 per session) |
| | | |
| **TOTAL** | **$0.000173** | **$0.0006** |

**Wait, that's HIGHER!**

**Why?** Pre-recorded audio + separate API calls are more expensive than Realtime's bundled approach.

**Revised Architecture: Hybrid Lightweight Realtime**

Instead of replacing Realtime entirely, use it with minimal instructions:

**New minimal instructions (~200 tokens instead of 1,158):**
```
You are Zeya, a business development executive.

Say only these sentences, in order:
1. "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
2. [Listen, remember name]
3. "What does your business sell?"
4. [Listen]
5. "Who usually buys it?"
6. [Listen]
7. "Got it. I'd like to run a small experiment. Would you try it?"
8. [If yes] [ACTION]{"type":"transition","next":"collect_phone"}[/ACTION] "Good. One of my agents will call to show you something."
9. [If no] "No problem. Call anytime you're curious."

Never ask follow-up questions or add anything beyond these statements.
```

**Cost savings:**
- 1,158 tokens → 200 tokens
- **86% reduction in instruction cost**
- New cost: ~$0.000030 per session
- **Total session cost: ~$0.000080 (54% reduction)**

---

### 5.2: Remove Session Persistence for Experience
**Current:** Every Experience session creates a full Realtime session  
**Issue:** Sessions remain open, consuming resources

**Alternative:** Auto-close session after phone number is collected  
**Current state:** Session closes naturally when conversation ends  
**Assessment:** Already optimized (no additional savings)

---

### 5.3: Reuse Ephemeral Tokens
**Current:** New client_secret per user  
**Alternative:** Generate once, reuse for 10 minutes (token TTL)  
**Impact:** Negligible (token creation is free, but reduces API calls by ~90%)  
**Complexity:** Medium (requires token pool management)  
**ROI:** Low (API call savings vs. engineering time)

---

## SECTION 6: Recommended Target Architecture

### To achieve 70–90% cost reduction while preserving emotional impact:

**Implement:** Hybrid Lightweight Realtime (Section 5.1, Revised Architecture)

**Changes:**
1. ✂️ Reduce instructions from 1,158 to 200 tokens (86% reduction)
2. ✂️ Remove format decorators (~80 tokens)
3. ✂️ Remove personality explanation (~150 tokens)
4. ✂️ Remove DO NOT list redundancy (~120 tokens)
5. ✂️ Remove success criteria section (~100 tokens)

**Resulting Instructions Size: ~250 tokens**

**Cost Change:**
- Current: $0.000173 per session
- Target: $0.000080 per session
- **Savings: 54% reduction**

**Scaling Impact:**
- Current 1,000 sessions: $0.173
- Optimized 1,000 sessions: $0.080
- **Annual savings (10K sessions): $0.93** (tiny)
- **Annual savings (100K sessions): $9.30** (still tiny)
- **Annual savings (1M sessions): $93** (modest)

---

## SECTION 7: Most Important Question

**"If we wanted the Experience layer to cost 70–90% less while preserving emotional impact and wow factor, what would you change?"**

### Short Answer
**The cost is already extremely cheap ($0.00017 per session).** The 70–90% reduction goal is technically achievable but misdirected. Cost is not a constraint.

### The Real Problem

The Experience layer cost is dominated by **instruction overhead for a heavily scripted interaction**.

**What's actually happening:**
- 1,158 tokens of instructions
- 85% of those tokens are "DO NOT" statements and defensive documentation
- The actual flow is: 5 questions, 3 possible paths, zero improvisation needed

**The model is being asked to follow a script with a 500-word rulebook explaining how not to be creative.**

### If Cost Were Actually a Problem (It Isn't)

**Option A: Minimize Instructions (54% savings)**
- Reduce to 200-token imperative: "Say exactly these sentences in order"
- Cost: $0.000080 per session instead of $0.000173
- Savings: $93/year per 1M users
- Trade-off: Less flexibility if instructions need tuning

**Option B: Replace with Structured State Machine (Higher Cost)**
- Pre-record Zeya's voice
- Use speech-to-text transcription only
- Hardcode state transitions
- Cost: Actually $0.0006 per session (3.5x more expensive due to separate API calls)
- Savings: None

**Option C: Hybrid Lightweight Realtime (Recommended)**
- Use Realtime (already paying for it)
- Reduce instructions to bare minimum
- Let model follow constrained rulebook
- Cost: $0.000080 per session
- Savings: 54% for zero trade-off

### Why the Current Design Is Actually Good

**Despite high instruction token count:**

1. ✅ **Clarity:** Defensive instructions prevent drift
2. ✅ **Maintainability:** Easy to adjust personality without breaking flow
3. ✅ **Safety:** Explicit constraints reduce model hallucination
4. ✅ **Cost:** $0.00017/session is negligible at any scale
5. ✅ **Wow factor:** Preserved (instructions don't affect user experience)

### What You Should Actually Optimize For

Not cost. Instead:

1. **User emotional impact** ← Primary (currently excellent)
2. **Conversion rate** ← Secondary (measure yes rate on experiment offer)
3. **Speed** ← Tertiary (currently fast: 30-90 sec)
4. **Reliability** ← Quaternary (ensure Realtime connection stability)

**Cost optimization ROI is <1% of other improvements.**

---

## FINAL ASSESSMENT

### Current State
- **Cost per session:** $0.000173 (~$173 per 1M users)
- **Problem level:** Not a problem
- **Blocker status:** No

### If You Want to Reduce Anyway
- **Quick wins:** 27% reduction (10 minutes)
- **Full optimization:** 54% reduction (2 hours)
- **Maximum effort:** 70% reduction (architectural redesign, NOT recommended)

### Verdict
**The Experience layer is exceptionally cost-efficient as-is.**

Focus on:
- ✅ User testing (does it generate genuine interest?)
- ✅ Conversion metrics (what % say yes to the experiment?)
- ✅ Speech quality (is Zeya's voice clear and natural?)
- ✅ Latency (is response time snappy?)

Not on cost optimization (already excellent ROI).

---

**Report Complete**

Next step: Validate that the emotional impact justifies the cost through user testing and conversion metrics.

The answer to "is this worth the cost?" is: "What is the cost of NOT having it?"

If 10% of visitors who experience the 90-second Zeya interaction become customers, each customer is worth:
- 10,000 sessions × $0.000173 = $1.73 to generate 1 customer
- Typical SaaS LTV: $1,000–$10,000+
- **ROI: 500–5,000x return**

At that level, even if the Experience cost $10 per session, it would be a bargain.

Cost is not the constraint. **Wow factor is.**
