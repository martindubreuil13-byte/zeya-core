# ElevenLabs Webhook Event Ingestion — Phase 12A-2

**Status**: In-Memory Event Processing (No Persistence)

## Overview

This layer receives and processes ElevenLabs call lifecycle events. Events flow through validators, are processed through a coordinator, and stored in in-memory caches.

**No database writes. No persistence. Pure event flow.**

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ ElevenLabs Service                                           │
│ (Real world: call happening, agent talking to prospect)     │
└───────────────────────┬──────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────────┐
         │ session_created webhook payload  │
         └───────────────┬──────────────────┘
                         ↓
         ┌──────────────────────────────────────────┐
         │ POST /api/webhooks/elevenlabs            │
         │ (Route handler)                          │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │ Parse JSON payload                       │
         │ Error handling for malformed requests    │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │ isValidElevenLabsEvent()                 │
         │ Type guard: validates structure          │
         └──────────────┬───────────────────────────┘
                        ↓ (valid)
         ┌──────────────────────────────────────────┐
         │ processElevenLabsEvent()                 │
         │ Routes to handler based on event type    │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │ BRANCH 1: session_created                │
         │ → sessionStore.createSession()           │
         │                                          │
         │ BRANCH 2: session_started                │
         │ → sessionStore.startSession()            │
         │                                          │
         │ BRANCH 3: session_ended                  │
         │ → sessionStore.endSession()              │
         │ → transcriptStore.captureTranscript()    │
         │ → outcomeStore.saveOutcome()             │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │ ProcessedEvent (success/failure result)  │
         └──────────────┬───────────────────────────┘
                        ↓
         ┌──────────────────────────────────────────┐
         │ Return JSON response (200 or 400)        │
         │ { success, eventType, sessionId, ... }   │
         └──────────────────────────────────────────┘
```

---

## Modules

### 1. Event Types (`elevenlabs-event-types.ts`)

Defines TypeScript interfaces for three event types:

#### `ElevenLabsSessionCreated`
```typescript
{
  event_type: "session_created",
  session_id: string,
  agent_id: string,
  status: string,
  phone_number_called?: string,
  from_number?: string,
  timestamp: string
}
```

#### `ElevenLabsSessionStarted`
```typescript
{
  event_type: "session_started",
  session_id: string,
  agent_id: string,
  started_at: string,
  timestamp: string
}
```

#### `ElevenLabsSessionEnded`
```typescript
{
  event_type: "session_ended",
  session_id: string,
  agent_id: string,
  ended_at: string,
  duration_secs?: number,
  reason?: string,
  timestamp: string,
  transcript?: {
    text: string,
    segments?: Array<{
      speaker: "agent" | "customer",
      text: string,
      timestamp?: number
    }>
  },
  call_summary?: {
    outcome_type?: string,      // "interested", "not_interested", etc.
    sentiment?: string,         // "positive", "neutral", "negative"
    key_points?: string[],
    next_action?: string
  }
}
```

### 2. Event Validator (`elevenlabs-event-validator.ts`)

Type guards for discriminating event types:

- `isSessionCreated(event): boolean`
- `isSessionStarted(event): boolean`
- `isSessionEnded(event): boolean`
- `isValidElevenLabsEvent(event): boolean` — accepts any of the three

### 3. Session Store (`call-session-store.ts`)

In-memory Map-based store tracking session lifecycle:

```typescript
CallSession {
  sessionId: string,
  agentId: string,
  status: "created" | "started" | "ended",
  phoneNumberCalled?: string,
  fromNumber?: string,
  createdAt: string,
  startedAt?: string,
  endedAt?: string,
  duration?: number
}
```

**Functions**:
- `createSession()` — Sets status="created"
- `startSession()` — Sets status="started", records startedAt
- `endSession()` — Sets status="ended", records duration
- `getSession(sessionId)` — Retrieves session or null
- `getAllSessions()` — Returns all tracked sessions
- `hasSession(sessionId)` — Boolean check
- `clear()` — Clears all sessions (for testing)

### 4. Transcript Store (`transcript-capture.ts`)

In-memory Map-based store for call transcripts:

```typescript
CapturedTranscript {
  sessionId: string,
  fullText: string,
  segments: Array<{
    speaker: "agent" | "customer",
    text: string,
    timestamp?: number
  }>,
  capturedAt: string
}
```

**Functions**:
- `captureTranscript(sessionId, fullText, segments)` — Stores transcript
- `getTranscript(sessionId)` — Retrieves or null
- `hasTranscript(sessionId)` — Boolean check
- `getAllTranscripts()` — Returns all transcripts
- `clear()` — Clears all (for testing)

### 5. Outcome Store (`call-outcome-store.ts`)

In-memory Map-based store for call results:

```typescript
StoredCallOutcome {
  sessionId: string,
  outcome?: string,           // "interested", "not_interested", etc.
  sentiment?: string,         // "positive", "neutral", "negative"
  duration?: number,
  keyPoints?: string[],
  nextAction?: string,
  storedAt: string
}
```

**Functions**:
- `saveOutcome(sessionId, outcome, sentiment, duration, keyPoints, nextAction)`
- `getOutcome(sessionId)` — Retrieves or null
- `hasOutcome(sessionId)` — Boolean check
- `getAllOutcomes()` — Returns all outcomes
- `clear()` — Clears all (for testing)

### 6. Event Processor (`elevenlabs-event-processor.ts`)

Orchestrates event handling:

```typescript
processElevenLabsEvent(event: unknown): ProcessedEvent

ProcessedEvent {
  success: boolean,
  eventType: string,
  sessionId: string,
  message: string
}
```

**Flow**:
1. `session_created` event
   - Call `sessionStore.createSession()`
   - Return success

2. `session_started` event
   - Look up session by ID
   - Call `sessionStore.startSession()`
   - Return success or "not found" error

3. `session_ended` event
   - Look up session by ID
   - Call `sessionStore.endSession(duration)`
   - If transcript provided: call `transcriptStore.captureTranscript()`
   - If call_summary provided: call `outcomeStore.saveOutcome()`
   - Return success or "not found" error

**Helper functions**:
- `getSessionState(sessionId)` — Returns { session, transcript, outcome }
- `getAllState()` — Returns { sessions, transcripts, outcomes }
- `clearAllState()` — Clears all stores (for testing)

### 7. Webhook Route (`app/api/webhooks/elevenlabs/route.ts`)

HTTP POST endpoint:

**Request**:
```json
{
  "event_type": "session_ended",
  "session_id": "session_abc123",
  ...
}
```

**Response (Success)**:
```json
{
  "success": true,
  "eventType": "session_ended",
  "sessionId": "session_abc123",
  "message": "Session ended: session_abc123 (duration: 287s)"
}
```

**Response (Invalid Event)**:
```json
{
  "success": false,
  "error": "Invalid event structure"
}
```

---

## Example Call Lifecycle

### 1. Call Initiated by Zeya

(Not part of webhook, but context)

```typescript
// Zeya calls ElevenLabs API to initiate call
POST /v1/convai/agents/{agentId}/sessions
{
  "phone": {
    "phone_number_to_dial": "+1-555-0100",
    "from_number": "+1-555-5555"
  },
  ...
}
// Response: { session_id: "session_abc123" }
```

### 2. ElevenLabs Sends `session_created`

```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "session_created",
    "session_id": "session_abc123",
    "agent_id": "agent_xyz",
    "status": "queued",
    "phone_number_called": "+1-555-0100",
    "from_number": "+1-555-5555",
    "timestamp": "2026-06-06T10:30:00Z"
  }'
```

**Response**:
```json
{
  "success": true,
  "eventType": "session_created",
  "sessionId": "session_abc123",
  "message": "Session created: session_abc123"
}
```

**Internal State**:
```typescript
sessionStore.getSession("session_abc123")
// {
//   sessionId: "session_abc123",
//   agentId: "agent_xyz",
//   status: "created",
//   phoneNumberCalled: "+1-555-0100",
//   fromNumber: "+1-555-5555",
//   createdAt: "2026-06-06T10:30:00Z"
// }
```

### 3. ElevenLabs Sends `session_started`

```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "session_started",
    "session_id": "session_abc123",
    "agent_id": "agent_xyz",
    "started_at": "2026-06-06T10:30:05Z",
    "timestamp": "2026-06-06T10:30:05Z"
  }'
```

**Response**:
```json
{
  "success": true,
  "eventType": "session_started",
  "sessionId": "session_abc123",
  "message": "Session started: session_abc123"
}
```

**Internal State**:
```typescript
sessionStore.getSession("session_abc123")
// {
//   ...,
//   status: "started",
//   startedAt: "2026-06-06T10:30:05Z"
// }
```

### 4. ElevenLabs Sends `session_ended`

```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "session_ended",
    "session_id": "session_abc123",
    "agent_id": "agent_xyz",
    "ended_at": "2026-06-06T10:35:00Z",
    "duration_secs": 287,
    "reason": "customer_hangup",
    "timestamp": "2026-06-06T10:35:00Z",
    "transcript": {
      "text": "Agent: Hi Jane, this is Veya... Customer: Hi thanks for calling...",
      "segments": [
        {
          "speaker": "agent",
          "text": "Hi Jane, this is Veya with Zeya. Do you have a few minutes?"
        },
        {
          "speaker": "customer",
          "text": "Hi! Thanks for calling. Yes, I do."
        },
        {
          "speaker": "agent",
          "text": "Great! I wanted to follow up on those leads you downloaded..."
        },
        {
          "speaker": "customer",
          "text": "Oh yes, they were really helpful!"
        }
      ]
    },
    "call_summary": {
      "outcome_type": "interested",
      "sentiment": "positive",
      "key_points": ["wants demo", "budget approved for next quarter"],
      "next_action": "send product demo link and schedule follow-up"
    }
  }'
```

**Response**:
```json
{
  "success": true,
  "eventType": "session_ended",
  "sessionId": "session_abc123",
  "message": "Session ended: session_abc123 (duration: 287s)"
}
```

**Internal State — Session**:
```typescript
sessionStore.getSession("session_abc123")
// {
//   sessionId: "session_abc123",
//   agentId: "agent_xyz",
//   status: "ended",
//   phoneNumberCalled: "+1-555-0100",
//   fromNumber: "+1-555-5555",
//   createdAt: "2026-06-06T10:30:00Z",
//   startedAt: "2026-06-06T10:30:05Z",
//   endedAt: "2026-06-06T10:35:00Z",
//   duration: 287
// }
```

**Internal State — Transcript**:
```typescript
transcriptStore.getTranscript("session_abc123")
// {
//   sessionId: "session_abc123",
//   fullText: "Agent: Hi Jane...",
//   segments: [...],
//   capturedAt: "2026-06-06T10:35:00Z"
// }
```

**Internal State — Outcome**:
```typescript
outcomeStore.getOutcome("session_abc123")
// {
//   sessionId: "session_abc123",
//   outcome: "interested",
//   sentiment: "positive",
//   duration: 287,
//   keyPoints: ["wants demo", "budget approved for next quarter"],
//   nextAction: "send product demo link and schedule follow-up",
//   storedAt: "2026-06-06T10:35:00Z"
// }
```

**Full State**:
```typescript
getSessionState("session_abc123")
// {
//   session: { ...CallSession... },
//   transcript: { ...CapturedTranscript... },
//   outcome: { ...StoredCallOutcome... }
// }
```

---

## Testing

### Test Scenario: Complete Call Lifecycle

```typescript
import { processElevenLabsEvent, getSessionState, clearAllState } from "@/lib/voice/events";

// Clear previous state
clearAllState();

// 1. Session created
const created = processElevenLabsEvent({
  event_type: "session_created",
  session_id: "session_test_001",
  agent_id: "agent_xyz",
  status: "queued",
  timestamp: new Date().toISOString(),
});
expect(created.success).toBe(true);

// 2. Session started
const started = processElevenLabsEvent({
  event_type: "session_started",
  session_id: "session_test_001",
  agent_id: "agent_xyz",
  started_at: new Date().toISOString(),
  timestamp: new Date().toISOString(),
});
expect(started.success).toBe(true);

// 3. Session ended
const ended = processElevenLabsEvent({
  event_type: "session_ended",
  session_id: "session_test_001",
  agent_id: "agent_xyz",
  ended_at: new Date().toISOString(),
  duration_secs: 287,
  timestamp: new Date().toISOString(),
  transcript: {
    text: "Full conversation...",
    segments: [
      { speaker: "agent", text: "Hi..." },
      { speaker: "customer", text: "Hello..." },
    ],
  },
  call_summary: {
    outcome_type: "interested",
    sentiment: "positive",
    key_points: ["wants demo"],
    next_action: "send demo",
  },
});
expect(ended.success).toBe(true);

// Verify full state
const state = getSessionState("session_test_001");
expect(state.session).toBeDefined();
expect(state.session?.status).toBe("ended");
expect(state.session?.duration).toBe(287);
expect(state.transcript).toBeDefined();
expect(state.transcript?.fullText).toBe("Full conversation...");
expect(state.outcome).toBeDefined();
expect(state.outcome?.outcome).toBe("interested");
```

---

## Future Integration: Persistence (Phase 12B)

### Supabase Tables Required

```sql
CREATE TABLE elevenlabs_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  phone_number_called TEXT,
  from_number TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_seconds INTEGER,
  created_timestamp TIMESTAMP
);

CREATE TABLE call_transcripts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES elevenlabs_sessions(session_id),
  full_text TEXT NOT NULL,
  segments JSONB NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE call_outcomes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES elevenlabs_sessions(session_id),
  outcome_type TEXT,
  sentiment TEXT,
  key_points TEXT[],
  next_action TEXT,
  stored_at TIMESTAMP DEFAULT NOW()
);
```

### Migration Path

**Phase 12A** (Current):
- ✅ Receive events
- ✅ Validate events
- ✅ In-memory storage
- ✅ Return success/failure

**Phase 12B** (Next):
- [ ] Replace sessionStore with Supabase queries
- [ ] Replace transcriptStore with Supabase writes
- [ ] Replace outcomeStore with Supabase writes
- [ ] Add error handling for DB failures
- [ ] Keep in-memory cache for fast lookups (optional)

**Simple swap**:
```typescript
// Before (Phase 12A)
const session = sessionStore.getSession(sessionId);

// After (Phase 12B)
const session = await supabase
  .from("elevenlabs_sessions")
  .select("*")
  .eq("session_id", sessionId)
  .single();
```

---

## Future Enhancement: Webhook Signature Verification (Phase 12B)

Currently: Accept any JSON POST

Future: Verify HMAC-SHA256 signature

```typescript
// Not implemented yet
const signature = req.headers.get("x-elevenlabs-signature");
const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

// Verify: crypto.timingSafeEqual(signature, computed)
// If invalid: return 401 Unauthorized
```

---

## Files Summary

### Created (8 files)

1. **lib/voice/events/elevenlabs-event-types.ts** (47 lines)
   - ElevenLabsSessionCreated
   - ElevenLabsSessionStarted
   - ElevenLabsSessionEnded
   - ElevenLabsEvent union type

2. **lib/voice/events/elevenlabs-event-validator.ts** (37 lines)
   - isSessionCreated()
   - isSessionStarted()
   - isSessionEnded()
   - isValidElevenLabsEvent()

3. **lib/voice/events/call-session-store.ts** (66 lines)
   - CallSession interface
   - SessionStore class (in-memory Map)
   - createSession(), startSession(), endSession(), getSession()

4. **lib/voice/events/transcript-capture.ts** (56 lines)
   - TranscriptSegment interface
   - CapturedTranscript interface
   - TranscriptStore class (in-memory Map)
   - captureTranscript(), getTranscript()

5. **lib/voice/events/call-outcome-store.ts** (54 lines)
   - StoredCallOutcome interface
   - OutcomeStore class (in-memory Map)
   - saveOutcome(), getOutcome()

6. **lib/voice/events/elevenlabs-event-processor.ts** (159 lines)
   - processElevenLabsEvent()
   - processSessionCreated/Started/Ended()
   - getSessionState(), getAllState(), clearAllState()

7. **app/api/webhooks/elevenlabs/route.ts** (42 lines)
   - POST /api/webhooks/elevenlabs
   - JSON parsing, validation, processing
   - Error handling

8. **lib/voice/events/index.ts** (22 lines)
   - Exports all modules

**Total**: 383 lines of TypeScript

### No Files Modified

---

## Key Architectural Decisions

### 1. In-Memory Only (Phase 12A)
No database writes yet. Pure event flow. Simplifies testing and deployment.

**Rationale**: Decouple event ingestion from persistence. Phase 12B adds DB.

### 2. Type Guards Over Try-Catch
Use `isSessionCreated()` instead of try-catch for type discrimination.

**Rationale**: Explicit, type-safe, no exceptions for normal control flow.

### 3. Separate Stores
Three separate stores (session, transcript, outcome) instead of one monolithic store.

**Rationale**: 
- Sessions track lifecycle
- Transcripts store large text
- Outcomes capture result data
- Can migrate each independently to DB

### 4. Process-Level Caching
Each store is a singleton module-level variable, not per-request.

**Rationale**: Data lives across requests. Works for Phase 12A. Phase 12B replaces with persistent DB.

### 5. No Async/Await
All operations are synchronous (in-memory reads/writes).

**Rationale**: No I/O. Phase 12B will add async DB calls.

---

## Integration with Existing Zeya Systems

### Alignment with Existing Architecture

- ✅ Follows Next.js App Router pattern (`app/api/webhooks/elevenlabs/route.ts`)
- ✅ Uses TypeScript with strict types (matches codebase)
- ✅ Validates inputs before processing (matches security patterns)
- ✅ Returns structured responses (matches API conventions)
- ✅ No external dependencies beyond Next.js/TypeScript (matches philosophy)

### Connection Points (Phase 12B+)

- **WorkerBrief**: Session ID maps to workerBriefId (tracked separately)
- **CallOutcome**: outcomeStore data flows into CallOutcome builder
- **Memory Events**: Outcomes trigger MemoryEvent creation (Phase 12C)
- **Zeya Orchestration**: Outcomes inform next ExecutionPlan (Phase 13)

---

## What's Next

### Phase 12A-3: WorkerBrief → ElevenLabs Dispatch
- Implement ElevenLabsProvider
- Call ElevenLabs API to initiate outbound call
- Store session ID for webhook correlation

### Phase 12A-4: Webhook → CallOutcome Conversion
- Look up WorkerBrief by session ID
- Build CallOutcome from webhook data + brief context
- (Persist to database in Phase 12B)

### Phase 12B: Persistence
- Replace in-memory stores with Supabase tables
- Add webhook signature verification
- Implement TTL/cleanup for old sessions

---

**Phase 12A-2 Status**: ✅ Complete

All event handling infrastructure in place. Ready for dispatch (Phase 12A-3) and outcome conversion (Phase 12A-4).
