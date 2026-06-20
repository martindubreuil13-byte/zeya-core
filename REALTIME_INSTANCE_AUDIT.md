# OpenAI Realtime Instance Audit Report

**Date:** 2026-06-20  
**Status:** Instrumentation Complete  
**Build:** ✅ Successful (no TypeScript errors)

## Mission

Identify why Beat 1 is not producing audio by auditing the OpenAI Realtime connection path.

## Audit Findings

### Instance Lifecycle Tracking

Added unique instance IDs to every OpenAIRealtimeClient instance:

```
Static Counter: OpenAIRealtimeClient.instanceCounter (incremented on each constructor call)
Instance ID Format: OpenAIRealtimeClient-{number}
```

### Evidence Collection Points

#### 1. Instance Creation
**File:** `lib/realtime/openai-realtime-client.ts:57-66`

```
Constructor logs:
[INSTANCE] Constructor called
  - instanceId: OpenAIRealtimeClient-N
  - instanceCounter: N
  - timestamp: ...
```

**Expected:** ONE instance created when useRealtimeOnboardingSession hook mounts

#### 2. Connection Establishment
**File:** `lib/realtime/openai-realtime-client.ts:71-77`

```
connect() logs:
[INSTANCE] connect() called
  - instanceId: OpenAIRealtimeClient-N
  - hasInitialInstructions: false
  - timestamp: ...
```

**Expected:** Called once per experience start

#### 3. Connected Flag Set
**File:** `lib/realtime/openai-realtime-client.ts:144-154`

```
connected=true logs:
[CONNECTION] connected=true
  - instanceId: OpenAIRealtimeClient-N
  - timestamp: ...
```

**Expected:** Fires when WebRTC peer connection state becomes "connected"

#### 4. Data Channel Lifecycle
**File:** `lib/realtime/openai-realtime-client.ts:184-187, 379-404`

```
Creation:
[CONNECTION] Data channel created
  - instanceId: OpenAIRealtimeClient-N
  - timestamp: ...

Opening:
[CONNECTION] data channel opened
  - instanceId: OpenAIRealtimeClient-N
  - timestamp: ...
  - connected: true|false
  - pendingEventCount: N
```

**Expected:** DataChannel opens AFTER setRemoteDescription() completes

#### 5. Audio Synthesis Request
**File:** `lib/realtime/openai-realtime-client.ts:271-346`

```
speakExact() logs:
[VOICE] speakExact() called
  - instanceId: OpenAIRealtimeClient-N
  - connected: true|false
  - dataChannelState: open|connecting|closing|closed|undefined
  - textLength: N

[VOICE] Sending conversation.item.create event
[VOICE] Sending response.create event (synthesis)
```

**Expected:** Called by BeatController.startBeat() → onBeatStart callback

#### 6. Event Transmission
**File:** `lib/realtime/openai-realtime-client.ts:440-464`

```
sendEvent() logs:
[VOICE] sendEvent()
  - instanceId: OpenAIRealtimeClient-N
  - type: conversation.item.create|response.create
  - dataChannelState: open|connecting|closing|closed|undefined

When queued (dataChannel not open):
[VOICE] Data channel not open, queuing event
  - pendingEventCount: N

When flushed (on dataChannel.onopen):
[VOICE] Flushing pending events
  - count: N
```

**Expected:** Events queued if dataChannel not open, flushed when it opens

#### 7. Audio Track Reception
**File:** `lib/realtime/openai-realtime-client.ts:104-130`

```
[VOICE] Audio track received from Realtime
[VOICE] Calling audioElement.play()
[VOICE] Audio playback started
```

**Expected:** Fires when OpenAI sends audio via WebRTC

#### 8. Beat Controller Flow
**File:** `lib/experience/beat-controller.ts:44-80, 204-246`

```
startBeat() logs:
[BEAT] startBeat() called
  - currentBeat: greeting
  - hasOnBeatStartCallback: true
  - timestamp: ...

[BEAT] Beat config found
  - beat: greeting

[BEAT] Script generated
  - scriptLength: N
  - firstChars: "Hi, I'm Zeya..."

[BEAT] About to call onBeatStart callback

advanceBeat() logs:
[BEAT] advanceBeat() called
  - currentBeat: greeting
  - extractedValue: null
  - timestamp: ...

[BEAT] Moving to next beat
  - nextBeat: product
```

### Critical Dependencies

**Hook:** `hooks/realtime/useRealtimeOnboardingSession.ts`

- **Client Creation:** useEffect with dependency `[appendTranscript]`
  - appendTranscript is useCallback with empty dependency array `[]`
  - Result: Client created ONCE, stable instance throughout session

- **Client Storage:** `clientRef.current`
  - Same instance used for startConversation, stopConversation, speakExact

- **Callbacks:** All use `clientRef.current?.method()`
  - Result: All operations on same instance ✅

### Question: Are All Operations on Same Instance?

**Architecture Answer: YES**

```
useRealtimeOnboardingSession() {
  const clientRef = useRef<OpenAIRealtimeClient | null>(null);
  
  useEffect(() => {
    const client = new OpenAIRealtimeClient(...);
    clientRef.current = client;  // Store once
    // ...
  }, [appendTranscript]); // Stable, won't recreate
  
  const startConversation = () => {
    await clientRef.current?.connect();  // Same instance
  };
  
  const speakExact = (text) => {
    clientRef.current?.speakExact(text);  // Same instance
  };
}
```

**Proof:** Instance IDs will show OpenAIRealtimeClient-1 throughout

## Timing Analysis

### Expected Timeline (milliseconds after page load)

```
T+0ms    → User clicks "Start"
T+50ms   → [INSTANCE] Constructor called
T+100ms  → [INSTANCE] connect() called
T+150ms  → [CONNECTION] Requesting microphone access
T+200ms  → [CONNECTION] Microphone access granted
T+250ms  → [CONNECTION] Data channel created
T+300ms  → [CONNECTION] Setting remote SDP
T+400ms  → [CONNECTION] pc.onconnectionstatechange fired
T+450ms  → [CONNECTION] connected=true
T+500ms  → [CONNECTION] data channel opened
T+550ms  → [BEAT] startBeat() called
T+600ms  → [BEAT] About to call onBeatStart callback
T+650ms  → [VOICE] speakExact() called
T+700ms  → [VOICE] Sending conversation.item.create event
T+750ms  → [VOICE] Sending response.create event
T+1000ms → [VOICE] Audio track received from Realtime
T+1050ms → [VOICE] Audio playback started
T+3000ms → [VOICE] Audio playback finished
```

## Diagnostic Guide

### If Beat 1 doesn't speak:

1. **No "[INSTANCE] Constructor called"**
   - Issue: Hook not mounted or component not rendered
   - Check: Is the page loading? Is authentication working?

2. **No "[INSTANCE] connect() called"**
   - Issue: startConversation() not being invoked
   - Check: Is the "Start" button firing handleStartExperience?

3. **No "[CONNECTION] connected=true"**
   - Issue: WebRTC connection failed
   - Check: Browser console for connection errors
   - Check: API key valid? Network connectivity?

4. **No "[CONNECTION] data channel opened"**
   - Issue: Data channel failed to open
   - Check: Timing - should open 50-100ms after connection
   - Check: Browser console for WebRTC errors

5. **No "[VOICE] speakExact() called"**
   - Issue: BeatController.startBeat() not calling callback
   - Check: Is onBeatStart callback properly wired?
   - Check: Is beat config found?

6. **"[VOICE] speakExact() called" but dataChannelState != "open"**
   - Issue: Race condition - speakExact called before dataChannel opens
   - Check: Events queued (pendingEventCount > 0)?
   - Check: Are they flushed when dataChannel opens?

7. **Events queued but not flushed**
   - Issue: dataChannel.onopen not called
   - Check: Browser console for WebRTC errors
   - Check: Timing - is dataChannel staying in "connecting" state?

8. **No "[VOICE] Audio track received from Realtime"**
   - Issue: OpenAI not sending audio
   - Check: Browser console for API errors
   - Check: response.create event structure valid?
   - Check: conversation.item.create event was received?

9. **Audio track received but no playback**
   - Issue: Autoplay policy or audio element issue
   - Check: Browser autoplay permissions
   - Check: audioElement.play() error in console
   - Check: System volume muted?

## Code Changes Made

### 1. OpenAIRealtimeClient Instance Tracking
- Added `static instanceCounter` to track total instances
- Added `instanceId` property to each instance
- Log instanceId in constructor, connect(), speakExact(), all event handlers

### 2. Connection Flow Logging
- Log when data channel is created
- Log when data channel opens/closes/errors with pending event count
- Log connection state transitions with instance ID
- Log final state after connect() completes

### 3. Audio Synthesis Logging
- Log speakExact() called with detailed state
- Log conversation.item.create and response.create events
- Track event queuing vs. immediate sending
- Log event flushing with event types

### 4. Microphone Access Logging
- Log microphone permission request with instanceId
- Log when access granted and track count
- Log each audio track being added to peer connection

### 5. BeatController Logging
- Log startBeat() called with beat and callback status
- Log advanceBeat() with extracted value and next beat
- Track callback execution and return times

## Next Steps for Testing

1. **Local Testing:**
   - Run `npm run dev`
   - Open browser DevTools console
   - Navigate to /experience
   - Click "Start" button
   - Watch for instance tracking logs
   - Verify all instance IDs match (should be OpenAIRealtimeClient-1)
   - Listen for audio from Beat 1 greeting

2. **Verify Timing:**
   - Check if data channel opens before speakExact is called
   - If not, verify events are queued and flushed
   - Look for connection lag or WebRTC errors

3. **Check for Errors:**
   - Look for "[ERROR]" logs
   - Check for microphone permission denial
   - Check for API errors from OpenAI
   - Check for autoplay policy violations

## Build Status

✅ **Build Successful**
```
✓ Compiled successfully in 4.5s
✓ Running TypeScript: PASSED
✓ Generating static pages: PASSED (47/47)
```

All changes compile without errors or warnings.

## Summary

**Architecture:** ✅ Correct
- Single OpenAIRealtimeClient instance per session
- Same instance handles connection and audio synthesis
- BeatController properly integrated

**Instrumentation:** ✅ Complete
- Comprehensive instance tracking implemented
- Full logging of connection lifecycle
- Event transmission tracking
- Audio synthesis request logging

**Remaining:** 🧪 Testing
- Need to run app in browser with audio
- Observe logs to identify any issues
- Listen for Beat 1 audio output

The foundation is in place. The next step is to actually test Beat 1 and use the logs to diagnose any remaining issues.
