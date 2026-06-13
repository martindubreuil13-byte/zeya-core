# OpenAI Realtime API - Implementation Roadmap

**Status:** Ready for Implementation  
**Total Recommended Time:** ~1 hour  
**Risk Level:** Very Low  
**Files to Modify:** 2 critical + 2 optional

---

## Phase 1: Voice Quality Upgrade (PRIORITY)

**Objective:** Improve audio response quality from `sage` to `marin`  
**Time:** 15 minutes  
**Risk:** Very Low  
**Impact:** Medium (better demos, higher engagement)

### Change 1.1: Update Session Endpoint Default

**File:** `app/api/openai/realtime/session/route.ts`

**Current (Line 6):**
```typescript
const DEFAULT_REALTIME_VOICE = "sage";
```

**Change to:**
```typescript
const DEFAULT_REALTIME_VOICE = "marin";
```

**Why:** 
- OpenAI SDK documentation recommends `marin` and `cedar` for best quality
- `sage` is older; `marin` provides warmer, more engaging tone
- No breaking changes—still one of the valid voice options

### Change 1.2: Update Briefing Session Endpoint

**File:** `app/api/openai/realtime/briefing-session/route.ts`

**Current (find the line with `voice: "sage"`):**
```typescript
audio: {
  output: {
    voice: "sage",
  },
},
```

**Change to:**
```typescript
audio: {
  output: {
    voice: "marin",
  },
},
```

**Why:** Consistency with primary session endpoint and quality improvement

### Change 1.3: Update Environment Variable (Optional)

**File:** `.env.example` (for documentation)

Add or update:
```bash
# Voice for Realtime API responses
# Options: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
# Recommended: marin or cedar
OPENAI_REALTIME_VOICE=marin
```

**File:** `.env.local` (if not already set)

Verify or add:
```bash
OPENAI_REALTIME_VOICE=marin
```

### Verification for Phase 1

After making changes:

```bash
# 1. Verify compilation
npm run build

# Expected output:
# ✓ Compiled successfully

# 2. Start dev server
npm run dev

# Expected output:
# [REALTIME STARTUP] API Key loaded: sk-proj-****...****
# [REALTIME STARTUP] Realtime configuration: model=gpt-realtime, voice=marin

# 3. Test in browser
# Open: http://localhost:3000/experience
# Click: "See how"
# → Should hear "marin" voice (warmer tone than "sage")

# 4. Check logs for:
# [REALTIME SESSION] ✅ SESSION_CREATED {
#   model: 'gpt-realtime',
#   voice: 'marin',     ← Should show 'marin' not 'sage'
#   secretLength: 132
# }
```

**Pass/Fail:**
- ✅ PASS: Logs show `voice: 'marin'`, demos sound better
- ❌ FAIL: Logs show `voice: 'sage'`, check files were edited
- ❌ FAIL: HTTP 400 from OpenAI, verify voice name is spelled correctly

---

## Phase 2: VAD Threshold Review (OPTIONAL)

**Objective:** Review and potentially adjust voice activity detection sensitivity  
**Time:** 10 minutes  
**Risk:** Low  
**Impact:** Affects conversation responsiveness

### Analysis: Current vs. Recommended

**File:** `app/api/openai/realtime/briefing-session/route.ts`

**Current Configuration:**
```typescript
turn_detection: {
  type: "server_vad",
  threshold: 0.35,           // ← REVIEW THIS
  prefix_padding_ms: 500,
  silence_duration_ms: 400,
  create_response: true,
  interrupt_response: true,
}
```

**OpenAI Specification:**
- Valid range: 0.0 to 1.0
- Default: 0.5
- Lower values (0.35): More sensitive, triggers faster
- Higher values (0.75+): Less sensitive, waits longer for clear speech

**Current Setting (0.35) Characteristics:**
- ✅ Faster turn detection
- ✅ Responsive to quick utterances
- ⚠️ May trigger on background noise
- ⚠️ May interrupt natural speech pauses

**Recommendation:**
Change to OpenAI default (0.5) unless current behavior is working well.

### Change 2.1: Update VAD Threshold (Optional)

**Only if** you observe:
- False positives (system responds when user is silent)
- Interruptions of natural speech pauses

**Change from:**
```typescript
threshold: 0.35,
```

**Change to:**
```typescript
threshold: 0.5,  // OpenAI specification default
```

### Testing Phase 2

```bash
# 1. Start dev server with new threshold
npm run dev

# 2. Test onboarding conversation
# Open: http://localhost:3000/onboarding (or wherever briefing is tested)
# Test these scenarios:
#   a) Quick question: "What's the weather?"
#      → Should respond immediately
#   b) Natural pause: "What's the... weather?"
#      → Should NOT respond early
#   c) Background noise: Play music, then speak
#      → Should NOT respond to noise alone

# 3. Expected behavior with 0.5 threshold:
#    - More conservative speech detection
#    - Slightly longer latency (50-100ms more)
#    - Fewer false positives
#    - Natural speech pauses don't trigger early responses
```

**Decision Matrix:**

| Scenario | 0.35 (Current) | 0.5 (Recommended) | Action |
|----------|---|---|---|
| Quick speech recognized | ✅ Fast | ✅ Slightly delayed | OK |
| Natural pause handled | ⚠️ May interrupt | ✅ Waits | UPGRADE |
| Background noise filtered | ⚠️ Some false positives | ✅ Better | UPGRADE |
| User preference | ? | ? | TEST & DECIDE |

**Recommendation:**
- If no issues observed: Keep current (0.35) - it's working
- If false positives happen: Change to 0.5
- Never go below 0.3 or above 0.7 without specific reason

---

## Phase 3: Error Handling Enhancement (NEXT RELEASE)

**Objective:** Add granular error event handling for better debugging  
**Time:** 30 minutes  
**Risk:** Very Low  
**Impact:** High (debugging), Medium (user-facing messages)

### Analysis: Current Error Handling

**File:** `lib/realtime/openai-realtime-client.ts`

**Current State:**
- Generic error logging
- Limited distinction between error types
- Hard to debug specific failure modes

### Change 3.1: Add Error Event Handler

**Location:** In `lib/realtime/openai-realtime-client.ts` event handlers

**Add after existing event listeners:**

```typescript
// Error event handling
dataChannel.addEventListener('error', (event: any) => {
  const errorEvent = event.error || event;
  serverLog('❌ WEBRTC_ERROR', {
    type: errorEvent.type,
    message: errorEvent.message,
    code: errorEvent.code,
  });
});

// Listen for specific server errors via WebSocket
// (Add to the main event listener switch statement)

const handleMessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data);
    
    if (message.type === 'error') {
      serverLog('❌ SERVER_ERROR', {
        error_type: message.error?.type,
        error_code: message.error?.code,
        error_message: message.error?.message,
        event_id: message.event_id,
      });
      // Re-emit for React components to handle
      onError?.(message.error);
    }
    
    // ... rest of message handling
  } catch (e) {
    serverLog('❌ PARSE_ERROR', { error: e instanceof Error ? e.message : String(e) });
  }
};
```

### Change 3.2: Add Specific Error Types

**Create or update:** `lib/realtime/realtime-errors.ts`

```typescript
export type RealtimeErrorType = 
  | 'vad_error'
  | 'transcription_error'
  | 'response_error'
  | 'audio_error'
  | 'connection_error'
  | 'timeout_error'
  | 'unknown_error';

export interface RealtimeError {
  type: RealtimeErrorType;
  message: string;
  originalError?: any;
  timestamp: number;
}

export const createRealtimeError = (
  type: RealtimeErrorType,
  message: string,
  originalError?: any
): RealtimeError => ({
  type,
  message,
  originalError,
  timestamp: Date.now(),
});
```

### Change 3.3: Map Events to Error Categories

**In event handler:**

```typescript
switch (message.type) {
  case 'conversation.item.input_audio_transcription.failed':
    onError?.(createRealtimeError(
      'transcription_error',
      'Failed to transcribe user audio',
      message.error
    ));
    break;
    
  case 'input_audio_buffer.timeout_triggered':
    onError?.(createRealtimeError(
      'timeout_error',
      'No speech detected for 30+ seconds'
    ));
    break;
    
  case 'response.done':
    if (message.response?.status === 'failed') {
      const reason = message.response?.status_details?.reason;
      onError?.(createRealtimeError(
        'response_error',
        `Response generation failed: ${reason}`
      ));
    }
    break;
}
```

### Testing Phase 3

```bash
# 1. Trigger each error type
#    a) Transcription error: Corrupted audio input
#    b) Timeout error: Don't speak for 30+ seconds
#    c) Response error: Invalid instructions or max tokens
#    d) Connection error: Network disconnect

# 2. Verify logs show specific error details
# Expected output:
# ❌ SERVER_ERROR { 
#   error_type: 'server_error',
#   error_message: 'Specific reason...',
#   event_id: 'evt_xyz'
# }

# 3. Verify user can understand what went wrong
# Each error should have a user-friendly message
```

---

## Phase 4: Optional Enhancements (BACKLOG)

### 4.1: Add Output Modalities Configuration

**Time:** 5 minutes | **Effort:** Very Low | **Impact:** Future-proofing

**File:** `app/api/openai/realtime/session/route.ts`

**Add to session config:**
```typescript
const sessionConfig = {
  session: {
    model,
    audio: {
      output: {
        voice: "marin",
      },
    },
    // Optional: Explicit modalities (defaults to ["audio"])
    // output_modalities: ["audio"],
  },
};
```

**Comment out for now since audio-only is correct for current use case.**

---

### 4.2: Consider Transcription Model Upgrade

**Time:** 10 minutes + testing | **Effort:** Low | **Impact:** Medium (accuracy)

**File:** `app/api/openai/realtime/briefing-session/route.ts`

**Current:**
```typescript
transcription: { model: "gpt-4o-mini-transcribe" }
```

**Options:**
- `gpt-4o-mini-transcribe` (current) — Fast, low cost
- `gpt-realtime-whisper` — Optimized for realtime, recommended
- `whisper-1` — Legacy, avoid

**Recommendation:**
Test `gpt-realtime-whisper` in staging:

```typescript
transcription: { 
  model: "gpt-realtime-whisper",  // Try this
  // or
  model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
}
```

**Add to .env.example:**
```bash
# Transcription model for realtime sessions
# Options: gpt-4o-mini-transcribe, gpt-realtime-whisper
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

---

### 4.3: Add Noise Reduction Support

**Time:** 15 minutes | **Effort:** Low | **Impact:** Medium (audio quality)

**File:** `app/api/openai/realtime/briefing-session/route.ts`

**Add to audio.input:**
```typescript
audio: {
  input: {
    // ... existing turn_detection and transcription ...
    
    // Optional noise reduction for far-field microphones
    // noise_reduction: { type: "far_field" },  // or "near_field"
  },
  // ...
}
```

**Recommendation:** Comment out for now unless users report background noise issues.

---

### 4.4: Add Response Cancellation Support

**Time:** 20 minutes | **Effort:** Medium | **Impact:** Medium (user experience)

**File:** `lib/realtime/openai-realtime-client.ts`

**Add method:**
```typescript
cancelResponse(responseId: string): void {
  if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
    console.error('Cannot cancel: data channel not open');
    return;
  }
  
  this.dataChannel.send(JSON.stringify({
    type: 'response.cancel',
    response_id: responseId,
  }));
  
  serverLog('Response cancelled', { responseId });
}
```

**Use case:** User wants to interrupt Zeya mid-response (e.g., "Never mind, stop").

---

## Implementation Sequence (Recommended Order)

```
Week 1 (Priority)
├─ Phase 1: Voice Quality Upgrade (15 min)
│  └─ Change "sage" → "marin" in both endpoints
│
├─ Phase 2: VAD Threshold Review (10 min)
│  └─ Test current behavior, decide if change needed
│
└─ TESTING & DEPLOYMENT
   └─ Run full onboarding flow test
   └─ Verify in production

Week 2 (Next Release)
├─ Phase 3: Error Handling (30 min)
│  └─ Add granular error logging
│  └─ Create error type system
│
└─ TESTING
   └─ Trigger each error scenario
   └─ Verify logging clarity

Backlog (As Needed)
├─ Phase 4.1: Output Modalities (5 min)
├─ Phase 4.2: Transcription Model (10 min)
├─ Phase 4.3: Noise Reduction (15 min)
└─ Phase 4.4: Response Cancellation (20 min)
```

---

## Git Commit Strategy

### Commit 1: Voice Quality Upgrade
```bash
git add app/api/openai/realtime/session/route.ts
git add app/api/openai/realtime/briefing-session/route.ts
git commit -m "Upgrade Realtime API voice from sage to marin for better quality"
```

### Commit 2: VAD Configuration (if changed)
```bash
git add app/api/openai/realtime/briefing-session/route.ts
git commit -m "Adjust VAD threshold to OpenAI spec default (0.5)"
```

### Commit 3: Error Handling (next release)
```bash
git add lib/realtime/openai-realtime-client.ts
git add lib/realtime/realtime-errors.ts
git commit -m "Add granular error handling for realtime API events"
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All TypeScript compilation succeeds
- [ ] No linting errors
- [ ] All changes committed
- [ ] Code review completed (if applicable)

### Testing
- [ ] Dev server starts cleanly
- [ ] Session creation returns 200 OK
- [ ] Ephemeral token successfully extracted
- [ ] WebRTC connection established
- [ ] Microphone input accepted
- [ ] Speaker output plays
- [ ] Full onboarding flow works end-to-end
- [ ] Error scenarios tested

### Deployment
- [ ] Feature merged to main
- [ ] CI pipeline passes
- [ ] Deploy to staging
- [ ] Smoke test in staging
- [ ] Deploy to production
- [ ] Monitor logs for any errors

### Post-Deployment
- [ ] Check OpenAI API logs for rate limits
- [ ] Verify session creation latency
- [ ] Monitor for any user reports
- [ ] Check voice quality feedback from users

---

## Rollback Plan

If any issues arise:

```bash
# Quick rollback to previous voice
git revert <commit-hash>
git push

# Or manual revert:
# Change "marin" back to "sage" in both files
# Commit and push
```

**Estimated rollback time:** < 5 minutes

---

## Success Indicators

✅ **Phase 1 Success:**
- Logs show `voice: 'marin'`
- Demo calls sound noticeably better
- No errors in session creation
- Zero user complaints about voice quality

✅ **Phase 2 Success:**
- VAD responds appropriately to speech
- No false positives from background noise
- Natural speech pauses don't trigger early responses
- User feedback indicates good responsiveness

✅ **Phase 3 Success:**
- Clear error messages in logs
- Each error type distinctly identified
- Easier to debug issues
- User-facing error messages are helpful

---

## Timeline & Estimate

| Phase | Tasks | Time | Risk | Status |
|-------|-------|------|------|--------|
| **1** | Voice upgrade | 15 min | Very Low | 🟢 READY |
| **2** | VAD review | 10 min | Low | 🟡 OPTIONAL |
| **3** | Error handling | 30 min | Very Low | 🟡 DEFER |
| **4** | Enhancements | Variable | Low | 🟢 BACKLOG |
| **TOTAL** | All priorities | ~1 hour | **Very Low** | ✅ |

---

## Questions & Answers

**Q: Will changing voices break anything?**  
A: No. All voice options are compatible with the same endpoints. It's just a configuration change.

**Q: Should I change the VAD threshold?**  
A: Only if you test it first and find issues with current behavior (0.35). If working well, leave it.

**Q: When should I add error handling?**  
A: In the next release. Current error logging is adequate for MVP.

**Q: Are there any breaking changes?**  
A: No. All changes are backward-compatible and non-breaking.

**Q: Will this affect OpenAI costs?**  
A: Negligibly. Voice selection doesn't change pricing. Error handling might reduce failed attempts (saving money).

---

## Related Documentation

- **REALTIME_API_AUDIT.md** — Detailed audit of current implementation
- **GAP_ANALYSIS.md** — Complete gap analysis with priority matrix  
- **SEQUENCE_FLOW.md** — Sequence diagrams and flow documentation

---

Last updated: 2026-06-13  
Status: Ready for Implementation ✅
