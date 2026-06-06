# CallOutcome Architecture

## Overview

The CallOutcome system converts completed conversations into structured business outcomes using deterministic, rule-based classification.

**Problem**: Webhooks arrive with conversation data but no business context (did the call result in interest? Should we schedule a callback? Was it a wrong number?)

**Solution**: Rule-based outcome detection that classifies conversations into outcome categories (interested, not_interested, callback_requested, voicemail, wrong_number, unknown).

---

## The Conversation → Outcome Pipeline

```
ElevenLabs Call
     ↓
post_call_transcription webhook
     ↓
Save Conversation
     ↓
Lookup WorkerBriefId (if mapped)
     ↓
Detect Outcome (rules)
     ↓
Build CallOutcome
     ↓
Store in Memory
     ↓
Return to API consumer
```

---

## Outcome Values

### **interested**
Prospect expressed interest in the product/service.
- **Detection**: Keywords like "interested", "sounds good", "demo", "tell me more"
- **Recommended Action**: `schedule_demo`
- **Next Step**: Sales team schedules demo

### **not_interested**
Prospect explicitly declined or expressed disinterest.
- **Detection**: Keywords like "not interested", "no thanks", "not a fit", "not right now"
- **Recommended Action**: `remove_list`
- **Next Step**: Remove from call list, mark as do-not-call

### **callback_requested**
Prospect wants to be called back later.
- **Detection**: Keywords like "callback", "call me back", "call later", "next week"
- **Recommended Action**: `schedule_callback`
- **Next Step**: Schedule callback at requested time

### **voicemail**
Prospect did not answer; call went to voicemail.
- **Detection**: Very short call duration (<10s) OR voicemail-related keywords
- **Recommended Action**: `retry_call`
- **Next Step**: Retry call at a different time

### **wrong_number**
Call reached wrong person or disconnected number.
- **Detection**: Very short duration AND confusion keywords ("who is this", "hold on")
- **Recommended Action**: `remove_list`
- **Next Step**: Remove number from list

### **completed**
Call completed normally (less common; usually becomes interested/not_interested/callback).
- **Detection**: Full conversation with normal duration
- **Recommended Action**: `mark_complete`
- **Next Step**: Log as completed

### **unknown**
Unable to determine outcome from conversation data.
- **Detection**: Default when no keywords match
- **Recommended Action**: `follow_up`
- **Next Step**: Manual review

---

## Detection Rules

### Rule Engine

```typescript
detectOutcome(conversation: CapturedElevenLabsConversation): OutcomeDetectionResult
```

Runs in order:

1. **Check call status** — If failed, return "unknown"
2. **Check for voicemail** — Very short call OR voicemail keywords → "voicemail"
3. **Check for wrong number** — Short call AND confusion keywords → "wrong_number"
4. **Check for callback request** — Callback keywords in summary/transcript → "callback_requested"
5. **Check for interest** — Interest keywords → "interested"
6. **Check for disinterest** — Disinterest keywords → "not_interested"
7. **Check extracted data** — If ElevenLabs returned sentiment/intent/outcome → use that
8. **Default** — Return "unknown"

### Keyword Sets

**Interest**: interested, sounds good, definitely, let's, would love, great idea, demo, tell me more, want to know, pricing

**Callback**: callback, call me back, call later, reach out, call tomorrow, next week, schedule a call, ring me back

**Disinterest**: not interested, no thanks, not a fit, not right now, busy, don't need, doesn't fit

**Voicemail**: voicemail, leave a message, beep, message, after the tone

**Wrong Number**: who is this, hold on, (combined with short duration)

---

## Confidence Scores

Each outcome includes a confidence score (0-1):

- **High confidence (0.8-1.0)**: Strong keyword match, clear patterns
- **Medium confidence (0.5-0.8)**: Extracted data, partial patterns
- **Low confidence (<0.5)**: Default/unknown outcomes

Example:
```json
{
  "outcome": "interested",
  "confidence": 0.85,
  "reason": "Prospect expressed interest"
}
```

---

## Files

### **call-outcome-types.ts**
Type definitions:
- `CallOutcome` — Full outcome record
- `OutcomeValue` — Union of outcome types
- `RecommendedAction` — Suggested next action
- `OutcomeDetectionResult` — Result of detection

### **call-outcome-builder.ts**
Rule-based detection:
- `detectOutcome()` — Classify conversation into outcome
- `isVoicemail()` — Heuristic: short call or no agent messages
- `isWrongNumber()` — Heuristic: short call + confusion keywords
- `inferOutcomeFromExtractedData()` — Use ElevenLabs extracted data
- Keyword matching and pattern detection

### **call-outcome-store.ts**
In-memory storage:
- `saveOutcome()` — Store outcome
- `getOutcome()` — Get by outcomeId
- `getOutcomeByConversationId()` — Get by conversation
- `getAllOutcomes()` — Get all outcomes
- `getOutcomesByWorkerBrief()` — Get outcomes by brief
- `getOutcomeCounts()` — Distribution stats

### **call-outcome-processor.ts**
Orchestration:
- `buildCallOutcomeFromConversation()` — Create outcome object
- `processAndStoreOutcome()` — Build + store outcome
- `getOutcomeStats()` — Calculate statistics
- Wired into webhook processor

---

## Integration with Webhook Processor

When a webhook arrives:

1. **Webhook received** → `POST /api/webhooks/elevenlabs`
2. **Validate structure** → `isPostCallTranscriptionWebhook()`
3. **Check for duplicate** → (event_timestamp, conversation_id)
4. **Save conversation** → `conversationStore.saveConversation()`
5. **Lookup WorkerBriefId** → `mappingStore.getWorkerBriefId()` (if mapping exists)
6. **Generate CallOutcome** → `processAndStoreOutcome(conversation, workerBriefId)`
7. **Return HTTP 200** → Webhook acked

```typescript
// In elevenlabs-event-processor.ts
const conversation = conversationStore.saveConversation(...);
const workerBriefId = mappingStore.getWorkerBriefId(conversationId);
processAndStoreOutcome(conversation, workerBriefId);  // ← NEW
```

---

## API Endpoints

### **GET /api/outcomes**
Get all outcomes and statistics.

**Response**:
```json
{
  "totalOutcomes": 5,
  "outcomes": [
    {
      "outcomeId": "outcome_abc123",
      "conversationId": "conv_xyz789",
      "workerBriefId": "brief_xyz_789",
      "outcome": "interested",
      "confidence": 0.85,
      "summary": "Prospect interested in demo",
      "recommendedAction": "schedule_demo",
      "callDuration": 287,
      "createdAt": "2026-06-06T..."
    }
  ],
  "statistics": {
    "totalOutcomes": 5,
    "outcomeDistribution": {
      "interested": 2,
      "callback_requested": 1,
      "voicemail": 1,
      "unknown": 1
    },
    "averageConfidence": 0.82,
    "recommendedActions": {
      "schedule_demo": 2,
      "schedule_callback": 1,
      "retry_call": 1,
      "follow_up": 1
    }
  }
}
```

### **GET /api/outcomes/[conversationId]**
Get outcome for specific conversation.

**Response**:
```json
{
  "outcomeId": "outcome_abc123",
  "conversationId": "conv_xyz789",
  "workerBriefId": "brief_xyz_789",
  "outcome": "interested",
  "confidence": 0.85,
  "summary": "Prospect interested in demo",
  "recommendedAction": "schedule_demo",
  "callDuration": 287,
  "transcriptLength": 12,
  "createdAt": "2026-06-06T..."
}
```

**Returns 404** if outcome not found.

---

## Example Flows

### **Flow 1: Interested Prospect**

**Conversation**:
```json
{
  "summary": "Prospect very interested in demo. Asked about pricing and timeline.",
  "transcript": [
    { "role": "agent", "message": "Hi, I'm calling about our platform..." },
    { "role": "user", "message": "Oh interesting, tell me more" },
    { "role": "agent", "message": "We help companies..." },
    { "role": "user", "message": "Sounds great. I'd love to see a demo." }
  ],
  "callDuration": 287
}
```

**Outcome Generated**:
```json
{
  "outcome": "interested",
  "confidence": 0.85,
  "reason": "Prospect expressed interest and interest keywords detected",
  "recommendedAction": "schedule_demo"
}
```

### **Flow 2: Voicemail**

**Conversation**:
```json
{
  "summary": "Went to voicemail. Left message.",
  "transcript": [],
  "callDuration": 5
}
```

**Outcome Generated**:
```json
{
  "outcome": "voicemail",
  "confidence": 0.95,
  "reason": "Call very short with no agent messages",
  "recommendedAction": "retry_call"
}
```

### **Flow 3: Callback Requested**

**Conversation**:
```json
{
  "summary": "Prospect busy right now but wants to talk next week.",
  "transcript": [
    { "role": "agent", "message": "Hi, do you have 5 minutes?" },
    { "role": "user", "message": "Not right now, but call me back next week?" }
  ],
  "callDuration": 35
}
```

**Outcome Generated**:
```json
{
  "outcome": "callback_requested",
  "confidence": 0.9,
  "reason": "Callback keywords detected",
  "recommendedAction": "schedule_callback"
}
```

### **Flow 4: Wrong Number**

**Conversation**:
```json
{
  "summary": "Wrong number. Person confused about call.",
  "transcript": [
    { "role": "agent", "message": "Hi, is this John?" },
    { "role": "user", "message": "Who is this? Wrong number." }
  ],
  "callDuration": 8
}
```

**Outcome Generated**:
```json
{
  "outcome": "wrong_number",
  "confidence": 0.85,
  "reason": "Short call with confusion keywords",
  "recommendedAction": "remove_list"
}
```

---

## Data Flow: Complete Example

**Initial State**:
- WorkerBrief: `brief_qual_001` (objective: qualify lead)
- Dispatch to ElevenLabs
- Returns: `conversationId = "conv_2301kte0f59"`
- Register mapping: `conv_2301kte0f59 ↔ brief_qual_001`

**Call Happens** (real-time):
- ElevenLabs agent talks to prospect
- Prospect says: "Sounds great, I'm definitely interested"
- Call ends

**Webhook Arrives**:
```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1717687200,
  "data": {
    "conversation_id": "conv_2301kte0f59",
    "agent_id": "agent_veya",
    "status": "done",
    "summary": "Prospect interested in product",
    "transcript": [{"role": "agent", "message": "Hi..."}, ...],
    "call_duration": 287
  }
}
```

**Processing**:
1. Save conversation
2. Look up mapping: `brief_qual_001`
3. Detect outcome: **"interested"** (confidence: 0.85)
4. Build CallOutcome:
   ```json
   {
     "outcomeId": "outcome_abc123",
     "conversationId": "conv_2301kte0f59",
     "workerBriefId": "brief_qual_001",
     "outcome": "interested",
     "confidence": 0.85,
     "recommendedAction": "schedule_demo"
   }
   ```
5. Store outcome
6. Return HTTP 200

**API Response** (`GET /api/outcomes/conv_2301kte0f59`):
```json
{
  "outcomeId": "outcome_abc123",
  "conversationId": "conv_2301kte0f59",
  "workerBriefId": "brief_qual_001",
  "outcome": "interested",
  "confidence": 0.85,
  "summary": "Prospect interested in product",
  "recommendedAction": "schedule_demo",
  "callDuration": 287
}
```

---

## Future Phases

### **Phase 12A-5**: Integration Testing
- Test outcome detection with real conversation data
- Verify all outcome rules
- Confidence score validation

### **Phase 12A-6**: Production Testing
- Monitor outcome accuracy in production
- Gather feedback from sales team
- Adjust keyword sets and rules based on real data

### **Phase 12B**: Persistence
- Move in-memory stores to Supabase
- Create `call_outcomes` table
- Enable outcome history and analytics

### **Phase 12C**: Memory Integration
- Use outcomes to update WorkerBrief memory
- Learn from outcome patterns
- Adjust strategy based on success rates

### **Phase 12D**: UI Dashboard
- View outcomes by brief
- See outcome distribution
- Track callback schedule

---

## Limitations (Phase 12A-4)

⚠️ **In-memory only**: Outcomes lost on process restart  
⚠️ **No persistence**: Cannot query historical outcomes  
⚠️ **Rules-based**: No ML or adaptive learning  
⚠️ **English only**: Keyword matching not localized  
⚠️ **Simple heuristics**: No complex conversation understanding  

**Phase 12B will address**: Supabase persistence, outcome audit trail

---

## Code Quality

- ✅ Type-safe (TypeScript strict mode)
- ✅ Deterministic (same input = same output)
- ✅ No external dependencies (no LLM, no AI)
- ✅ Observable (logging in development)
- ✅ Testable (pure functions)
- ✅ Integrated (wired into webhook processor)

---

## Summary

**Phase 12A-4 adds the outcome layer** that converts conversations into business intelligence.

Before: Call ends → Webhook arrives → Conversation stored → No action  
After: Call ends → Webhook arrives → Conversation + Outcome stored → Recommended action generated

The outcome system is:
- ✅ Deterministic (rules-based, reproducible)
- ✅ Observable (statistics endpoint shows distribution)
- ✅ Integrated (automatic when webhook arrives)
- ✅ Extensible (easy to add new outcome types or keywords)
- ✅ Ready for Phase 12B (persistence to Supabase)
