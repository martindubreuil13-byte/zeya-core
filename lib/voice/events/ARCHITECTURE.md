# ElevenLabs Post-Call Webhook Infrastructure — Phase 12A-2 (Corrected)

**Status**: In-Memory Post-Call Webhook Processing (No Persistence)

**Last Updated**: 2026-06-06 (Corrected from lifecycle event model to post-call webhook model)

---

## Overview

This layer receives and processes ElevenLabs post-call webhooks after phone calls complete. A single webhook containing the complete call data (transcript, summary, duration, extracted fields) is received after the call ends and analysis is complete.

**No database writes. No persistence. Pure event flow and in-memory storage.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ ElevenLabs Agent (Veya)                                     │
│ Call via Telnyx SIP Trunk → Prospect answers                │
│ Agent and prospect speak → Call ends                         │
└────────────────┬────────────────────────────────────────────┘
                 ↓
        [ElevenLabs Processing]
        - Transcript captured
        - Summary generated
        - Sentiment analyzed
        - Data extracted
        - (~1-5 seconds)
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ POST /api/webhooks/elevenlabs                               │
│ ElevenLabs sends single webhook:                            │
│                                                              │
│ {                                                            │
│   "type": "post_call_transcription",                        │
│   "event_timestamp": 1717662600,                            │
│   "data": {                                                  │
│     "conversation_id": "conv_abc123",                       │
│     "transcript": [...],                                    │
│     "summary": "User interested...",                        │
│     "call_duration": 287,                                   │
│     "extracted_data": {...}                                 │
│   }                                                          │
│ }                                                            │
└────────────────┬────────────────────────────────────────────┘
                 ↓
         [Signature Verification]
         HMAC-SHA256 (if secret configured)
                 ↓
         [Validation]
         Type guard: isPostCallTranscriptionWebhook()
                 ↓
         [Deduplication]
         Check event_timestamp + conversation_id
                 ↓
         [Storage]
         conversationStore.saveConversation()
         (in-memory Map)
                 ↓
         [Response]
         HTTP 200 OK with result
```

---

## Modules

### 1. Event Types (`elevenlabs-event-types.ts`)

Defines TypeScript interfaces for ElevenLabs webhooks:

#### `ElevenLabsPostCallTranscriptionWebhook`
```typescript
{
  type: "post_call_transcription",
  event_timestamp: number,  // Unix timestamp
  data: {
    conversation_id: string,      // e.g., "conv_abc123def"
    agent_id: string,
    status: "done" | "failed",
    transcript: Array<{
      role: "user" | "agent",
      message: string,
      timestamp?: number
    }>,
    summary?: string,
    call_duration?: number,
    extracted_data?: Record<string, unknown>,  // Collected vars
    has_audio?: boolean,
    has_user_audio?: boolean,
    has_response_audio?: boolean,
    user_id?: string,
    agent_name?: string,
    metadata?: Record<string, unknown>
  }
}
```

#### `ElevenLabsPostCallAudioWebhook`
- `type: "post_call_audio"`
- Contains base64-encoded audio of call
- Minimal metadata

#### `ElevenLabsPostCallInitiationFailureWebhook`
- `type: "post_call_initiation_failure"`
- Sent if call fails to initiate
- Contains error details

---

### 2. Event Validation (`elevenlabs-event-validator.ts`)

Type guards for discriminating webhook types:

- `isPostCallTranscriptionWebhook(event)` — True if valid post-call-transcription
- `isValidElevenLabsWebhook(event)` — True if any valid ElevenLabs webhook

**Validation checks**:
- `type` field matches expected value
- `event_timestamp` is a number
- Required `data` fields are present and correct types
- `transcript` is an array

---

### 3. Conversation Store (`elevenlabs-conversation-store.ts`)

In-memory Map-based store for complete post-call conversations:

```typescript
CapturedElevenLabsConversation {
  conversationId: string,
  agentId: string,
  status: "done" | "failed",
  transcript: Array<{ role, message, timestamp }>,
  summary?: string,
  callDuration?: number,
  extractedData?: Record<string, unknown>,
  hasAudio?: boolean,
  hasUserAudio?: boolean,
  hasResponseAudio?: boolean,
  userId?: string,
  agentName?: string,
  metadata?: Record<string, unknown>,
  eventTimestamp: number,
  receivedAt: string,
  rawPayload?: Record<string, unknown>
}
```

**Functions**:
- `saveConversation(id, agentId, data, timestamp, rawPayload)` — Store conversation
- `getConversation(conversationId)` — Retrieve by ID or null
- `hasConversation(conversationId)` — Boolean check
- `getAllConversations()` — Return all stored conversations
- `getConversationsSince(seconds)` — Recent conversations
- `clear()` — Clear all (for testing)

**Singleton**: `conversationStore` module-level instance

---

### 4. Event Processor (`elevenlabs-event-processor.ts`)

Orchestrates webhook processing:

```typescript
processElevenLabsWebhook(webhook, rawPayload): ProcessedWebhookResult
```

**ProcessedWebhookResult**:
```typescript
{
  success: boolean,
  type: string,
  conversationId: string,
  duplicate?: boolean,
  message: string
}
```

**Flow**:
1. Validate webhook structure
2. Check for duplicates using `(event_timestamp, conversation_id)` key
3. If duplicate: return `{ success: true, duplicate: true, ... }`
4. If new: save to conversationStore, mark as seen, return success
5. If error: return failure message

**Deduplication**: Uses in-memory Set to track seen webhook keys. Prevents duplicate processing of retried webhooks.

---

### 5. Signature Verification (`elevenlabs-signature-verifier.ts`)

HMAC-SHA256 signature verification helpers:

- `verifyElevenLabsSignature(rawBody, signature, secret): boolean`
- `shouldVerifySignature(): boolean` — Checks if secret is configured
- `getWebhookSecret(): string | null` — Get secret from env
- `logSignatureWarning(isDevelopment)` — Dev-only warning

**Behavior**:
- If `ELEVENLABS_WEBHOOK_SECRET` env var exists: **require signature**
- If not set: skip verification with development warning
- Uses constant-time comparison (crypto.timingSafeEqual)

---

### 6. Webhook Route (`app/api/webhooks/elevenlabs/route.ts`)

HTTP POST endpoint: `POST /api/webhooks/elevenlabs`

**Request**:
```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1717662600,
  "data": { ... }
}
```

**Response (Success - New)**:
```json
{
  "success": true,
  "type": "post_call_transcription",
  "conversationId": "conv_abc123",
  "message": "Post-call webhook processed for conversation conv_abc123"
}
```

**Response (Success - Duplicate)**:
```json
{
  "success": true,
  "type": "post_call_transcription",
  "conversationId": "conv_abc123",
  "duplicate": true,
  "message": "Duplicate webhook for conversation conv_abc123"
}
```

**Response (Invalid Structure)**:
```json
{
  "success": false,
  "error": "Invalid webhook structure"
}
```

**HTTP Status Codes**:
- `200` — Webhook processed successfully (new or duplicate)
- `400` — Malformed JSON or invalid structure
- `401` — Signature verification failed
- `500` — Unexpected server error

---

## Complete Call Lifecycle Example

### 1. WorkerBrief Dispatch (Phase 12A-3)
```
Zeya creates WorkerBrief for prospect
→ Dispatch to ElevenLabs
→ GET /v1/convai/agents/{agentId}/sessions returns conversation_id
→ Track conversation_id in mapping
```

### 2. Phone Call (Real-time)
```
ElevenLabs initiates SIP INVITE to Telnyx
→ Telnyx routes to prospect's phone
→ Prospect answers
→ Agent (Veya) greets and converses
→ Agent determines interest, extracts info
→ One party hangs up
→ Call ends
```

**No webhooks sent during call. No session_created, session_started events.**

### 3. ElevenLabs Post-Processing
```
Call audio → transcription
Transcript → summary generation
Transcript → sentiment analysis
Transcript → data extraction (if configured)
Metadata → call duration, status
→ (~1-5 seconds total)
```

### 4. Post-Call Webhook
```
POST /api/webhooks/elevenlabs

{
  "type": "post_call_transcription",
  "event_timestamp": 1717662600,
  "data": {
    "conversation_id": "conv_6801ktc2w5p0fqfrkvc41wcrdfev",
    "agent_id": "agent_xyz",
    "status": "done",
    "transcript": [
      { "role": "agent", "message": "Hi, this is Veya..." },
      { "role": "user", "message": "Hi, thanks for calling" },
      ...
    ],
    "summary": "User expressed interest in product demo",
    "call_duration": 287,
    "extracted_data": {
      "collected_variables": {
        "name": "Jane Doe",
        "email": "jane@example.com"
      }
    }
  }
}
```

### 5. Zeya Processing
```
HTTP 200 response sent to ElevenLabs
↓
conversationStore saves complete conversation data
↓
Ready for Phase 12A-3: Link to WorkerBrief
↓
Ready for Phase 12A-4: Build CallOutcome
```

---

## Test Scenarios

### Scenario 1: Valid Post-Call Webhook
```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "post_call_transcription",
    "event_timestamp": 1717662600,
    "data": {
      "conversation_id": "conv_test_001",
      "agent_id": "agent_xyz",
      "status": "done",
      "transcript": [
        { "role": "agent", "message": "Hi Jane" },
        { "role": "user", "message": "Hi there" }
      ],
      "summary": "User interested",
      "call_duration": 120,
      "extracted_data": { "name": "Jane" }
    }
  }'
```

**Response**: `HTTP 200`
```json
{
  "success": true,
  "type": "post_call_transcription",
  "conversationId": "conv_test_001",
  "message": "Post-call webhook processed for conversation conv_test_001"
}
```

**State**:
```typescript
conversationStore.getConversation("conv_test_001")
// {
//   conversationId: "conv_test_001",
//   agentId: "agent_xyz",
//   status: "done",
//   transcript: [...],
//   summary: "User interested",
//   callDuration: 120,
//   extractedData: { name: "Jane" },
//   eventTimestamp: 1717662600,
//   receivedAt: "2026-06-06T12:30:00.000Z"
// }
```

### Scenario 2: Duplicate Webhook
```bash
# Send same webhook twice
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "post_call_transcription",
    "event_timestamp": 1717662600,
    "data": {
      "conversation_id": "conv_test_001",
      ...
    }
  }'

# First request: HTTP 200, success: true
# Second request: HTTP 200, success: true, duplicate: true
```

### Scenario 3: Invalid Payload
```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{ "type": "invalid" }'
```

**Response**: `HTTP 400`
```json
{
  "success": false,
  "error": "Invalid webhook structure"
}
```

### Scenario 4: Malformed JSON
```bash
curl -X POST http://localhost:3000/api/webhooks/elevenlabs \
  -H "Content-Type: application/json" \
  -d '{ invalid json'
```

**Response**: `HTTP 400`
```json
{
  "success": false,
  "error": "Malformed JSON"
}
```

---

## Data Retrieval: Push vs. Pull

### Option A: Push (Webhooks) — Used in Phase 12A-2 ✅
**Method**: ElevenLabs sends webhook after call ends
**Latency**: ~1-5 seconds after call ends
**Reliability**: Automatic (ElevenLabs handles retries)
**Usage**: Primary mechanism for receiving call data

### Option B: Pull (REST API) — Fallback for Phase 12B ⚠️
**Method**: Poll `GET /v1/conversations/{conversation_id}`
**Latency**: On-demand (no polling in 12A-2)
**Reliability**: Manual polling required
**Usage**: Can be implemented as fallback if webhook doesn't arrive

---

## Files Structure

```
lib/voice/events/
├── elevenlabs-event-types.ts           # Webhook type definitions
├── elevenlabs-event-validator.ts       # Type guards
├── elevenlabs-conversation-store.ts    # In-memory conversation storage
├── elevenlabs-event-processor.ts       # Webhook processing logic
├── elevenlabs-signature-verifier.ts    # HMAC-SHA256 verification
├── index.ts                            # Public exports
└── ARCHITECTURE.md                     # This file

app/api/webhooks/elevenlabs/
└── route.ts                            # POST /api/webhooks/elevenlabs
```

---

## Debugging & Observability

### Status Endpoint
**Route**: `GET /api/webhooks/elevenlabs/status`

**Purpose**: Check webhook delivery status at a glance

**Response**:
```json
{
  "conversationsReceived": 2,
  "latestConversationId": "conv_test_debug_002",
  "latestReceivedAt": "2026-06-06T08:34:06.133Z",
  "latestStatus": "done",
  "latestDuration": 45,
  "conversationIds": [
    "conv_test_debug_002",
    "conv_test_debug_001"
  ]
}
```

**Usage**: After a call, open this endpoint to verify webhook arrived:
```bash
curl https://zeya.mindrasolutions.com/api/webhooks/elevenlabs/status
```

### Conversation Inspection Endpoint
**Route**: `GET /api/webhooks/elevenlabs/conversation/{conversationId}`

**Purpose**: Inspect a specific conversation's details

**Response (Production)**:
```json
{
  "conversationId": "conv_test_debug_001",
  "agentId": "agent_xyz",
  "status": "done",
  "receivedAt": "2026-06-06T08:34:03.026Z",
  "eventTimestamp": 1717662600,
  "callDuration": 287,
  "summary": "User interested in demo",
  "transcriptSegmentCount": 2,
  "extractedDataKeys": ["name"],
  "userId": null,
  "agentName": null,
  "hasAudio": false,
  "hasUserAudio": false,
  "hasResponseAudio": false
}
```

**Response (Development Only)**: In development mode, also includes:
```json
{
  "transcript": [...],
  "extractedData": {...},
  "metadata": {...}
}
```

**Usage**: Check details of a specific conversation:
```bash
curl https://zeya.mindrasolutions.com/api/webhooks/elevenlabs/conversation/conv_abc123
```

**Error Response** (404):
```json
{
  "error": "Conversation not found"
}
```

### Development Logging
When `NODE_ENV === "development"`, webhook processing logs:
- Conversation received (ID, duration, segment count, timestamp)
- Duplicate detection
- Validation failures
- Signature verification failures

Example console output:
```
[webhook] Conversation received: {
  conversationId: 'conv_test_debug_001',
  duration: 287,
  segments: 2,
  status: 'done',
  receivedAt: '2026-06-06T08:34:03.026Z'
}
```

**Never logs**: API keys, full transcripts (in production), or sensitive data

---

## Removed Files (Old Lifecycle Model)

These files are no longer needed (replaced by single webhook model):
- ❌ `call-session-store.ts` — Replaced by conversationStore
- ❌ `transcript-capture.ts` — Merged into conversationStore
- ❌ `call-outcome-store.ts` — Separate from webhook processing

---

## Environment Configuration

**Optional** (for signature verification):
```
ELEVENLABS_WEBHOOK_SECRET=<webhook_signing_secret>
```

If not set: Signature verification is skipped (development mode warning logged)

---

## Integration Points (Future Phases)

### Phase 12A-3: WorkerBrief Correlation
- Map `conversation_id` to `workerBriefId`
- Look up WorkerBrief when webhook arrives
- Use brief context for CallOutcome creation

### Phase 12A-4: CallOutcome Creation
- Use webhook data to build CallOutcome
- Transcript from webhook
- Summary from webhook
- Sentiment analysis from ElevenLabs analysis
- Extracted data fields

### Phase 12B: Persistence
- Replace conversationStore (Map) with Supabase table
- Add signature verification requirement
- Add webhook retry logic
- Store raw webhook payload for audit

### Phase 12C: Memory Integration
- Create MemoryEvent from CallOutcome
- Feed into Zeya learning loop
- Track patterns for strategy adjustment

---

## Design Principles

1. **Single Event Model**: One webhook type per call (post_call_transcription)
2. **Complete Data**: All call information in one webhook
3. **Asynchronous**: Webhook sent after ElevenLabs processing complete
4. **Idempotent**: Duplicate webhooks safely handled
5. **Secure**: HMAC-SHA256 signature verification (optional, required when secret set)
6. **Stateless**: Webhook processor has no side effects beyond storage
7. **Auditable**: Raw payload stored for debugging

---

## What Changed from Old Model

| Aspect | Old (Wrong) | New (Correct) |
|--------|------------|---------------|
| **Events** | session_created, started, ended | post_call_transcription only |
| **Timing** | Real-time (3 events) | After-call (1 event) |
| **Data** | Spread across 3 events | All in one event |
| **Store** | 3 separate stores | 1 consolidated store |
| **Model** | Session lifecycle | Post-call data snapshot |

---

## Current Limitations

- **In-memory only**: Data lost on process restart
- **No persistence**: Must add database in Phase 12B
- **No signature verification**: Optional (enabled by env var)
- **No deduplication TTL**: Keeps all seen webhooks in memory
- **No retry logic**: ElevenLabs retries, Zeya accepts all
- **No conversation_id → workerBriefId mapping**: Added in Phase 12A-3
- **No CallOutcome creation**: Added in Phase 12A-4

---

## Success Criteria (Phase 12A-2 Corrected)

✅ POST to `/api/webhooks/elevenlabs` with valid payload returns HTTP 200  
✅ Webhook data stored in `conversationStore`  
✅ Duplicate webhooks return 200 with `duplicate: true`  
✅ Invalid payloads return HTTP 400  
✅ No database writes  
✅ No UI  
✅ Type-safe via TypeScript  
✅ Signature verification prepared (optional)  

---

**Phase 12A-2 Status**: ✅ **CORRECTED**

Architecture now reflects actual ElevenLabs post-call webhook behavior. Single event model, complete conversation data, deduplication, and idempotent processing all in place.

Ready for Phase 12A-3: WorkerBrief correlation.
