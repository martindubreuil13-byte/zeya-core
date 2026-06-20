# Connection Lifecycle: Evidence-Based Analysis

**Objective:** Answer these three questions definitively:

1. **Does `connected=true` ever occur?**
2. **When does it occur relative to `speakExact()`?**
3. **What is the actual WebRTC timeline?**

**Method:** Filter console by `[CONNECTION]` to see only connection lifecycle logs.

---

## HOW TO READ THE LOGS

### Step 1: Filter Console
In DevTools console, type this filter:
```
[CONNECTION]
```

This shows ONLY connection lifecycle logs, removing all other noise.

### Step 2: Click "Start Experience"
Watch for logs in this pattern.

### Step 3: Copy the Timeline
Copy all logs that start with `[CONNECTION]` in order of appearance.

### Step 4: Analyze

---

## EXPECTED TIMELINE (if working)

```
[CONNECTION] ice state change {iceConnectionState: "checking"}
[CONNECTION] ice state change {iceConnectionState: "connected"}
[CONNECTION] data channel opened {connected: false}
[CONNECTION] pc.onconnectionstatechange {connectionState: "connected"}
[CONNECTION] connected=true
[CONNECTION] After connect(), client state {connected: true}
[CONNECTION] Before BeatController
[VOICE] speakExact() called {connected: true, dataChannelReady: true}
```

**Interpretation:**
- ✅ `connected=true` DOES occur
- ✅ It occurs BEFORE `speakExact()`
- ✅ Timeline follows WebRTC flow (ICE → DataChannel → PeerConnection → Connected)

---

## POSSIBLE OUTCOMES

### Outcome A: connected=true NEVER occurs

**What you'll see:**
```
[CONNECTION] ice state change {iceConnectionState: "checking"}
[CONNECTION] ice state change {iceConnectionState: "connected"}
[CONNECTION] data channel opened {connected: false}
[CONNECTION] pc.onconnectionstatechange {connectionState: "connected"}
(no "[CONNECTION] connected=true" log appears)
[CONNECTION] After connect(), client state {connected: false}
[VOICE] speakExact() called {connected: false}
```

**Analysis:**
- ❌ `connected` is never set to true
- ❌ Even though pc.connectionState === "connected", the code didn't execute
- ❌ Connection setup is broken

**Likely cause:**
- Bug in pc.onconnectionstatechange handler
- Code path to `this.connected = true` is unreachable
- Condition check failing

---

### Outcome B: connected=true happens AFTER speakExact()

**What you'll see:**
```
[VOICE] speakExact() called {connected: false}
[VOICE] ERROR: Not connected to Realtime!
(time passes...)
[CONNECTION] pc.onconnectionstatechange {connectionState: "connected"}
[CONNECTION] connected=true
```

**Analysis:**
- ⚠️ Race condition exists
- ⚠️ Beat starts before connection is ready
- ⚠️ speakExact() fails, then connection arrives too late
- Need to gate beat behind connection event

**Solution:**
```typescript
// In handleStartExperience():
await startConversation();
// Don't call controller.startBeat() yet

// Instead, wait for connection confirmed
voice.onConnected(() => {
  controller.startBeat();  // Now safe
});
```

---

### Outcome C: connected=true happens BEFORE speakExact(), but speakExact() still says connected=false

**What you'll see:**
```
[CONNECTION] connected=true
[CONNECTION] After connect(), client state {connected: true}
[VOICE] speakExact() called {connected: false}
```

**Analysis:**
- ⚠️ Connection succeeded
- ❌ But a different client instance is being used
- ❌ Or connection state is being cleared unexpectedly
- ❌ Stale reference to old client

**Likely cause:**
- `voice` hook is returning a different client instance than the one that connected
- Client reference got garbage collected
- Hook re-render created new client

**Solution:**
- Check that voice hook is not re-creating client on every render
- Ensure refs are stable

---

## CRITICAL LOGS TO WATCH

### 1. Does this log ever appear?
```
[CONNECTION] connected=true
```

**If NO:** Connection never establishes ❌  
**If YES:** Connection eventually establishes ✅

### 2. Does this log show true or false?
```
[CONNECTION] After connect(), client state {connected: true}
```

**If `connected: false`:** Connection failed ❌  
**If `connected: true`:** Connection succeeded ✅

### 3. Timing of connected=true vs. speakExact()

**Look at timestamps in logs:**
```
[CONNECTION] connected=true {timestamp: 1234.56}
[VOICE] speakExact() called {timestamp: 1678.90}
```

**If 1234.56 < 1678.90:** Connection first ✅  
**If 1678.90 < 1234.56:** Beat first ⚠️

---

## TEST PROCEDURE

1. **Open browser DevTools → Console**
2. **Type in console filter box:** `[CONNECTION]`
3. **Click "Start Experience"**
4. **Copy all logs starting with [CONNECTION]**
5. **Answer these three questions:**

   Q1: Does `[CONNECTION] connected=true` appear?
   - Answer: YES / NO

   Q2: If YES, when does it appear?
   - Answer: Before speakExact / After speakExact / Not at all

   Q3: What is the last [CONNECTION] log before any [VOICE] logs?
   - Answer: (copy the log)

---

## NEXT STEPS

1. **Run test**
2. **Filter by [CONNECTION]**
3. **Copy the timeline**
4. **Report:**
   - "connected=true appears: YES / NO"
   - "If YES, timing: BEFORE / AFTER speakExact()"
   - "Last [CONNECTION] log before [VOICE] logs:"

The actual logs will show which of the three outcomes is happening.

No guessing. Just evidence from the timeline.

