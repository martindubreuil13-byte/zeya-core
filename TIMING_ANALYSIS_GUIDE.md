# Timing Analysis: Connection vs. Beat Startup

**Objective:** Detect race condition between Realtime connection establishment and BeatController.startBeat()

**All timestamps use `performance.now()` for microsecond precision.**

---

## CRITICAL TIMESTAMPS

Watch the console for these exact logs with timestamps:

### 1. Connection Events
```
[EXPERIENCE] Start button clicked {
  timestamp: 1234.56,
  millisecondsSincePageLoad: 1235
}
```

### 2. Data Channel Ready
```
[VOICE] Data channel opened {
  timestamp: 1456.78,
  millisecondsSincePageLoad: 1457
}
```

### 3. Connection Established
```
[VOICE] Realtime connection established {
  timestamp: 1567.89,
  millisecondsSincePageLoad: 1568
}
```

### 4. Beat Startup
```
[EXPERIENCE] Calling controller.startBeat() {
  timestamp: 1678.90,
  millisecondsSincePageLoad: 1679,
  timeSinceConnectionReady: "see [VOICE] timestamp for comparison"
}
```

### 5. Beat Execution
```
[BEAT] startBeat() called {
  currentBeat: "greeting",
  timestamp: 1689.01,
  millisecondsSincePageLoad: 1689
}
```

### 6. Speech Synthesis Request
```
[VOICE] speakExact() called {
  timestamp: 1745.67,
  millisecondsSincePageLoad: 1746,
  connected: true,
  dataChannelReady: true,
  dataChannelState: "open"
}
```

---

## TIMING ANALYSIS

### Expected Timeline (No Race Condition)

```
t=0ms:     [EXPERIENCE] Start button clicked
           ↓ (await startConversation starts)
t=X ms:    [VOICE] Data channel opened
           ↓
t=Y ms:    [VOICE] Realtime connection established
           ↓ (await startConversation completes)
t=Y+Zms:   [EXPERIENCE] Calling controller.startBeat()
           ↓
t=Y+Z+Nms: [BEAT] startBeat() called
           ↓
t=Y+Z+M ms: [VOICE] speakExact() called {connected: true, ...}
           ↓
SUCCESS:   Audio plays
```

### If Race Condition Exists

```
t=0ms:     [EXPERIENCE] Start button clicked
t=1ms:     [EXPERIENCE] Calling controller.startBeat()  ← TOO EARLY
           ↓
t=2ms:     [BEAT] startBeat() called
           ↓
t=3ms:     [VOICE] speakExact() called {connected: false, ...}
           ↓
FAIL:      [VOICE] ERROR: Not connected to Realtime!
           ↓
t=50ms:    [VOICE] Data channel opened  ← ARRIVES AFTER
           ↓
t=100ms:   [VOICE] Realtime connection established  ← ARRIVES AFTER
```

---

## HOW TO READ THE TIMESTAMPS

### Step 1: Find Connection Milestones
```
[VOICE] Data channel opened { timestamp: 1234.56 }
[VOICE] Realtime connection established { timestamp: 1345.67 }
```

**Connection ready time:** 1345.67 ms (or whichever is later)

### Step 2: Find Beat Startup
```
[EXPERIENCE] Calling controller.startBeat() { timestamp: 1300.00 }
```

**Beat startup time:** 1300.00 ms

### Step 3: Compare
```
Connection ready:  1345.67 ms
Beat started:      1300.00 ms
Difference:        -45.67 ms

← NEGATIVE: Beat started BEFORE connection ready
← RACE CONDITION EXISTS
```

### Step 4: Find speakExact Check
```
[VOICE] speakExact() called { timestamp: 1310.00, connected: true, ... }
```

If `connected: true` at this time, connection was established by then.
If `connected: false`, connection was NOT established yet.

---

## SCENARIOS & ANALYSIS

### Scenario A: No Race Condition
```
[VOICE] Realtime connection established {timestamp: 100.50}
[EXPERIENCE] Calling controller.startBeat() {timestamp: 150.00}
[VOICE] speakExact() called {timestamp: 155.00, connected: true}
```

**Result:** ✅ SAFE — Connection ready before beat starts

---

### Scenario B: Minimal Race Condition
```
[VOICE] Data channel opened {timestamp: 50.00}
[EXPERIENCE] Calling controller.startBeat() {timestamp: 48.00}
[BEAT] startBeat() called {timestamp: 48.50}
[VOICE] speakExact() called {timestamp: 49.00, connected: false}
[VOICE] ERROR: Not connected to Realtime!
[VOICE] Realtime connection established {timestamp: 60.00}
```

**Result:** ⚠️ RACE CONDITION — Beat called 2ms before connection ready

---

### Scenario C: Significant Race Condition
```
[EXPERIENCE] Calling controller.startBeat() {timestamp: 20.00}
[BEAT] startBeat() called {timestamp: 20.50}
[VOICE] speakExact() called {timestamp: 21.00, connected: false}
[VOICE] ERROR: Not connected to Realtime!
[VOICE] Data channel opened {timestamp: 150.00}
[VOICE] Realtime connection established {timestamp: 200.00}
```

**Result:** ❌ CRITICAL — Beat called 180ms before connection ready

---

## DECISION LOGIC

### If timestamps show:

**`[EXPERIENCE] Calling controller.startBeat()` timestamp BEFORE `[VOICE] Realtime connection established` timestamp:**

→ **Race condition exists**

→ **Gate solution needed:** Wait for connection event before calling startBeat()

### If timestamps show:

**`[VOICE] Realtime connection established` timestamp BEFORE `[EXPERIENCE] Calling controller.startBeat()` timestamp:**

→ **No race condition**

→ **Current implementation is safe**

---

## GATING SOLUTION (If Race Condition Found)

If analysis shows a race condition, implement this in `handleStartExperience()`:

```typescript
const handleStartExperience = async () => {
  console.log("[EXPERIENCE] Start button clicked");
  if (!isConfigured) return;
  setPhase("voice_active");

  console.log("[EXPERIENCE] Establishing Realtime connection");
  const connectStartTimestamp = performance.now();
  await startConversation();
  const connectEndTimestamp = performance.now();
  console.log("[EXPERIENCE] Realtime connected", {
    duration: Math.round(connectEndTimestamp - connectStartTimestamp),
  });

  // ← WAIT FOR CONNECTION EVENT (if needed)
  // await new Promise(resolve => {
  //   voiceRef.current.onConnected = () => {
  //     console.log("[EXPERIENCE] Connection event received, proceeding");
  //     resolve();
  //   };
  // });

  console.log("[EXPERIENCE] Initializing session");
  const session = initializeSession();
  
  // ... rest of function ...
};
```

**Better solution:** Wire voice.onConnected event to trigger beat startup:

```typescript
const controller = new BeatController(session, {
  // ... callbacks ...
});

controllerRef.current = controller;

// Only call startBeat after connection confirmed
voice.onConnected(() => {
  console.log("[EXPERIENCE] Connection confirmed, starting beats");
  controller.startBeat();
});
```

---

## TEST PROCEDURE

1. **Open browser DevTools → Console**
2. **Filter by "timestamp" to see all timestamped logs**
3. **Click "Start Experience"**
4. **Copy the timing logs:**
   - [EXPERIENCE] Start button clicked {timestamp: X}
   - [VOICE] Data channel opened {timestamp: Y}
   - [VOICE] Realtime connection established {timestamp: Z}
   - [EXPERIENCE] Calling controller.startBeat() {timestamp: W}
   - [BEAT] startBeat() called {timestamp: V}
   - [VOICE] speakExact() called {timestamp: U, connected: ?}

5. **Compare timestamps:**
   - If Z < W: Connection ready before beat starts ✅
   - If W < Z: Beat started before connection ready ⚠️

---

## EXPECTED RESULTS

### Most Likely: No Race Condition
- Connection established: ~100-200ms
- Beat starts: ~150-250ms
- speakExact checks: connected=true ✅

### If Race Condition Found:
- Connection ready: ~200-300ms
- Beat starts: ~20-50ms
- speakExact fails: connected=false ❌
- Then connection arrives 150-250ms later

---

## NEXT ACTION

1. **Run `/experience`**
2. **Open console**
3. **Click "Start Experience"**
4. **Find these logs with timestamps**
5. **Compare timestamps**
6. **Report:** Which timestamp comes first?
   - Connection established?
   - Or beat started?

The answer determines if gating is needed.

