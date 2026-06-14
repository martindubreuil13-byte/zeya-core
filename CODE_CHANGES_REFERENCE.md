# Code Changes Reference

Complete reference of all code changes made to implement the deterministic state machine.

---

## File 1: app/experience/page.tsx

### Change 1: Add conversationState to state management (line 41)

**Location:** After other useState declarations

**Added:**
```typescript
const [conversationState, setConversationState] = useState<
  "initial" | "name_asked" | "offer_asked" | "buyer_asked" | "completed"
>("initial");
```

**Purpose:** Track which state machine state we're in

---

### Change 2: Send initial question when connection established (lines 49-57)

**Location:** New useEffect after transcript auto-scroll effect

**Added:**
```typescript
// Send the initial question after connection is established
useEffect(() => {
  if (phase === "voice_active" && voiceState === "listening" && conversationState === "initial") {
    const initialQuestion = getNextQuestion();
    setTimeout(() => {
      voice.sendNextQuestion?.(initialQuestion);
    }, 100);
  }
}, [voiceState, phase, conversationState, voice]);
```

**Purpose:** When connection is ready, send the first question to the model

---

### Change 3: Track user responses and advance state (lines 59-89)

**Location:** New useEffect after initial question effect

**Added:**
```typescript
// Track conversation state and advance when user responses are received
useEffect(() => {
  if (phase !== "voice_active" || !voice) return;

  const userMessages = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text);

  // Determine next state based on number of final user responses
  if (conversationState === "initial" && userMessages.length >= 1) {
    // They answered the name question
    const name = userMessages[0].text.trim();
    setVisitorName(name);
    setConversationState("name_asked");
  } else if (conversationState === "name_asked" && userMessages.length >= 2) {
    // They answered the offer question
    setConversationState("offer_asked");
  } else if (conversationState === "offer_asked" && userMessages.length >= 3) {
    // They answered the buyer question
    setConversationState("buyer_asked");
  } else if (conversationState === "buyer_asked" && userMessages.length >= 4) {
    // They answered the experiment question (yes/no)
    const answer = userMessages[3].text.toLowerCase();
    const isYes =
      answer.includes("yes") ||
      answer.includes("yeah") ||
      answer.includes("sure") ||
      answer.includes("absolutely") ||
      answer.includes("interested");

    if (isYes) {
      // Send transition action to trigger phone collection
      voice.sendAction?.({
        type: "transition",
        next: "collect_phone",
      });
    }

    setConversationState("completed");
    setTimeout(() => {
      stopConversation();
      setPhase("collecting_phone");
    }, 500);
  }
}, [voiceTranscript, conversationState, phase, voice, stopConversation]);
```

**Purpose:** Detect when user has answered a question, extract the answer, advance the state machine

---

### Change 4: Send next question when state changes (lines 107-116)

**Location:** New useEffect after state tracking effect

**Added:**
```typescript
// Send next question when conversation state advances (after initial question)
useEffect(() => {
  if (phase !== "voice_active" || conversationState === "initial" || conversationState === "completed") return;

  const nextQuestion = getNextQuestion();
  if (!nextQuestion) return;

  // Delay to allow previous response to complete
  const timer = setTimeout(() => {
    voice.sendNextQuestion?.(nextQuestion);
  }, 300);

  return () => clearTimeout(timer);
}, [conversationState, phase, voice]);
```

**Purpose:** When state machine advances, send the next question to the model

---

### Change 5: Add getNextQuestion function (lines 118-130)

**Location:** After conversation initialization in handleStartExperience

**Added:**
```typescript
const getNextQuestion = () => {
  switch (conversationState) {
    case "initial":
      return "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?";
    case "name_asked":
      return `Nice to meet you, ${visitorName}. What does your business sell?`;
    case "offer_asked":
      return "Who usually buys it?";
    case "buyer_asked":
      return "Got it. I'd like to run a small experiment with you. Would you be willing to try it?";
    default:
      return "";
  }
};
```

**Purpose:** Return the exact line Zeya should speak for the current state. The application determines all dialogue.

---

### Change 6: Update handleStartExperience (lines 132-140)

**Location:** Replace old function that sent state machine instructions

**Old Code:**
```typescript
const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");

  const initialInstructions = `You are a state machine. Execute only these 5 states...
STATE 1:
Say: "Hi, I'm Zeya..."
...`;

  await startConversation(initialInstructions);
};
```

**New Code:**
```typescript
const [conversationState, setConversationState] = useState<
  "initial" | "name_asked" | "offer_asked" | "buyer_asked" | "completed"
>("initial");

const getNextQuestion = () => {
  switch (conversationState) {
    case "initial":
      return "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?";
    case "name_asked":
      return `Nice to meet you, ${visitorName}. What does your business sell?`;
    case "offer_asked":
      return "Who usually buys it?";
    case "buyer_asked":
      return "Got it. I'd like to run a small experiment with you. Would you be willing to try it?";
    default:
      return "";
  }
};

const handleStartExperience = async () => {
  if (!isConfigured) return;
  setPhase("voice_active");
  setConversationState("initial");

  // Minimal system prompt - only tell Zeya to speak the lines provided
  const minimalPrompt = `You are Zeya. Speak the exact line provided by the application. Do not add anything. Do not ask extra questions. Just say the line.`;

  // Start with the first question
  await startConversation(minimalPrompt);
};
```

**Key Change:** From sending a full state machine description to sending a minimal prompt that tells the model to speak the exact lines the application provides.

---

## File 2: hooks/realtime/useRealtimeOnboardingSession.ts

### Change 1: Add sendNextQuestion method (lines 193-195)

**Location:** After stopConversation callback

**Added:**
```typescript
const sendNextQuestion = useCallback((question: string) => {
  clientRef.current?.requestResponse(question);
}, []);
```

**Purpose:** Send a question via response.create event to the OpenAI Realtime API

---

### Change 2: Add sendAction method (lines 197-200)

**Location:** After sendNextQuestion

**Added:**
```typescript
const sendAction = useCallback((action: Record<string, unknown>) => {
  const actionMessage = `[ACTION]${JSON.stringify(action)}[/ACTION]`;
  clientRef.current?.requestResponse(actionMessage);
}, []);
```

**Purpose:** Send structured actions (like transition commands) via response.create

---

### Change 3: Add methods to return object (lines 203-206)

**Location:** In the return object, after other methods

**Added to return:**
```typescript
  sendNextQuestion,
  sendAction,
```

**Before:**
```typescript
  return {
    ...snapshot,
    isConfigured: true,
    provider: "openai-realtime" as const,
    startConversation,
    stopConversation,
    connect: startConversation,
    disconnect: stopConversation,
    sendTextMessage: async (_message: string) => {
      throw new Error("Text messages are not implemented for OpenAI Realtime onboarding.");
    },
  };
```

**After:**
```typescript
  return {
    ...snapshot,
    isConfigured: true,
    provider: "openai-realtime" as const,
    startConversation,
    stopConversation,
    sendNextQuestion,
    sendAction,
    connect: startConversation,
    disconnect: stopConversation,
    sendTextMessage: async (_message: string) => {
      throw new Error("Text messages are not implemented for OpenAI Realtime onboarding.");
    },
  };
```

---

## File 3: hooks/voice/useVoiceConversation.ts

### Change: Add sendNextQuestion and sendAction stubs (lines 52-58)

**Location:** In the return object, after sendTextMessage

**Added:**
```typescript
    sendNextQuestion: useCallback((_question: string) => {
      throw new Error("sendNextQuestion is not implemented for ElevenLabs provider.");
    }, []),
    sendAction: useCallback((_action: Record<string, unknown>) => {
      throw new Error("sendAction is not implemented for ElevenLabs provider.");
    }, []),
```

**Before:**
```typescript
  return {
    ...snapshot,
    isConfigured: Boolean(agentId),
    startConversation: useCallback(() => service?.startConversation(), [service]),
    stopConversation: useCallback(() => service?.stopConversation(), [service]),
    connect: useCallback(() => service?.connect(), [service]),
    disconnect: useCallback(() => service?.disconnect(), [service]),
    sendTextMessage: useCallback((message: string) => service?.sendTextMessage(message), [service]),
  };
```

**After:**
```typescript
  return {
    ...snapshot,
    isConfigured: Boolean(agentId),
    startConversation: useCallback(() => service?.startConversation(), [service]),
    stopConversation: useCallback(() => service?.stopConversation(), [service]),
    connect: useCallback(() => service?.connect(), [service]),
    disconnect: useCallback(() => service?.disconnect(), [service]),
    sendTextMessage: useCallback((message: string) => service?.sendTextMessage(message), [service]),
    sendNextQuestion: useCallback((_question: string) => {
      throw new Error("sendNextQuestion is not implemented for ElevenLabs provider.");
    }, []),
    sendAction: useCallback((_action: Record<string, unknown>) => {
      throw new Error("sendAction is not implemented for ElevenLabs provider.");
    }, []),
  };
```

**Purpose:** Add method stubs to maintain type compatibility with the OpenAI Realtime hook

---

## Summary of Changes

### What Was Removed
- ❌ 1,030+ token state machine prompt sent once at initialization
- ❌ Instructions describing states, rules, and "DO NOT" behaviors
- ❌ All flexibility language that allowed model interpretation
- ❌ All personality/guidance language

### What Was Added
- ✅ Minimal prompt: "Speak the exact line provided by the application"
- ✅ State machine in application code (not in prompt)
- ✅ Per-turn question delivery (not one-time instructions)
- ✅ sendNextQuestion() method to send each line
- ✅ sendAction() method to send transition commands
- ✅ Logic to track user responses and advance states
- ✅ Name extraction and interpolation

### What Changed Fundamentally
- **From:** Model decides conversation flow
- **To:** Application decides conversation flow
- **From:** Passive architecture (send instructions, model executes)
- **To:** Active architecture (app sends each question)

---

## Lines of Code Changed

| File | Type | Lines | Change |
|------|------|-------|--------|
| app/experience/page.tsx | Added | 41, 50-116 | State machine logic |
| app/experience/page.tsx | Modified | 132-140 | handleStartExperience |
| hooks/realtime/useRealtimeOnboardingSession.ts | Added | 193-206 | sendNextQuestion, sendAction |
| hooks/voice/useVoiceConversation.ts | Added | 52-58 | Method stubs |
| **Total** | | **~100 lines** | Deterministic flow |

---

## Key Code Pattern

The core pattern that makes this work:

```typescript
// 1. State advances when user responds
if (conversationState === "initial" && userMessages.length >= 1) {
  setConversationState("name_asked");
}

// 2. When state changes, send next question
useEffect(() => {
  const question = getNextQuestion(); // "Nice to meet you, Alex..."
  voice.sendNextQuestion?.(question); // Send via response.create
}, [conversationState]);

// 3. getNextQuestion returns exact line for current state
const getNextQuestion = () => {
  switch(conversationState) {
    case "name_asked":
      return `Nice to meet you, ${visitorName}. What does your business sell?`;
    // ...
  }
};
```

This pattern repeats for each turn:
1. Detect user response
2. Advance state
3. Send next question
4. Repeat

---

## Verification

**Build Check:**
```bash
npm run build
# ✓ Compiled successfully
# ✓ TypeScript passed
# ✓ No errors, no warnings
```

**Type Safety:**
All methods properly typed via:
- `sendNextQuestion?: (question: string) => void`
- `sendAction?: (action: Record<string, unknown>) => void`

**Backwards Compatibility:**
- No changes to session creation endpoint
- No changes to Supabase dispatch
- No changes to Telnyx worker brief
- No changes to monitor infrastructure
- Only the Experience controller changed
