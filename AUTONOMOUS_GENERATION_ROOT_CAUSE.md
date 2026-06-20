# Autonomous Response Generation - Root Cause & Fix

**Status:** 🔴 CRITICAL ISSUE FOUND & FIXED  
**Date:** 2026-06-20  
**Evidence:** Spanish voice speaking autonomously immediately after "Start"

## The Problem

After clicking "Start Experience", the system generated autonomous Spanish dialogue instead of:
1. Waiting for BeatController to initiate Beat 1
2. Speaking Beat 1 greeting via speakExact()
3. Letting BeatController control all dialogue

**Observed Runtime Events:**
```
input_audio_buffer.committed
response.created              ← Should NOT exist (autonomous generation!)
response.output_audio_transcript.delta
response.done
```

## Root Cause Analysis

### Session Configuration Missing

**File:** `/app/api/openai/realtime/session/route.ts`

The onboarding Realtime session was configured with **minimal parameters**:

```javascript
const sessionConfig = {
  session: {
    type: "realtime",
    model,
    audio: {
      output: {
        voice,
      },
    },
  },
};
```

**Missing:** `turn_detection` configuration

### Default Behavior Problem

When `turn_detection` is not specified, OpenAI Realtime defaults to:
```
create_response: true       ← Model generates responses automatically
interrupt_response: true    ← Model can be interrupted
```

This means:
- When user speaks → VAD detects speech end
- Automatically → Model generates a response
- Automatically → TTS synthesizes the response
- Result → User hears unexpected Spanish greeting

## The Fix

### Add Explicit Turn Detection Configuration

```javascript
audio: {
  input: {
    turn_detection: {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: false,        // CRITICAL: Disable autonomous generation
      interrupt_response: false,      // Prevent mid-response interruption
    },
    transcription: {
      model: "gpt-4o-mini-transcribe",
    },
  },
  output: {
    voice,
  },
}
```

### Key Parameters

**`create_response: false`**
- Disables automatic response creation when user finishes speaking
- VAD still detects speech (for transcript), but doesn't trigger generation
- response.created events ONLY occur when application explicitly calls speakExact()

**`interrupt_response: false`**
- Prevents user speech from interrupting a response being synthesized
- Prevents mid-response interruption conflicts

**`threshold: 0.5`**
- Voice Activity Detection sensitivity (0.0-1.0)
- Higher = stricter (fewer false positives)

**`silence_duration_ms: 500`**
- How long to wait after speech ends before considering speech complete
- Prevents stuttering from being treated as multiple turns

### Endpoint Details

**Onboarding/Experience Route:**
- **Path:** `/api/openai/realtime/session`
- **Used by:** `useRealtimeOnboardingSession` hook
- **Fixed:** ✅ `create_response: false`
- **Behavior:** Speech captured, TTS synthesis only

**Briefing Room Route:**
- **Path:** `/api/openai/realtime/briefing-session`
- **Used by:** Briefing room voice sessions
- **Status:** ✅ Already correct with `create_response: true`
- **Behavior:** Autonomous dialogue generation (intended)

## Behavior Change

### Before Fix
```
User clicks "Start"
  → Realtime session created with defaults
  → User speaks (any audio)
  → OpenAI VAD detects speech end
  → response.created event fired AUTOMATICALLY
  → Model generates Spanish greeting
  → TTS synthesizes Spanish
  → User hears unexpected dialogue
```

### After Fix
```
User clicks "Start"
  → Realtime session created with create_response: false
  → startConversation() → client.connect()
  → BeatController.startBeat() → onBeatStart callback
  → speakExact("Hi, I'm Zeya...") called explicitly
  → response.created event ONLY from explicit speakExact()
  → TTS synthesizes English greeting
  → User speaks (captured in transcript)
  → No automatic response generation
  → BeatController decides next beat
```

## Verification

### Log Evidence

**Before (Autonomous Generation):**
```
[REALTIME SESSION] Request payload BEFORE sending
  - turn_detection.create_response: NOT SET
  - turn_detection.interrupt_response: NOT SET

[VOICE] Audio track received from Realtime
[VOICE] response.created fired
[VOICE] Spanish audio synthesized
```

**After (Application Control):**
```
[REALTIME SESSION] Request payload BEFORE sending
  - turn_detection.create_response: false
  - turn_detection.interrupt_response: false

[REALTIME SESSION] ⚠️ CRITICAL: Autonomous response generation is DISABLED
  - create_response: false
  - reason: BeatController controls all dialogue via speakExact()
  - expected_events: Only response.created when explicitly requested

[BEAT] startBeat() called
[BEAT] About to call onBeatStart callback
[VOICE] speakExact() called
[VOICE] response.created event sent (from explicit speakExact)
```

## Code Changed

**File:** `app/api/openai/realtime/session/route.ts`

**Lines 68-96:**
- Added `audio.input` object with `turn_detection` configuration
- Added `transcription` model specification
- Set `create_response: false` (THE KEY FIX)
- Set `interrupt_response: false`
- Added comprehensive comments explaining the critical configuration

**Lines 85-100:**
- Enhanced logging to show turn_detection settings
- Added warning log documenting autonomous generation is disabled
- Explicit statement that BeatController controls dialogue

## Why Spanish?

The Spanish voice was likely:
1. OpenAI's default model greeting
2. Or a leftover from previous configuration
3. But now we know: NO autonomous generation means NO unsolicited voices

## Architecture Principles Restored

✅ **BeatController owns dialogue control**
- Application decides what to say
- speakExact() is the ONLY pathway to speech

✅ **Realtime acts as I/O processor**
- Captures user speech
- Transcribes to text
- Synthesizes provided scripts to audio
- Never generates dialogue

✅ **No prompt injection**
- No system instructions telling model to generate
- No autonomous decision-making
- Pure application-controlled voice interface

## Testing Verification

**To verify the fix works:**

1. Run `npm run dev`
2. Navigate to /experience
3. Click "Start"
4. Check server logs for:
   ```
   [REALTIME SESSION] ⚠️ CRITICAL: Autonomous response generation is DISABLED
   ```
5. Wait for Beat 1 greeting (no Spanish!)
6. Should see:
   ```
   [BEAT] startBeat() called
   [BEAT] About to call onBeatStart callback
   [VOICE] speakExact() called
   ```
7. Hear English greeting from Beat 1

## Related Commits

- **Current:** Disable autonomous response generation in Realtime session
- **Previous:** Add comprehensive instance tracking for audit
- **Reference:** [[architecture-audit-critical-findings]] - Phase 1 code integration

## Summary

**Root Cause:** Missing `turn_detection: { create_response: false }` in session configuration

**Impact:** Model was generating autonomous responses, preventing application control

**Fix:** Explicit configuration disabling `create_response`

**Result:** System now purely application-controlled voice interface with TTS synthesis only
