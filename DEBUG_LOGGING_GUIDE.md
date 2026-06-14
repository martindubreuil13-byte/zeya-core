# Debug Logging Guide: Experience Engine Execution Trace

**All logs are console.log statements.**  
**Open browser DevTools console (F12) to see them in real-time.**

---

## EXPECTED LOG SEQUENCE

If the Experience Engine works correctly, you should see logs in this exact order:

```
[EXPERIENCE] Start button clicked
[EXPERIENCE] Initializing session
[EXPERIENCE] Creating BeatController
[EXPERIENCE] BeatController created
[EXPERIENCE] Calling controller.startBeat()
[BEAT] startBeat() called {currentBeat: "greeting"}
[BEAT] Beat config found {beat: "greeting"}
[BEAT] Script generated {beat: "greeting", scriptLength: X, firstChars: "Hi, I'm..."}
[BEAT] Calling onBeatStart callback
[BEAT] onBeatStart() called {beat: "greeting", scriptLength: X}
[BEAT] onBeatStart() calling speakExact()
[HOOK] speakExact() callback called {textLength: X, clientExists: true}
[HOOK] Calling client.speakExact()
[VOICE] speakExact() called {textLength: X, connected: true, dataChannelReady: true}
[VOICE] Sending conversation.item.create event
[VOICE] conversation.item.create event sent
[VOICE] Sending response.create event (synthesis)
[VOICE] response.create event sent
[HOOK] client.speakExact() returned
[VOICE] sendEvent() {type: "conversation.item.create", dataChannelReady: true}
[VOICE] Sending event immediately via WebSocket {type: "conversation.item.create"}
[VOICE] sendEvent() {type: "response.create", dataChannelReady: true}
[VOICE] Sending event immediately via WebSocket {type: "response.create"}
[BEAT] onBeatStart() speakExact() returned
[BEAT] Calling onBeatStart callback returned
[EXPERIENCE] controller.startBeat() returned
[VOICE] Audio track received from Realtime
[VOICE] Calling audioElement.play()
[VOICE] Audio playback started
(Zeya speaks: "Hi, I'm Zeya...")
[VOICE] Audio playback finished
```

---

## HOW TO USE THIS GUIDE

1. **Open browser DevTools:** F12 or Cmd+Option+I
2. **Go to Console tab**
3. **Click "Start Experience" button**
4. **Watch console for logs**
5. **Find the first log that DOESN'T appear**
6. **That is the broken link**

---

## LOGS AT EACH STEP

### Step 1: Start Button Click
**Expected logs:**
```
[EXPERIENCE] Start button clicked
[EXPERIENCE] Initializing session
[EXPERIENCE] Creating BeatController
[EXPERIENCE] BeatController created
```

**If you don't see these:**
- Button click handler not firing
- Check: Is `onClick={handleStartExperience}` wired on VoiceButton?

---

### Step 2: BeatController Initialization
**Expected logs:**
```
[EXPERIENCE] Calling controller.startBeat()
```

**If you don't see this:**
- Controller creation failed silently
- Check: Is BeatController constructor accepting callbacks?

---

### Step 3: BeatController.startBeat() Execution
**Expected logs:**
```
[BEAT] startBeat() called {currentBeat: "greeting"}
[BEAT] Beat config found {beat: "greeting"}
[BEAT] Script generated {beat: "greeting", ...}
[BEAT] Calling onBeatStart callback
```

**If you don't see these:**
- startBeat() not executing
- Beat config missing
- Check: Are BEAT_SCRIPTS defined correctly?

---

### Step 4: onBeatStart Callback
**Expected logs:**
```
[BEAT] onBeatStart() called {beat: "greeting", ...}
[BEAT] onBeatStart() calling speakExact()
```

**If you don't see these:**
- Callback not wired
- Check: Is `onBeatStart: async (beat, script) => { ... }` defined in controller config?

---

### Step 5: speakExact() Call
**Expected logs:**
```
[HOOK] speakExact() callback called {textLength: X, clientExists: true}
[HOOK] Calling client.speakExact()
[VOICE] speakExact() called {textLength: X, connected: true, dataChannelReady: true}
```

**If you see `clientExists: false`:**
- Realtime client not initialized
- Realtime hook not working
- Check: Did useRealtimeOnboardingSession initialize?

**If you see `connected: false`:**
- Realtime connection not established
- Check: Did client.connect() succeed?

**If you see `dataChannelReady: false`:**
- WebSocket data channel not open
- Check: Did WebRTC setup complete?

---

### Step 6: Event Sending
**Expected logs:**
```
[VOICE] Sending conversation.item.create event
[VOICE] conversation.item.create event sent
[VOICE] Sending response.create event (synthesis)
[VOICE] response.create event sent
```

**Then:**
```
[VOICE] sendEvent() {type: "conversation.item.create", dataChannelReady: true}
[VOICE] Sending event immediately via WebSocket {type: "conversation.item.create"}
[VOICE] sendEvent() {type: "response.create", dataChannelReady: true}
[VOICE] Sending event immediately via WebSocket {type: "response.create"}
```

**If you don't see "Sending event immediately":**
- Events queued instead of sent
- Check: `dataChannelReady` value in log
- If false: data channel not open

**If you see "Data channel not open, queuing event":**
- Connection established but data channel failed
- Check: Is attachDataChannel() working?

---

### Step 7: Audio Playback
**Expected logs:**
```
[VOICE] Audio track received from Realtime
[VOICE] Calling audioElement.play()
[VOICE] Audio playback started
```

**If you don't see "Audio track received":**
- Realtime synthesizing but not sending audio
- Check: Is response.create event correct?

**If you see "Audio playback error":**
- Audio element has autoplay blocked
- Check: Browser autoplay policy
- Try: User interaction requirement

---

## CRITICAL LOG VALUES

### In speakExact():
```
[VOICE] speakExact() called {
  textLength: X,              ← Script length (should be > 0)
  connected: true,            ← CRITICAL: Must be true
  dataChannelReady: true      ← CRITICAL: Must be true
}
```

**If `connected: false`:** No Realtime connection  
**If `dataChannelReady: false`:** WebSocket not established  

### In sendEvent():
```
[VOICE] sendEvent() {
  type: "conversation.item.create",
  dataChannelReady: true      ← CRITICAL: Must be true to send
}
```

**If `dataChannelReady: false`:** Events will be queued, not sent  

---

## FINDING THE BROKEN LINK

**Algorithm:**

1. Open DevTools Console
2. Filter by "[EXPERIENCE]", "[BEAT]", "[HOOK]", "[VOICE]"
3. Click "Start Experience"
4. Scan logs from top to bottom
5. Find the first step that has NO logs
6. **That step is broken**

### Common Break Points:

**Break at:** `[EXPERIENCE] Start button clicked`  
→ Button handler not wired

**Break at:** `[BEAT] startBeat() called`  
→ handleStartExperience doesn't call controller.startBeat()

**Break at:** `[HOOK] speakExact() callback called`  
→ onBeatStart not calling speakExact

**Break at:** `[VOICE] speakExact() called {connected: false}`  
→ Realtime never connected

**Break at:** `[VOICE] speakExact() called {dataChannelReady: false}`  
→ WebRTC setup incomplete

**Break at:** `[VOICE] Sending event immediately via WebSocket`  
→ Data channel not ready when event sent

**Break at:** `[VOICE] Audio track received from Realtime`  
→ Events sent but synthesis not working

**Break at:** `[VOICE] Audio playback started`  
→ Audio received but playback blocked

---

## HOW TO SHARE LOGS

When you find the broken link:

1. **Copy the console log sequence**
2. **Note the first missing log**
3. **Report: "First missing log: [X]"**
4. **Copy all logs from [EXPERIENCE] through [first missing]**

Example report:
```
First missing log: [VOICE] speakExact() called
All logs up to that point:
[EXPERIENCE] Start button clicked
[EXPERIENCE] Initializing session
[EXPERIENCE] Creating BeatController
[EXPERIENCE] BeatController created
[EXPERIENCE] Calling controller.startBeat()
[BEAT] startBeat() called {currentBeat: "greeting"}
[BEAT] Beat config found {beat: "greeting"}
[BEAT] Script generated ...
[BEAT] Calling onBeatStart callback
[BEAT] onBeatStart() called ...
[BEAT] onBeatStart() calling speakExact()
[HOOK] speakExact() callback called {textLength: 90, clientExists: true}
[HOOK] Calling client.speakExact()
(nothing after this)
```

---

## EXPECTED FULL SEQUENCE (for reference)

Copy this and compare with what you see:

```
[EXPERIENCE] Start button clicked
[EXPERIENCE] Initializing session
[EXPERIENCE] Creating BeatController
[EXPERIENCE] BeatController created
[EXPERIENCE] Calling controller.startBeat()
[BEAT] startBeat() called
[BEAT] Beat config found
[BEAT] Script generated
[BEAT] Calling onBeatStart callback
[BEAT] onBeatStart() called
[BEAT] onBeatStart() calling speakExact()
[HOOK] speakExact() callback called
[HOOK] Calling client.speakExact()
[VOICE] speakExact() called
[VOICE] Sending conversation.item.create event
[VOICE] conversation.item.create event sent
[VOICE] Sending response.create event (synthesis)
[VOICE] response.create event sent
[HOOK] client.speakExact() returned
[VOICE] sendEvent()
[VOICE] Sending event immediately via WebSocket
[VOICE] sendEvent()
[VOICE] Sending event immediately via WebSocket
[BEAT] onBeatStart() speakExact() returned
[BEAT] Calling onBeatStart callback returned
[EXPERIENCE] controller.startBeat() returned
[VOICE] Audio track received from Realtime
[VOICE] Calling audioElement.play()
[VOICE] Audio playback started
[VOICE] Audio playback finished
```

---

## NEXT STEPS

1. **Run `/experience`**
2. **Open DevTools Console**
3. **Click "Start Experience"**
4. **Find first missing log**
5. **Report that log**
6. **I will fix the broken link**

