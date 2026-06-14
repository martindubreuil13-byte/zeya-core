# Deployment: Objective-Driven Experience

**Status:** ✅ DEPLOYED  
**Date:** 2026-06-13  
**Build:** ✅ Success  

---

## WHAT CHANGED

**File:** `app/experience/page.tsx` lines 137-145

**Before:**
```typescript
const systemPromptWithQuestion = `You are Zeya. Speak the exact line provided by the application...`;
```

**After:**
```typescript
const objectiveSystemPrompt = `You are Zeya, a Business Development Representative.

Your objective is to reach the experiment invitation within 30-45 seconds.

To do that you only need four things:
1. Their name
2. What they sell
3. Who buys it
4. Permission to try the experiment

Move forward quickly.

Do not spend time understanding the business.
Do not investigate.
Do not diagnose.
Do not solve.

Progress is more important than understanding.

[Four questions in order...]`;
```

---

## WHAT THIS DOES

**Shifts from:** Constraint-based ("Don't ask consulting questions")  
**To:** Objective-based ("Reach experiment in 30-45 seconds")

**Result:** Model optimizes for progression instead of fighting constraints.

---

## EXPECTED BEHAVIOR

### What Should Happen

✅ Zeya asks 4 questions in order  
✅ Each question moves toward experiment  
✅ Zeya acknowledges briefly and moves forward  
✅ Zeya reaches experiment invitation in 30-45 seconds  
✅ Zeya handles yes/no appropriately  
✅ Zeya stops (no additional language)  

### What Should NOT Happen

❌ "What are you looking for?"  
❌ "What challenges are you facing?"  
❌ "Tell me more"  
❌ "How can I help?"  
❌ "What does that mean?"  
❌ Consulting language  
❌ Coaching language  
❌ Discovery questions  
❌ Follow-up questions  
❌ Language switching  

---

## BUILD VERIFICATION

```
✅ Compilation: Success (4.6s)
✅ TypeScript: Passed
✅ Routes: 47/47 generated
✅ No errors
✅ No warnings
```

---

## TEST PLAN

**Test 1: Complete Flow (5 min)**
```
[ ] Start experience
[ ] Zeya asks: "Hi, I'm Zeya..."
[ ] Say your name
[ ] Zeya asks: "Nice to meet you, {name}..."
[ ] Say what you sell
[ ] Zeya asks: "Who usually buys it?"
[ ] Say target buyer
[ ] Zeya asks: "Got it. Would you be willing to try an experiment?"
[ ] Say "yes"
[ ] Zeya says: "Good."
[ ] Phone form appears
```

**Test 2: Progression Speed (5 min)**
```
[ ] Time the full conversation
[ ] Expected: 30-45 seconds
[ ] Check: Each turn feels natural (not rushed)
[ ] Check: Zeya doesn't get stuck waiting for longer answers
```

**Test 3: No Consulting Behavior (10 min)**
```
[ ] Run 5 full conversations
[ ] Listen for consulting language
[ ] Search transcripts for drift terms
[ ] Expected: Zero consulting questions
```

**Test 4: "No" Path (5 min)**
```
[ ] Start experience
[ ] Go through 3 questions normally
[ ] At question 4, say "No"
[ ] Expected: Zeya says "No problem."
[ ] Expected: Conversation ends gracefully
```

**Test 5: Natural UX (5 min)**
```
[ ] Run one conversation naturally
[ ] Check: Does it feel like talking to a BDE?
[ ] Check: Does the progression feel smooth?
[ ] Check: Is the voice quality still good?
[ ] Check: Is the latency still responsive?
```

---

## SUCCESS CRITERIA

| Criterion | Status |
|-----------|--------|
| **Build succeeds** | ✅ Yes |
| **Zeya reaches experiment in 30-45s** | ⏳ Test |
| **Only 4 questions asked** | ⏳ Test |
| **No consulting language** | ⏳ Test |
| **Voice quality preserved** | ⏳ Test |
| **Responsive feel preserved** | ⏳ Test |
| **Natural conversation flow** | ⏳ Test |

---

## HOW TO TEST

### Option 1: Quick Test (5 min)
1. Run one conversation
2. Listen for consulting questions
3. Check if it reaches phone collection

### Option 2: Full Test (30 min)
1. Run all 5 tests above
2. Check success criteria
3. Verify no regressions

### Option 3: Extended Test (1 hour)
1. Run 20 conversations with different names/answers
2. Check for variability in behavior
3. Monitor for edge cases
4. Verify duration consistency

---

## ROLLBACK PLAN

If tests reveal issues:

```bash
git diff app/experience/page.tsx > objective-driven.patch
git checkout app/experience/page.tsx
npm run build
```

Time to rollback: 2 minutes  
Risk: Minimal (reverting to previous version)

---

## WHAT HASN'T CHANGED

✅ OpenAI Realtime API (kept)  
✅ Voice quality (Sage voice preserved)  
✅ Latency (WebRTC real-time)  
✅ Responsiveness (unchanged)  
✅ State machine (unchanged)  
✅ Phone collection (unchanged)  
✅ Supabase integration (unchanged)  
✅ Worker brief generation (unchanged)  
✅ Monitor infrastructure (unchanged)  

**Only the system prompt changed.**

---

## HYPOTHESIS

**Change in Model Behavior:**
- Old: Model tries to interpret constraints → finds consulting workarounds
- New: Model optimizes for objective → consulting becomes off-path

**Expected Result:**
- Zero consulting drift because consulting questions don't serve the 30-45 second objective
- Model naturally focuses on the 4 required data points
- Progression becomes the priority

---

## NEXT STEPS

1. **Run Test 1** (Complete Flow) — verify basic functionality
2. **Run Test 3** (No Consulting) — verify drift is eliminated
3. **Run Test 5** (Natural UX) — verify experience still feels good
4. **If all pass:** Deployed successfully
5. **If any fail:** Review failure mode and consider rollback

---

## MONITORING

After deployment, watch for:
- Duration consistency (should be 30-45 seconds)
- Consulting language in transcripts (should be 0)
- Phone collection rate (should match or improve)
- User experience feedback (should stay positive)

---

## CONFIDENCE LEVEL

**Technical:** 95% (prompt change, no architectural risk)  
**Behavioral:** 80% (aligns with model optimization, but models can be unpredictable)  
**Overall:** 85% (high confidence in approach, moderate in execution)

---

## DEPLOYMENT SUMMARY

| Item | Status |
|------|--------|
| **Code changes** | ✅ Complete (1 file, 8 lines) |
| **Build** | ✅ Success |
| **Type checking** | ✅ Passed |
| **No regressions** | ✅ Likely (isolated change) |
| **Ready for testing** | ✅ Yes |

---

**The objective-driven approach is now live.**

**Test to confirm consulting drift is eliminated.**
