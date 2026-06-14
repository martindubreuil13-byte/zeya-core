# Realtime Connection Investigation: The Missing Link

**Status:** Connection broken after Kill Switch PR  
**Root Cause:** Identified  
**Fix Scope:** Minimal restoration of connection path only  

---

## QUESTIONS ANSWERED

### 1. What method creates the Realtime connection?

**Answer:** `openai-realtime-client.ts::connect(initialResponseInstructions?)`

**Location:** `lib/realtime/openai-realtime-client.ts:60`

**Signature:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ... WebRTC setup
  // ... data channel setup
  // ... audio element setup
}
```

**Responsibility:**
- Creates RTCPeerConnection
- Establishes WebRTC peer
- Creates data channel ("oai-events")
- Attaches media tracks
- Sets up audio output
- Returns when connected

**Does NOT do:**
- Send prompts (only if instructions parameter is passed)
- Generate responses
- Start conversation

---

### 2. What method sets connected = true?

**Answer:** `openai-realtime-client.ts::pc.onconnectionstatechange` handler

**Location:** `lib/realtime/openai-realtime-client.ts:122-126`

**Code:**
```typescript
if (pc.connectionState === "connected") {
  console.log("[VOICE] Realtime connection established");
  this.connected = true;  // ← SETS CONNECTED
  this.events.onConnected?.();
  this.events.onStateChange?.("listening");
}
```

**When it fires:**
- After RTCPeerConnection enters "connected" state
- After WebRTC handshake completes
- After audio track is ready

---

### 3. What method is no longer being called?

**Answer:** `useRealtimeOnboardingSession.ts::startConversation()`

**Location:** `hooks/realtime/useRealtimeOnboardingSession.ts:181`

**Signature:**
```typescript
const startConversation = useCallback(async (initialResponseInstructions?: string) => {
  setSnapshot((current) => ({
    ...current,
    state: "connecting",
    connectionStatus: "connecting",
    error: undefined,
  }));

  await clientRef.current?.connect(initialResponseInstructions);  // ← CALLS connect()
}, []);
```

**What it does:**
- Calls `client.connect()` to establish WebRTC
- Can optionally pass instructions (now removed)
- Sets state to "connecting"

**Who calls it:**
- **Before Kill Switch:** `app/experience/page.tsx::handleStartExperience()` called `await startConversation(hostIdentityPrompt)`
- **After Kill Switch:** No one calls it

---

### 4. What was removed during the Kill Switch that caused this?

**Commit:** `63f3242` — "Kill switch: Disconnect old conversational path from Experience layer"

**Removed from `app/experience/page.tsx:handleStartExperience()`:**

**Before:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  setConversationState("initial");

  const hostIdentityPrompt = `You are Zeya. You are a host.
    [191 lines of prompt]
  `;

  await startConversation(hostIdentityPrompt);  // ← THIS LINE
};
```

**After:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  // Old conversational path disabled — awaiting BeatController integration

  const session = initializeSession();
  // ... BeatController setup ...
  await controller.startBeat();  // ← CALLS THIS INSTEAD
};
```

**The Problem:**
- `startConversation()` was doing TWO jobs:
  1. ✅ Establish Realtime connection (still needed)
  2. ❌ Send prompt to OpenAI (not needed, removed)
- We removed the entire call to kill the prompt
- But this also killed the connection

---

### 5. What is the smallest restoration needed?

**Answer:** Call `startConversation()` with NO arguments

**Why this works:**
```typescript
async connect(initialResponseInstructions?: string) {
  // ... WebRTC setup happens FIRST ...
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("oai-events");
  
  // ... THEN check if instructions were passed ...
  if (initialResponseInstructions) {
    this.requestResponse(initialResponseInstructions);  // ← Only if param exists
  }
}
```

The WebRTC connection and data channel setup happens **regardless** of whether instructions are passed.

If we call `startConversation()` with no arguments:
- ✅ WebRTC connection established
- ✅ Data channel created
- ✅ Audio output ready
- ✅ `connected = true` set
- ❌ NO instructions sent
- ❌ NO prompt passed
- ❌ NO model generation possible

---

## EXECUTION PATH: OLD vs. NEW vs. DESIRED

### Old Flow (Before Kill Switch)

```
User clicks "Start Experience"
  ↓
handleStartExperience()
  ├─ const hostIdentityPrompt = "You are Zeya..."
  │
  └─ await startConversation(hostIdentityPrompt)
     └─ await client.connect(hostIdentityPrompt)
        ├─ Establish WebRTC ✅
        ├─ Create data channel ✅
        └─ Send prompt: response.create { instructions: "..." } ❌ (unwanted)
           └─ OpenAI interprets instructions
              └─ OpenAI generates responses (consulting drift)
```

### Broken Flow (After Kill Switch)

```
User clicks "Start Experience"
  ↓
handleStartExperience()
  ├─ const session = initializeSession()
  ├─ const controller = new BeatController(...)
  │
  └─ await controller.startBeat()
     └─ Call onBeatStart callback
        └─ await speakExact(script)
           ├─ Check: is connected? NO ❌
           └─ ERROR: Not connected to Realtime!
```

**Why it's broken:**
- We initialize BeatController
- We call startBeat()
- But Realtime was never connected
- So speakExact() fails because `this.connected = false`

### Desired Flow (After Fix)

```
User clicks "Start Experience"
  ↓
handleStartExperience()
  ├─ await startConversation()  ← RESTORE, but with NO arguments
  │  └─ await client.connect()  [undefined]
  │     ├─ Establish WebRTC ✅
  │     ├─ Create data channel ✅
  │     └─ set connected = true ✅
  │     └─ NO instructions sent ✅
  │
  ├─ const session = initializeSession()
  ├─ const controller = new BeatController(...)
  │
  └─ await controller.startBeat()
     └─ Call onBeatStart callback
        └─ await speakExact(script)
           ├─ Check: is connected? YES ✅
           ├─ Check: is dataChannelReady? YES ✅
           └─ Send synthesis event ✅
              └─ Realtime synthesizes audio (no model generation)
                 └─ Audio plays ✅
```

**Why this works:**
1. Connection established first (voice transport layer ready)
2. No prompts or instructions sent
3. No OpenAI authority over dialogue
4. BeatController takes over (application controls everything)
5. speakExact() has connection it needs
6. Realtime only synthesizes (no generation)

---

## THE MINIMAL FIX

**File:** `app/experience/page.tsx`

**In handleStartExperience():**

**Before (Kill Switch):**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  // Old conversational path disabled

  const session = initializeSession();
  const controller = new BeatController(session, {
    // ...
  });

  controllerRef.current = controller;
  await controller.startBeat();
};
```

**After (Minimal Fix):**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");

  // RESTORED: Establish Realtime connection (no prompt)
  console.log("[EXPERIENCE] Establishing Realtime connection");
  await startConversation();  // ← NO ARGUMENTS = NO PROMPT
  console.log("[EXPERIENCE] Realtime connected, starting beats");

  const session = initializeSession();
  const controller = new BeatController(session, {
    onBeatStart: async (beat, script) => {
      await speakExact?.(script);
    },
    // ... rest unchanged ...
  });

  controllerRef.current = controller;
  await controller.startBeat();
};
```

**Why this is safe:**
- `startConversation()` without arguments = just connect WebRTC
- No prompt parameter = no instructions sent to OpenAI
- No model generation = no drift possible
- Only establishes voice transport layer

---

## PROOF: NO PROMPT SENT

### Flow of connect() with no argument

```typescript
async connect(initialResponseInstructions?: string) {  // initialResponseInstructions = undefined
  // ... setup WebRTC ...
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel("oai-events");
  
  // ... This is the only place instructions are used ...
  if (initialResponseInstructions) {  // ← FALSE (undefined)
    this.requestResponse(initialResponseInstructions);  // ← NOT EXECUTED
  }
  
  // ... rest of setup ...
}
```

**Result:**
- WebRTC connection ✅
- Data channel ✅
- Audio output ✅
- connected = true ✅
- **No requestResponse() call**
- **No prompt sent**
- **No model generation**

---

## WHAT STAYS DELETED

The Kill Switch successfully removed:

| Item | Old | Kill Switch | Status |
|------|-----|---|--------|
| hostIdentityPrompt | Sent | Deleted | ✅ STAYS DELETED |
| sendNextQuestion() | Called | Removed | ✅ STAYS REMOVED |
| sendAction() | Called | Removed | ✅ STAYS REMOVED |
| conversationState tracking | Active | Removed | ✅ STAYS REMOVED |
| Prompt guidance | "You are a host..." | Gone | ✅ STAYS GONE |

**None of these come back. We only restore the connection establishment.**

---

## MINIMAL CHANGE SUMMARY

| Component | Change | Risk | Reason |
|-----------|--------|------|--------|
| app/experience/page.tsx | Add `await startConversation()` | NONE | Establishes WebRTC without prompt |
| handleStartExperience() | One line addition | NONE | Called before BeatController |
| Everything else | No change | NONE | BeatController still controls dialogue |

**Total change:** 1 line  
**Total risk:** Zero (connection with no prompt is safe)  
**Total impact:** Fixes Realtime connection  

---

## IMPLEMENTATION CHECKLIST

- [ ] Restore voice hook imports to handleStartExperience
- [ ] Add `await startConversation()` call (NO arguments)
- [ ] Verify no prompts or instructions in parameters
- [ ] Build and test
- [ ] Verify logs show: "[VOICE] Realtime connection established"
- [ ] Verify speakExact() logs show: "{connected: true, dataChannelReady: true}"

---

## NEXT STEPS

1. **Implement minimal fix** (add startConversation call)
2. **Verify connection** (check console logs)
3. **Test speakExact()** (verify audio synthesis works)
4. **Run 5 test cycles** (same sequence each time)
5. **Verify no drift** (no consulting questions)

After this is working, Phase 1C can add extraction to understand what users say.

