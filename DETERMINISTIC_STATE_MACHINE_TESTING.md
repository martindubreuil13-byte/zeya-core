# Deterministic State Machine — Testing & Deployment

---

## DEPLOYMENT VERIFICATION

### Build Status
✅ **Compilation:** Successful (4.3s)
✅ **TypeScript:** No errors
✅ **Type Checking:** Passed
✅ **All Routes:** Compiled and generated

### Files Changed
- ✅ [app/experience/page.tsx](app/experience/page.tsx) — State machine + question logic
- ✅ [hooks/realtime/useRealtimeOnboardingSession.ts](hooks/realtime/useRealtimeOnboardingSession.ts) — sendNextQuestion + sendAction
- ✅ [hooks/voice/useVoiceConversation.ts](hooks/voice/useVoiceConversation.ts) — Type compatibility

### No Changes Made To
- ✅ Voice infrastructure (realtime client, WebRTC, etc.)
- ✅ OpenAI session creation endpoint
- ✅ Supabase dispatch persistence
- ✅ Telnyx worker brief generation
- ✅ Monitor infrastructure
- ✅ Worker memory or learning systems

---

## TEST CHECKLIST

### Phase 1: Connection & Initial State

**Test 1.1: Connection Establishment**
- [ ] Navigate to `/experience`
- [ ] Click "Start Conversation"
- [ ] Observe: Voice connection establishes (voiceState transitions to "listening")
- [ ] Expected: No errors in console
- [ ] ✅ Pass: Connection successful

**Test 1.2: Initial Question Sent**
- [ ] After connection, Zeya should speak immediately
- [ ] Expected Zeya says: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?"
- [ ] Observe: Exact wording (no additions, no variations)
- [ ] ✅ Pass: Question matches specification exactly

**Test 1.3: Application State**
- [ ] Verify: `conversationState === "initial"` on page load
- [ ] After Zeya speaks, should remain "initial" (waiting for response)
- [ ] Open DevTools: Check React state in Components tab
- [ ] ✅ Pass: State correctly tracked

---

### Phase 2: Name Capture

**Test 2.1: User Speaks Name**
- [ ] Say: "My name is Alex"
- [ ] Observe: Transcript shows final entry with text
- [ ] Expected transcript: `{ role: "user", isFinal: true, text: "My name is Alex" }`
- [ ] ✅ Pass: Transcript entry captured

**Test 2.2: State Transitions to name_asked**
- [ ] After name is captured, check React state
- [ ] Expected: `conversationState === "name_asked"`
- [ ] Expected: `visitorName === "Alex"`
- [ ] ✅ Pass: State advanced and name extracted

**Test 2.3: Second Question Sent**
- [ ] Zeya should speak: "Nice to meet you, Alex. What does your business sell?"
- [ ] Observe: Name is correctly interpolated
- [ ] Check: Uses the actual name spoken ("Alex"), not placeholder
- [ ] ✅ Pass: Name used correctly in question 2

---

### Phase 3: Offer Capture

**Test 3.1: User Speaks Offer**
- [ ] Say: "I run a fitness studio"
- [ ] Observe: Transcript shows 2nd final user entry
- [ ] Expected: `voiceTranscript[1]` has role "user" and isFinal true
- [ ] ✅ Pass: Offer captured in transcript

**Test 3.2: State Transitions to offer_asked**
- [ ] Check React state after user speaks
- [ ] Expected: `conversationState === "offer_asked"`
- [ ] ✅ Pass: State advanced

**Test 3.3: Third Question Sent**
- [ ] Zeya should speak: "Who usually buys it?"
- [ ] Check: No extra words, exact wording
- [ ] ✅ Pass: Question sent correctly

---

### Phase 4: Buyer Capture

**Test 4.1: User Speaks Buyer**
- [ ] Say: "People who love boxing and want to get fit"
- [ ] Observe: Transcript shows 3rd final user entry
- [ ] Expected: `voiceTranscript[2]` has the spoken answer
- [ ] ✅ Pass: Buyer target captured

**Test 4.2: State Transitions to buyer_asked**
- [ ] Check: `conversationState === "buyer_asked"`
- [ ] ✅ Pass: State advanced

**Test 4.3: Experiment Question Sent**
- [ ] Zeya should speak: "Got it. I'd like to run a small experiment with you. Would you be willing to try it?"
- [ ] Check: Exact wording, no extra framing
- [ ] ✅ Pass: Experiment question sent

---

### Phase 5: Yes/No Decision

**Test 5.1: User Says Yes**
- [ ] Say: "Yes, I'm interested" OR "Yeah sure"
- [ ] Observe: Transcript shows 4th final user entry
- [ ] Zeya should say: "Good."
- [ ] Check: `conversationState === "completed"`
- [ ] Observe: Page transitions to phone collection phase
- [ ] ✅ Pass: Yes path works

**Test 5.2: User Says No**
- [ ] Start new session
- [ ] Go through states 1-4 again
- [ ] At experiment question, say: "No, not interested"
- [ ] Zeya should say: "No problem."
- [ ] Check: Conversation ends naturally
- [ ] ✅ Pass: No path works

**Test 5.3: Yes/No Detection Logic**
- [ ] Test variations: "yes", "yeah", "sure", "absolutely", "interested"
- [ ] Each should be correctly identified as "yes"
- [ ] Test negatives: "no", "nope", "not really"
- [ ] Each should be correctly identified as "no"
- [ ] ✅ Pass: Detection logic accurate

---

### Phase 6: Phone Collection (If Yes)

**Test 6.1: Phone Capture**
- [ ] After "Good." response, page shows phone input
- [ ] Say or enter a phone number
- [ ] Visitor data should include: name, offer, buyer
- [ ] Expected in form: `{ name: "Alex", offer: "fitness studio", buyer: "boxing fans" }`
- [ ] ✅ Pass: Data correctly collected

**Test 6.2: Dispatch Creation**
- [ ] Check Supabase: Dispatch record created
- [ ] Verify: Contains visitor name, phone, offer, buyer
- [ ] Verify: Worker brief generated
- [ ] Verify: Link created between dispatch and brief
- [ ] ✅ Pass: Dispatch persistence working

---

### Phase 7: Consulting Behavior Prevention

**Test 7.1: No Consulting Questions**
- [ ] Run through full conversation
- [ ] Record all Zeya's questions
- [ ] Zeya should ask ONLY these 4 questions:
  - [ ] "What's your name?"
  - [ ] "What does your business sell?"
  - [ ] "Who usually buys it?"
  - [ ] "Would you be willing to try it?"
- [ ] Zeya should NOT ask:
  - [ ] "What are you looking for?"
  - [ ] "What challenges are you facing?"
  - [ ] "Can you tell me more?"
  - [ ] "Why?" or "How?"
  - [ ] Any follow-up questions
- [ ] ✅ Pass: Only 4 questions asked

**Test 7.2: No Consulting Behaviors**
- [ ] Zeya should NOT:
  - [ ] Offer advice
  - [ ] Coach or mentor
  - [ ] Explore the business
  - [ ] Diagnose problems
  - [ ] Suggest solutions
  - [ ] Add words to the script
  - [ ] Ask compound questions
  - [ ] Qualify the opportunity
- [ ] Record: All Zeya's utterances
- [ ] Verify: No consulting language present
- [ ] ✅ Pass: Zero consulting behavior

**Test 7.3: Deterministic Behavior**
- [ ] Run conversation 5 times with different visitors
- [ ] Expected: Identical Zeya responses in each run
- [ ] Each visitor hears the exact same 4 questions
- [ ] No variation based on visitor response
- [ ] ✅ Pass: Deterministic confirmed

---

### Phase 8: Voice Quality

**Test 8.1: Audio Clarity**
- [ ] Listen to Zeya's voice in each state
- [ ] Check: No audio glitches
- [ ] Check: Proper pauses between user speech and Zeya response
- [ ] Check: Questions are audible and clear
- [ ] ✅ Pass: Audio quality acceptable

**Test 8.2: User Audio Capture**
- [ ] Speak in normal voice
- [ ] Speak softly
- [ ] Speak with different accent
- [ ] Expected: All captured in transcript
- [ ] ✅ Pass: Voice capture works for different speakers

---

### Phase 9: Edge Cases

**Test 9.1: Very Long Answer**
- [ ] At question 2, give very long answer about business
- [ ] Expected: Zeya doesn't comment or explore
- [ ] Expected: Zeya proceeds to question 3
- [ ] Zeya says: "Who usually buys it?" (exactly)
- [ ] ✅ Pass: Long answer handled correctly

**Test 9.2: Very Short Answer**
- [ ] At question 1, say just: "Alex"
- [ ] Expected: Zeya uses exactly this name
- [ ] At question 2, Zeya says: "Nice to meet you, Alex. What does your business sell?"
- [ ] ✅ Pass: Short answer handled correctly

**Test 9.3: Ambiguous Yes/No**
- [ ] At experiment question, say: "I think so" or "Maybe"
- [ ] Expected: System treats as "no" (doesn't match yes patterns)
- [ ] Expected: Conversation ends with "No problem."
- [ ] ✅ Pass: Ambiguous answer defaults to no

**Test 9.4: Interruption**
- [ ] While Zeya is speaking, try to interrupt
- [ ] Expected: Zeya continues to completion
- [ ] User voice registered at the end
- [ ] ✅ Pass: Interruption handling works

**Test 9.5: Silence**
- [ ] After Zeya asks a question, don't respond for 5 seconds
- [ ] Expected: No timeout or error (VAD handles silence)
- [ ] When you do speak, it's captured
- [ ] ✅ Pass: Silence handling works

---

### Phase 10: Type Safety & Development

**Test 10.1: TypeScript Compilation**
- [ ] Run: `npm run build`
- [ ] Expected: ✓ Compiled successfully
- [ ] Expected: ✓ TypeScript passed
- [ ] ✅ Pass: No type errors

**Test 10.2: React State Tracking**
- [ ] Open DevTools → React Components
- [ ] Navigate to ExperiencePage component
- [ ] Verify state keys exist:
  - [ ] `phase: "voice_active"` or `"collecting_phone"`
  - [ ] `conversationState: "initial"` → "name_asked" → "offer_asked" → "buyer_asked" → "completed"`
  - [ ] `visitorName: "Alex"` (after first response)
- [ ] ✅ Pass: All states properly tracked

**Test 10.3: useEffect Hooks Firing**
- [ ] Open DevTools → Console
- [ ] Enable: `NEXT_PUBLIC_REALTIME_DEBUG=true` in .env.local
- [ ] Run conversation
- [ ] Look for logs showing:
  - [ ] "response.create sent" (for each question)
  - [ ] State transitions in console
- [ ] ✅ Pass: useEffect hooks firing correctly

---

## ROLLOUT STEPS

### Step 1: Pre-Deployment Testing (Current)
- [ ] Run full test checklist above
- [ ] Verify all tests pass
- [ ] Check for console errors
- [ ] Confirm TypeScript builds successfully

### Step 2: Staging Deployment
- [ ] Deploy to staging environment
- [ ] Test with 5-10 real visitors
- [ ] Collect feedback on:
  - [ ] Conversation flow feels natural
  - [ ] Name recall moment works
  - [ ] No unexpected questions
  - [ ] Phone collection smooth
- [ ] Monitor for errors or anomalies

### Step 3: Production Deployment
- [ ] Once staging confirmed stable
- [ ] Deploy to production
- [ ] Monitor: No increase in error rates
- [ ] Monitor: Dispatch creation rate normal
- [ ] Confirm: No change to other systems (monitor, workers, etc.)

### Step 4: Monitoring & Alerts
- [ ] Watch for: Error spikes in `/experience`
- [ ] Watch for: Unexpected visitor feedback
- [ ] Track: Conversion through phone collection
- [ ] Confirm: Zero consulting drift in call recordings

---

## SUCCESS CRITERIA

The implementation is successful if:

1. ✅ **All 4 questions asked in correct order**
   - Q1: "What's your name?"
   - Q2: "Nice to meet you, {name}. What does your business sell?"
   - Q3: "Who usually buys it?"
   - Q4: "Would you be willing to try an experiment?"

2. ✅ **Zero consulting questions asked**
   - No "What are you looking for?"
   - No "What challenges?"
   - No "Tell me more"
   - No follow-ups

3. ✅ **Name correctly captured and used**
   - Name extracted from first response
   - Name correctly interpolated in question 2
   - Visitor feels heard ("Nice to meet you, {their name}")

4. ✅ **State transitions deterministic**
   - Run 5 times: Same conversation each time
   - No variation in Zeya's responses
   - No model decisions visible

5. ✅ **Phone collection flows naturally**
   - If yes: Transition to phone collection
   - If no: Conversation ends gracefully
   - Visitor data correctly persisted

6. ✅ **No errors or warnings**
   - TypeScript passes
   - Console clean
   - No unhandled exceptions
   - Build succeeds

7. ✅ **Backwards compatible**
   - Dispatch creation unchanged
   - Worker brief generation unchanged
   - Monitor infrastructure unchanged
   - All other routes unaffected

---

## TROUBLESHOOTING

### Issue: Zeya Asks Extra Questions
- **Root Cause:** Model received general instructions, not per-turn questions
- **Check:** Verify sendNextQuestion() is being called
- **Fix:** Ensure getNextQuestion() returns exact line

### Issue: Name Not Used in Question 2
- **Root Cause:** Name not extracted from transcript
- **Check:** Verify setVisitorName() is called after first response
- **Fix:** Check transcript filtering in useEffect

### Issue: State Not Advancing
- **Root Cause:** userMessages filter not matching final entries
- **Check:** Verify entry.isFinal === true
- **Fix:** Ensure transcript entries have isFinal flag set

### Issue: No Transition to Phone Collection on "Yes"
- **Root Cause:** Yes/no detection not matching user response
- **Check:** Verify answer string matching patterns
- **Fix:** Test with different yes/no variations

### Issue: Phone Number Invalid Error
- **Root Cause:** Validation requires '+' prefix
- **Check:** Ensure user provides international format (+1...)
- **Fix:** Ask user to provide number with country code

---

## ROLLBACK PLAN

If issues are found:

1. **Immediate:** Revert code changes to experience/page.tsx
2. **Fallback:** Previous state machine prompt will be restored
3. **Impact:** ~3 minutes of visitor interruption while deploying revert
4. **Recovery:** All visitor data prior to revert still persisted

Changes are small and isolated, making rollback quick and safe.

---

## DOCUMENTATION SUMMARY

| Document | Purpose |
|----------|---------|
| **DETERMINISTIC_STATE_MACHINE_IMPLEMENTATION.md** | Complete architectural guide |
| **CODE_CHANGES_REFERENCE.md** | Line-by-line code changes |
| **IMPLEMENTATION_SUMMARY.md** | High-level overview |
| **DETERMINISTIC_STATE_MACHINE_TESTING.md** | This file — testing checklist |

---

## NEXT STEPS

1. ✅ **Code changes complete**
2. ✅ **Build successful**
3. ⏳ **Run full test checklist** ← You are here
4. ⏳ **Staging deployment**
5. ⏳ **Production deployment**
6. ⏳ **Monitor for drift**

The deterministic state machine is ready for testing.
