# Implementation Plan: Scripted Experience Architecture

**Goal:** Move from generative conversation to scripted extraction  
**Duration:** 1.5 weeks  
**Risk:** Low (clear separation of concerns)

---

## PHASE 1: Application State Machine (2-3 days)

### 1.1 Create Beat Enum

**File:** `lib/experience/experience-beats.ts`

```typescript
export enum ExperienceBeat {
  GREETING = "greeting",
  PRODUCT = "product",
  CUSTOMER = "customer",
  EXPERIMENT = "experiment",
  PHONE = "phone",
  CLOSED = "closed",
}

export const BEAT_SCRIPTS = {
  [ExperienceBeat.GREETING]: {
    primary: "Hi, I'm Zeya. I spend most of my time helping businesses find new customers. What's your name?",
    fallback: "Sorry, could you repeat your name?",
    extractField: "visitor.name",
    successCriteria: "name extracted",
    timeout: 10000,
  },
  [ExperienceBeat.PRODUCT]: {
    primary: (visitorName: string) => `Nice to meet you, ${visitorName}. What does your business sell?`,
    fallback: "Got it. And when you help them, what exactly are they paying for?",
    extractField: "visitor.business.offer",
    successCriteria: "product/service described",
    timeout: 12000,
  },
  [ExperienceBeat.CUSTOMER]: {
    primary: "Who usually buys it?",
    fallback: "Tell me more about who your ideal customer is.",
    extractField: "visitor.business.target_buyer",
    successCriteria: "customer type identified",
    timeout: 12000,
  },
  [ExperienceBeat.EXPERIMENT]: {
    primary: "Got it. I'd like to show you something. We run a small experiment with businesses like yours — gives you a real sense of how this works before you decide anything. Would you be willing to try it?",
    fallback: "I know this might be unexpected. Does it sound interesting to you?",
    extractField: "decision",
    successCriteria: "yes/no detected",
    timeout: 15000,
  },
  [ExperienceBeat.PHONE]: {
    primary: "Great. I'll need your phone number to set this up. What's the best number to reach you?",
    fallback: "Sorry, can you repeat that number?",
    extractField: "visitor.phone",
    successCriteria: "phone number captured",
    timeout: 12000,
  },
  [ExperienceBeat.CLOSED]: {
    primary: "No problem at all. If you ever want to see how it works, you know where to find me.",
    fallback: null,
    extractField: null,
    successCriteria: "conversation ended gracefully",
    timeout: 5000,
  },
};
```

### 1.2 Create Experience State

**File:** `lib/experience/experience-state.ts`

```typescript
export interface ExperienceSession {
  id: string;
  timestamp: Date;
  currentBeat: ExperienceBeat;
  beatStartedAt: Date;
  visitor: {
    name?: string;
    phone?: string;
    business: {
      offer?: string;
      target_buyer?: string;
    };
  };
  decision?: "yes" | "no";
  extractionResults: {
    [key: string]: {
      value: string;
      confidence: number;
      attempts: number;
    };
  };
  status: "active" | "completed" | "failed";
}

export function initializeSession(): ExperienceSession {
  return {
    id: generateUUID(),
    timestamp: new Date(),
    currentBeat: ExperienceBeat.GREETING,
    beatStartedAt: new Date(),
    visitor: {
      business: {},
    },
    extractionResults: {},
    status: "active",
  };
}
```

### 1.3 Create Beat Controller

**File:** `lib/experience/beat-controller.ts`

```typescript
export class BeatController {
  private session: ExperienceSession;
  private realtime: OpenAIRealtimeClient;

  constructor(session: ExperienceSession, realtime: OpenAIRealtimeClient) {
    this.session = session;
    this.realtime = realtime;
  }

  async startBeat(beat: ExperienceBeat): Promise<void> {
    this.session.currentBeat = beat;
    this.session.beatStartedAt = new Date();

    const beatConfig = BEAT_SCRIPTS[beat];
    const scriptLine = typeof beatConfig.primary === "function"
      ? beatConfig.primary(this.session.visitor.name || "")
      : beatConfig.primary;

    // Speak the beat script
    await this.realtime.speakExact(scriptLine);

    // Start listening for the next extraction
    this.setupExtractionListener(beat);
  }

  private setupExtractionListener(beat: ExperienceBeat): void {
    const timeout = BEAT_SCRIPTS[beat].timeout;
    
    // Listen for transcript changes
    // When a final transcript arrives, extract the required field
    // Call advanceBeat() when extraction is successful
  }

  async advanceBeat(extractedValue: string, confidence: number): Promise<void> {
    const currentBeat = this.session.currentBeat;
    
    // Store extraction result
    this.session.extractionResults[currentBeat] = {
      value: extractedValue,
      confidence,
      attempts: 1,
    };

    // Determine next beat
    const nextBeat = this.getNextBeat(currentBeat, extractedValue);
    
    // Start next beat
    await this.startBeat(nextBeat);
  }

  private getNextBeat(currentBeat: ExperienceBeat, extractedValue: string): ExperienceBeat {
    switch (currentBeat) {
      case ExperienceBeat.GREETING:
        this.session.visitor.name = extractedValue;
        return ExperienceBeat.PRODUCT;
      case ExperienceBeat.PRODUCT:
        this.session.visitor.business.offer = extractedValue;
        return ExperienceBeat.CUSTOMER;
      case ExperienceBeat.CUSTOMER:
        this.session.visitor.business.target_buyer = extractedValue;
        return ExperienceBeat.EXPERIMENT;
      case ExperienceBeat.EXPERIMENT:
        this.session.decision = extractedValue === "yes" ? "yes" : "no";
        return extractedValue === "yes" ? ExperienceBeat.PHONE : ExperienceBeat.CLOSED;
      case ExperienceBeat.PHONE:
        this.session.visitor.phone = extractedValue;
        this.session.status = "completed";
        return ExperienceBeat.CLOSED;
      default:
        return ExperienceBeat.CLOSED;
    }
  }
}
```

---

## PHASE 2: Extraction Prompts (1-2 days)

### 2.1 Create Extraction Service

**File:** `lib/experience/extraction-service.ts`

```typescript
export interface ExtractionTask {
  beat: ExperienceBeat;
  field: string;
  visitorResponse: string;
  context: ExperienceSession;
}

export interface ExtractionResult {
  extracted: string | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

export async function extractField(task: ExtractionTask): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(task);
  
  // Call OpenAI with extraction prompt (NOT Realtime, just API)
  // This is a fast, deterministic extraction
  // Returns: { extracted, confidence, clarification }
  
  const result = await openaiAPI.createCompletion({
    model: "gpt-4o-mini",
    prompt,
    max_tokens: 100,
    temperature: 0,
  });

  return parseExtractionResult(result.choices[0].text);
}

function buildExtractionPrompt(task: ExtractionTask): string {
  const beatConfig = BEAT_SCRIPTS[task.beat];
  
  return `
You are an extraction assistant for a brief voice experience.

Current beat: ${task.beat}
Task: Extract ${task.field}

The visitor just said: "${task.visitorResponse}"

Your job is to extract the value for ${task.field}.

Return ONLY a JSON response with:
{
  "extracted": "the value (or null if unclear)",
  "confidence": 0.0-1.0,
  "needsClarification": true|false,
  "clarificationQuestion": "optional question to ask if unclear"
}

Examples:
Input: "My name is Sarah"
Output: {"extracted": "Sarah", "confidence": 0.98, "needsClarification": false}

Input: "Uh... maybe... I'm not sure"
Output: {"extracted": null, "confidence": 0.1, "needsClarification": true, "clarificationQuestion": "What's your name?"}

Extract only. Do not reason about the business. Do not interpret. Extract.
`;
}

function parseExtractionResult(text: string): ExtractionResult {
  try {
    const parsed = JSON.parse(text);
    return {
      extracted: parsed.extracted,
      confidence: parsed.confidence,
      needsClarification: parsed.needsClarification,
      clarificationQuestion: parsed.clarificationQuestion,
    };
  } catch {
    return {
      extracted: null,
      confidence: 0,
      needsClarification: true,
      clarificationQuestion: "I didn't catch that. Can you repeat?",
    };
  }
}
```

### 2.2 Extraction Prompts by Beat

**Greeting Extraction:**
```
Extract the visitor's name from: "[RESPONSE]"
Return: {"extracted": "[NAME]", "confidence": [0-1], "needsClarification": [true|false]}
```

**Product Extraction:**
```
Extract what the business sells from: "[RESPONSE]"
Return: {"extracted": "[PRODUCT/SERVICE]", "confidence": [0-1]}
Tolerance: High. Accept any description.
Example: "I run a gym" is sufficient.
```

**Customer Extraction:**
```
Extract the customer type from: "[RESPONSE]"
Return: {"extracted": "[CUSTOMER_TYPE]", "confidence": [0-1]}
Tolerance: High. Accept vague descriptions.
Example: "Small businesses" or "individuals" is sufficient.
```

**Yes/No Extraction:**
```
Determine if the visitor said yes or no to the experiment.
From: "[RESPONSE]"
Return: {"extracted": "yes" or "no", "confidence": [0-1], "needsClarification": true|false}
```

**Phone Extraction:**
```
Extract the phone number from: "[RESPONSE]"
Return: {"extracted": "[FORMATTED_PHONE]", "confidence": [0-1]}
Validate: Must be a real phone number format.
If unclear, needsClarification: true
```

---

## PHASE 3: Realtime Integration (2-3 days)

### 3.1 Modify Realtime Client

Add methods to the Realtime client:

```typescript
// Send exact script line (no generation)
async speakExact(text: string): Promise<void> {
  // Inject text into Realtime audio stream
  // Model reads it verbatim
  // No generation, no reasoning
}

// Listen for transcript and call callback
onTranscriptFinal(callback: (transcript: string) => void): void {
  // Hook into transcript events
  // Call callback when transcript is final
}
```

### 3.2 Connect Beat Controller to Realtime

```typescript
beatController.setupExtractionListener(beat);
// When final transcript arrives:
const result = await extractionService.extractField({
  beat,
  field: beatConfig.extractField,
  visitorResponse: transcript,
  context: session,
});

if (result.extracted && result.confidence > 0.7) {
  await beatController.advanceBeat(result.extracted, result.confidence);
} else if (result.needsClarification) {
  // Speak fallback line and try again
  await realtime.speakExact(beatConfig.fallback);
} else {
  // Timeout — advance anyway with partial data
  await beatController.advanceBeat(result.extracted || "", result.confidence);
}
```

---

## PHASE 4: Handoff to Onboarding (1-2 days)

### 4.1 Prepare Session Data

When Experience Layer completes, create handoff data:

```typescript
const handoffData = {
  visitorName: session.visitor.name,
  businessOffer: session.visitor.business.offer,
  targetBuyer: session.visitor.business.target_buyer,
  phone: session.visitor.phone,
  decision: session.decision,
  experienceDuration: Date.now() - session.timestamp,
  confidence: averageConfidence(session.extractionResults),
};
```

### 4.2 Create Onboarding Handoff Prompt

The Onboarding Layer receives the visitor with known context:

```typescript
const onboardingPrompt = `
You are now continuing a conversation with ${handoffData.visitorName}.

You already know:
- They run: ${handoffData.businessOffer}
- Their customers: ${handoffData.targetBuyer}
- They've agreed to an experiment: ${handoffData.decision}

You have just shown them what Zeya sounds like on a real call.

Now your job is to:
1. Let them experience a REAL demo call with an actual prospect
2. Show them how Zeya would handle that prospect
3. Gather their phone number for follow-up

Be consultative here. This is where you can explore deeply, ask discovery questions, offer coaching.

This is the Onboarding Layer. You have full freedom. Use it.
`;
```

---

## PHASE 5: Edge Cases & Fallbacks (2 days)

### 5.1 Handle Ambiguity

```typescript
// If extraction confidence < 0.5:
// Speak fallback line
// Increment attempt counter
// If attempts > 2: advance anyway with empty value

// If timeout reached:
// Log extraction failure
// Use empty/default value
// Continue to next beat
```

### 5.2 Handle Unexpected Input

```typescript
// If visitor says something completely unrelated:
// Extract as best as possible
// If nothing matches, advance with empty value
// Log for analysis

// Example:
// "What's your name?"
// "I don't know if I'm ready for this."
// → Can't extract name
// → Fall back to "What should I call you?"
// → If still no name, continue with empty
```

---

## TESTING PLAN

### Unit Tests
- Beat state transitions
- Extraction parsing
- Timeout handling
- Fallback activation

### Integration Tests
- Full 5-beat flow with mock transcripts
- State persistence across beats
- Handoff data completeness
- Edge case handling

### User Acceptance Tests
- Run 20 conversations with real voices
- Measure duration consistency (target: 30-45 seconds)
- Check extraction accuracy (target: >90%)
- Verify no consulting language appears

---

## ROLLBACK PLAN

If this architecture doesn't work as expected:

1. Keep current prompt-based version as fallback
2. Can switch back with a single environment variable
3. Data formats are compatible (both capture name/product/customer/phone)

---

## TIMELINE

| Phase | Task | Duration | Start |
|-------|------|----------|-------|
| 1 | State machine | 2-3 days | Day 1 |
| 2 | Extraction prompts | 1-2 days | Day 2 |
| 3 | Realtime integration | 2-3 days | Day 3 |
| 4 | Onboarding handoff | 1-2 days | Day 5 |
| 5 | Edge cases & testing | 2 days | Day 6 |
| **Total** | | **~1.5 weeks** | |

---

## SUCCESS CRITERIA

✅ All 5 beats are spoken in order  
✅ Extractions capture name + product + customer + phone  
✅ Duration is 30-45 seconds  
✅ No consulting language appears  
✅ Extraction accuracy > 90%  
✅ Handoff to Onboarding is clean  
✅ Zero drift (100% deterministic)  

This is clean. This is testable. This is maintainable.
