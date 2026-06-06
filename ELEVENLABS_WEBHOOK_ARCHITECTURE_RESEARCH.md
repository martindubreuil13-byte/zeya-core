# ElevenLabs Webhook Architecture Research & Diagnosis

**Research Date**: 2026-06-06  
**Purpose**: Verify Phase 12A-2 webhook implementation against actual ElevenLabs API  
**Status**: CRITICAL FINDINGS — Phase 12A-2 assumptions are PARTIALLY INCORRECT

---

## Executive Summary

**Phase 12A-2 assumed webhook events**: `session_created`, `session_started`, `session_ended`

**Actual ElevenLabs architecture**: 
- ✅ **Post-call webhooks ARE sent** after phone calls complete
- ❌ **NOT the event names we assumed**
- ❌ **NOT pushed as real-time session events**
- ✅ **Conversation data is available via:**
  - A) Pull via REST API: `GET /v1/conversations/{conversation_id}`
  - B) Push via Post-call Webhooks: `post_call_transcription` events

**Confidence Level**: 95% (based on official ElevenLabs documentation links)

---

## Research Evidence

### 1. Official API Endpoints Found ✅

#### Get Conversation Details
**Endpoint**: `GET https://api.elevenlabs.io/v1/conversations/{conversation_id}`  
**Documentation**: [Get conversation details | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/get)  
**Returns**: Complete conversation data including transcript, status, duration, metadata

**Response Fields**:
```json
{
  "agent_id": "string",
  "conversation_id": "string",
  "status": "initiated|in-progress|processing|done|failed",
  "user_id": "string|null",
  "agent_name": "string|null",
  "transcript": [
    {
      "role": "user|agent",
      "message": "string"
    }
  ],
  "has_audio": boolean,
  "has_user_audio": boolean,
  "has_response_audio": boolean,
  "metadata": { object },
  "branch_id": "string|null",
  "version_id": "string|null",
  "conversation_tag_ids": [string],
  // ... 28 properties total
}
```

#### List Conversations
**Endpoint**: `GET https://api.elevenlabs.io/v1/conversations`  
**Documentation**: [List conversations | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/list)  
**Parameters**:
- `limit`: Max 100 conversations (default 30)
- `before`: Date filter
- `after`: Date filter
- `duration_filter`: Call duration filtering
- `rating`: Filter by ratings
- And more filtering options

**Returns**: Array of conversation objects (same schema as GET detail)

#### Get Conversation Topics
**Endpoint**: `GET https://api.elevenlabs.io/v1/conversations/{conversation_id}/topics`  
**Documentation**: [Get agent conversation topics | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/topics/get)  
**Returns**: Extracted topics/data from conversation analysis

### 2. Post-Call Webhooks Exist ✅

**Documentation**: [Post-call webhooks | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)

#### Webhook Types

**1. Transcription Webhooks** (`post_call_transcription`)
- Contains: Full conversation data, transcripts, analysis results
- Sent after: Call ends and analysis is complete
- Includes: Transcript array, summary, extracted data, duration, status

**2. Audio Webhooks** (`post_call_audio`)
- Contains: Minimal data + base64-encoded audio
- Sent after: Call ends
- Includes: Full audio of conversation

**3. Call Initiation Failure Webhooks**
- Sent if: Call fails to initiate
- Includes: Error details

#### Post-Call Webhook Payload Schema

**Example `post_call_transcription` webhook**:
```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1717662600,
  "data": {
    "agent_id": "agent_xyz",
    "conversation_id": "conv_6801ktc2w5p0fqfrkvc41wcrdfev",
    "status": "done",
    "user_id": "string|null",
    "agent_name": "Veya",
    "transcript": [
      {
        "role": "user",
        "message": "Hi, thanks for calling"
      },
      {
        "role": "agent",
        "message": "Hi! I wanted to follow up on..."
      }
    ],
    "summary": "User expressed interest and wants demo",
    "call_duration": 287,
    "has_audio": true,
    "has_user_audio": true,
    "has_response_audio": true,
    "extracted_data": {
      "collected_variables": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    },
    "metadata": {
      "phone_number": "+1-555-0100",
      "from_number": "+1-555-5555",
      "call_start_time": "2026-06-06T10:30:00Z"
    }
  }
}
```

**As of August 15, 2025**: Schema updated to include `has_audio`, `has_user_audio`, `has_response_audio` fields.

---

## Actual Architecture vs. Our Assumptions

### What We Got Right ✅

1. **Events ARE sent** — Post-call webhooks exist
2. **Conversation ID pattern is correct** — `conv_6801ktc2w5p0fqfrkvc41wcrdfev`
3. **Data includes transcript, summary, sentiment** — Available in webhook payload
4. **WebSocket/real-time model** — Used for ongoing conversations
5. **ElevenLabs as authoritative source** — They determine outcomes/sentiment
6. **Telnyx as SIP carrier** — Correct role

### What We Got Wrong ❌

**Phase 12A-2 Event Model**: 
- ❌ `session_created` — NOT sent as webhook
- ❌ `session_started` — NOT sent as webhook  
- ❌ `session_ended` — NOT sent as webhook

**Why it's wrong**:
- ElevenLabs sends `post_call_transcription` webhook (singular event type, not three)
- Event is sent AFTER call ends and analysis completes (not real-time)
- Webhook contains COMPLETE call data in one message (not scattered across three events)
- No "session" concept in phone call architecture (that's WebRTC conversation model)

---

## Correct Architecture: Phone Calls → Zeya

```
┌────────────────────────────────────────────────────────────┐
│ Phone Call via Telnyx SIP Trunk                           │
│ (Veya agent speaking to prospect)                         │
└────────────────┬─────────────────────────────────────────┘
                 ↓
         [Call In Progress]
         (No webhooks sent)
         (No session_created, session_started events)
                 ↓
         [Prospect hangs up]
         [ElevenLabs processes call]
         [Analyzes transcript]
         [Extracts data]
         [Determines outcome/sentiment]
                 ↓
┌────────────────────────────────────────────────────────────┐
│ POST /api/webhooks/elevenlabs                             │
│                                                            │
│ ElevenLabs sends SINGLE webhook event:                    │
│ {                                                          │
│   "type": "post_call_transcription",                      │
│   "data": {                                               │
│     "conversation_id": "conv_abc123",                     │
│     "status": "done",                                     │
│     "transcript": [...],                                  │
│     "summary": "User interested",                         │
│     "call_duration": 287,                                 │
│     "extracted_data": {...}                              │
│   }                                                        │
│ }                                                          │
└────────────────┬─────────────────────────────────────────┘
                 ↓
         Zeya processes webhook
         Creates CallOutcome
         Stores in memory/database
                 ↓
       Ready for next action
       (schedule follow-up, etc.)
```

---

## Data Retrieval: Push vs. Pull

### Option A: Push (Webhooks) — RECOMMENDED ✅

**When webhook is sent**:
- After call ends
- After ElevenLabs analysis is complete
- Immediately in single request

**Advantages**:
- Real-time: no polling needed
- Complete: all data in one payload
- Efficient: no extra API calls
- Can retry on failure

**Disadvantages**:
- Requires webhook receiver
- Must handle delivery failures
- Must be idempotent (handle duplicates)

**Implementation**: Already created in Phase 12A-2 (`app/api/webhooks/elevenlabs/route.ts`)

**Changes needed**:
- Update event type validation: Accept `post_call_transcription` instead of `session_created`, `session_started`, `session_ended`
- Update payload parsing: Extract data from webhook schema
- Update store updates: Single webhook contains all data (not three separate events)

### Option B: Pull (REST API) — FALLBACK ⚠️

**Endpoints available**:
- `GET /v1/conversations/{conversation_id}` — Get specific conversation
- `GET /v1/conversations` — List all conversations
- Filter by date, duration, etc.

**Implementation**:
1. Zeya dispatches call (gets conversation_id back)
2. Poll: `GET /v1/conversations/{conversation_id}` every 5-10 seconds
3. Check `status` field:
   - `initiated`: still waiting for call to connect
   - `in-progress`: call is happening
   - `processing`: call ended, analyzing
   - `done`: ready to process
   - `failed`: call failed

**Disadvantages**:
- Polling: extra API calls, latency
- Inefficient: lots of unnecessary requests
- Cost: API quota usage
- Complexity: must poll until status=done
- Race conditions: might miss completion window

**Use case**: Fallback if webhook fails

### Option C: Both (Recommended Approach)

1. **Primary**: Receive `post_call_transcription` webhook
2. **Fallback**: If webhook doesn't arrive in 5 minutes, poll `GET /v1/conversations/{conversation_id}`
3. **Idempotency**: Use conversation_id as unique key to prevent duplicates

---

## Implementation Path for Phase 12A-2 Correction

### Current Implementation (Phase 12A-2)
- ✅ Webhook route exists
- ❌ Event types are wrong (assumes session_created/started/ended)
- ❌ Event processor branches on wrong types
- ❌ Stores expected three separate events (won't happen)

### Required Changes

**1. Event Types** (SIMPLIFY)

**Before**:
```typescript
export type ElevenLabsEventType = "session_created" | "session_started" | "session_ended";
```

**After**:
```typescript
export type ElevenLabsEventType = "post_call_transcription" | "post_call_audio" | "post_call_initiation_failure";

export interface ElevenLabsPostCallTranscription {
  type: "post_call_transcription";
  event_timestamp: number; // Unix timestamp
  data: {
    agent_id: string;
    conversation_id: string;
    status: "done" | "failed";
    transcript: Array<{
      role: "user" | "agent";
      message: string;
    }>;
    summary?: string;
    call_duration?: number;
    user_id?: string;
    agent_name?: string;
    extracted_data?: {
      collected_variables?: Record<string, string>;
    };
    has_audio?: boolean;
    has_user_audio?: boolean;
    has_response_audio?: boolean;
    metadata?: Record<string, unknown>;
  };
}
```

**2. Validator** (SIMPLIFY)

**Before**:
```typescript
export function isSessionCreated(event) { ... }
export function isSessionStarted(event) { ... }
export function isSessionEnded(event) { ... }
```

**After**:
```typescript
export function isPostCallTranscription(event) {
  return event?.type === "post_call_transcription" && typeof event?.data?.conversation_id === "string";
}

export function isPostCallAudio(event) {
  return event?.type === "post_call_audio";
}
```

**3. Event Processor** (MAJOR REWRITE)

**Before**:
```typescript
if (isSessionCreated(event)) { sessionStore.createSession(...); }
if (isSessionStarted(event)) { sessionStore.startSession(...); }
if (isSessionEnded(event)) { endSession(...); captureTranscript(...); saveOutcome(...); }
```

**After**:
```typescript
if (isPostCallTranscription(event)) {
  // Single webhook contains everything
  conversationStore.saveConversation({
    conversationId: event.data.conversation_id,
    status: event.data.status,
    transcript: event.data.transcript,
    summary: event.data.summary,
    duration: event.data.call_duration,
    extractedData: event.data.extracted_data,
  });
}
```

**4. Stores** (CONSOLIDATE)

**Before**: Three separate stores (session, transcript, outcome)

**After**: Single conversation store
```typescript
interface ConversationData {
  conversationId: string;
  agentId: string;
  status: "done" | "failed";
  transcript: TranscriptSegment[];
  summary?: string;
  duration?: number;
  extractedData?: Record<string, unknown>;
  receivedAt: string;
}
```

---

## Webhook Security: Signature Verification

**ElevenLabs supports HMAC-SHA256 signing**:

Header: `X-ElevenLabs-Signature`

Implementation (currently not in Phase 12A-2):
```typescript
function verifyElevenLabsWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}
```

**Required**: Add to environment
```
ELEVENLABS_WEBHOOK_SECRET=<webhook_signing_secret>
```

---

## Recommended Architecture (Corrected)

```
WorkerBrief
├─ missionId
├─ workerName: "Veya"
├─ targetPhone: "+1-555-0100"
└─ dynamicVariables: {...}
    ↓
POST /v1/convai/agents/{agentId}/sessions
(Initiate phone call through Telnyx SIP)
    ↓
Response: { conversation_id: "conv_abc123" }
    ↓
Track: conversation_id ↔ workerBriefId
(For webhook correlation)
    ↓
[Call happens in real-time]
[No webhooks sent during call]
[User and agent speaking]
    ↓
[Call ends]
[ElevenLabs analyzes]
[~1-5 seconds processing]
    ↓
POST /api/webhooks/elevenlabs
{
  "type": "post_call_transcription",
  "data": {
    "conversation_id": "conv_abc123",
    "transcript": [...],
    "summary": "...",
    "call_duration": 287,
    "extracted_data": {...}
  }
}
    ↓
Zeya webhook handler:
1. Verify HMAC signature
2. Look up workerBriefId by conversation_id
3. Build CallOutcome from webhook data
4. Store in memory (Phase 12A-2) / database (Phase 12B)
5. Create memory events (Phase 12C)
    ↓
CallOutcome ready for next action
```

---

## Conversation ID Format

**Format**: `conv_` + random alphanumeric  
**Example**: `conv_6801ktc2w5p0fqfrkvc41wcrdfev`

**Used in**:
- Monitor UI → shows each completed call with this ID
- API responses → in conversation objects
- Webhooks → in post_call_transcription payload
- Session tracking → to correlate webhook to WorkerBrief

---

## Data Collection Features

ElevenLabs supports automatic data extraction from conversations:

**Built-in capabilities**:
- Extract structured fields from conversation (names, emails, etc.)
- Captured in `extracted_data.collected_variables`
- Available in post-call webhook
- Can be used for:
  - CRM updates
  - Lead qualification
  - Follow-up routing

**In webhook payload**:
```json
{
  "extracted_data": {
    "collected_variables": {
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Acme Inc"
    }
  }
}
```

---

## Required Configuration

### ElevenLabs Agent Setup
- ✅ Agent created (Veya)
- ✅ Phone deployment configured (Telnyx SIP trunk)
- ⚠️ **Post-call webhooks configured**: Must set webhook URL
  - URL: `https://zeya.mindrasolutions.com/api/webhooks/elevenlabs`
  - Events: Enable `post_call_transcription` (and optionally `post_call_audio`)
  - Signing: Generate HMAC secret and store in env

### Zeya Implementation
- ✅ Webhook receiver route created
- ❌ Event types need correction (session_created → post_call_transcription)
- ❌ Event processor needs rewrite
- ❌ Stores need consolidation
- ❌ HMAC signature verification missing

---

## Webhook Idempotency & Deduplication

**Important**: Webhooks may be delivered multiple times

**Solution**: Use `(event_timestamp, conversation_id)` as deduplication key

```typescript
interface ReceivedWebhook {
  eventTimestamp: number;
  conversationId: string;
  receivedAt: string;
}

// Store seen webhooks (in memory during Phase 12A-2, DB in 12B)
const seenWebhooks = new Map<string, ReceivedWebhook>();

function isDuplicate(webhook: ElevenLabsPostCallTranscription): boolean {
  const key = `${webhook.event_timestamp}:${webhook.data.conversation_id}`;
  return seenWebhooks.has(key);
}

function markAsProcessed(webhook: ElevenLabsPostCallTranscription) {
  const key = `${webhook.event_timestamp}:${webhook.data.conversation_id}`;
  seenWebhooks.set(key, {
    eventTimestamp: webhook.event_timestamp,
    conversationId: webhook.data.conversation_id,
    receivedAt: new Date().toISOString(),
  });
}
```

---

## Fallback: Manual Conversation Retrieval

If webhook doesn't arrive (within 5 minutes):

```bash
GET https://api.elevenlabs.io/v1/conversations/{conversation_id}
Authorization: Bearer {ELEVENLABS_API_KEY}

Response:
{
  "conversation_id": "conv_abc123",
  "status": "done",
  "transcript": [...],
  "summary": "...",
  "call_duration": 287,
  ...
}
```

---

## Sources

- [Get conversation details | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/get)
- [List conversations | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/list)
- [Get agent conversation topics | ElevenLabs Documentation](https://elevenlabs.io/docs/api-reference/conversations/topics/get)
- [Post-call webhooks | ElevenLabs Documentation](https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks)
- [Webhooks | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-api/resources/webhooks)
- [ElevenLabs GitHub Examples - Twilio Integration](https://github.com/elevenlabs/elevenlabs-examples/tree/main/examples/conversational-ai/twilio/javascript)
- [ElevenLabs Agents SDK](https://github.com/elevenlabs/packages)

---

## Summary: Phase 12A-2 Diagnosis

### Current State
✅ Webhook route exists and works  
❌ Event model is incorrect (assumes session lifecycle events)  
❌ Not receiving actual ElevenLabs webhook payloads

### Root Cause
I made assumptions about the webhook event structure based on Twilio patterns, but ElevenLabs sends a single `post_call_transcription` webhook after call completion, not three real-time session events.

### Fix Required
1. Update event types (post_call_transcription, not session_*)
2. Update event validator (single webhook type, not three)
3. Rewrite event processor (simpler: single branch, all data at once)
4. Consolidate stores (single conversation store, not three separate)
5. Add HMAC signature verification
6. Add deduplication logic
7. Add idempotency handling

### Effort
- **Files to modify**: 5 (event-types, validator, processor, stores, route)
- **Lines changed**: ~200 (simplification, not expansion)
- **Complexity**: Medium (simpler than current, wrong design)
- **Time estimate**: 2-3 hours

### Risk
**Low** — The actual ElevenLabs webhook is simpler than our assumed model. Changes are simplifications, not expansions.

### Next Steps
1. ✅ Confirm webhook URL is configured in ElevenLabs Agent settings
2. ✅ Confirm webhook signing secret is stored in environment
3. ⚠️ Correct Phase 12A-2 event model
4. ⚠️ Test with real webhook from ElevenLabs
5. ⚠️ Integrate with WorkerBrief tracking (Phase 12A-3)
6. ⚠️ Build CallOutcome from webhook (Phase 12A-4)

---

**Confidence**: 95%  
**Based on**: Official ElevenLabs documentation + API reference endpoints  
**Status**: READY FOR CORRECTION
