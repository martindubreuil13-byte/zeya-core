# Phase 12A: ElevenLabs Agent Outbound Calling + Telnyx Integration

**Objective**: Enable Veya (ElevenLabs agent) to make real outbound calls to prospects through Telnyx phone numbers, receive webhook callbacks, and populate CallOutcome with real results.

**Scope**: 
- ElevenLabs outbound call initiation
- Telnyx phone number + SIP trunk configuration
- Webhook receivers for call events
- CallOutcome population from real calls
- Integration with existing WorkerBrief → CallOutcome pipeline

**Status**: Implementation Planning (not yet implemented)

---

## 1. Architecture Overview: Call Flow

```
WorkerBrief (Zeya → Veya)
  │
  ├─ missionId, objective, dynamicVariables
  └─ targetPhone, targetName
       ↓
dispatchWorkerBrief(provider: "ELEVENLABS_TELNYX")
       ↓
┌─────────────────────────────────────────────────────────────┐
│ ElevenLabs Agent Outbound Initiation                        │
│ POST /v1/convai/agents/{agentId}/sessions                  │
│                                                              │
│ Request:                                                     │
│ ├─ agent_id: "NEXT_PUBLIC_ELEVENLABS_AGENT_ID"             │
│ ├─ deployment_id: "ELEVENLABS_PHONE_DEPLOYMENT_ID"         │
│ ├─ conversation_config_override: {                          │
│ │   dynamic_variables: { target, targetPhone, objective ... }
│ │   webhook_url: "https://zeya.app/api/webhooks/elevenlabs" │
│ └─ mode: "outbound"                                         │
│                                                              │
│ Response: { session_id, phone_number_called }              │
└────────────┬────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Telnyx SIP Trunk (Phone Delivery)                           │
│                                                              │
│ Telnyx receives SIP INVITE from ElevenLabs                  │
│ ├─ To: target phone number                                  │
│ ├─ From: Zeya's Telnyx-assigned phone number               │
│ ├─ SDP: Audio codec negotiation                             │
│ └─ Call routed via Telnyx infrastructure                    │
│                                                              │
│ Prospect picks up phone                                     │
│ → Veya agent greets (ElevenLabs WebRTC audio)              │
│ → Conversation happens                                      │
│ → Agent determines outcome                                  │
└────────────┬────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Call Event Webhooks (ElevenLabs → Zeya)                     │
│                                                              │
│ Events:                                                      │
│ ├─ "session_created": Call initiated                       │
│ ├─ "session_started": Prospect answered                    │
│ ├─ "session_interrupted": Call interrupted                │
│ ├─ "session_ended": Call completed (with reason)           │
│ └─ Payload includes: session_id, duration, transcript      │
│                                                              │
│ POST /api/webhooks/elevenlabs                              │
│ Zeya receives webhook, queues for processing               │
└────────────┬────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Call Event Processing (Zeya)                                │
│                                                              │
│ For each webhook event:                                     │
│ ├─ Verify HMAC signature (ElevenLabs security)            │
│ ├─ Extract session_id, duration, transcript, outcome      │
│ ├─ Look up corresponding WorkerBrief by session_id        │
│ ├─ Determine OutcomeType (INTERESTED, MEETING_BOOKED, ...) │
│ ├─ Extract sentiment, objections, insights                │
│ └─ Create CallOutcome record                               │
└────────────┬────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────┐
│ CallOutcome Structure (Real Data)                           │
│                                                              │
│ CallOutcome {                                               │
│   id: "outcome_...",                                        │
│   missionId: "mission_...",                                │
│   workerBriefId: "brief_...",                              │
│   workerName: "Veya",                                       │
│   targetName: "Jane Doe",                                   │
│   targetPhone: "+1-555-0100",                              │
│   outcomeType: "INTERESTED",              ← Real outcome   │
│   sentiment: "POSITIVE",                  ← From transcript │
│   summary: "...",                         ← Zeya analysis   │
│   transcript: "Full call transcript",     ← From ElevenLabs │
│   callDurationSeconds: 287,               ← From call event │
│   keyInsights: ["Budget approved", ...],  ← Extracted      │
│   nextAction: "Send demo link",           ← Determined     │
│   meetingBooked: true,                    ← Inferred       │
│   meetingDate: "2026-06-10T14:00:00Z"     ← From call      │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. ElevenLabs Agent Outbound Calling

### 2.1 How ElevenLabs Agents Initiate Outbound Calls

**Capability**: ElevenLabs agents support **outbound calling** via the Conversational AI API.

**Initiation Method**:
```
POST https://api.elevenlabs.io/v1/convai/agents/{agentId}/sessions
Authorization: xi-api-key: {ELEVENLABS_API_KEY}

{
  "deployment_id": "phone_delivery",  // or "web"
  "conversation_config_override": {
    "agent": {
      "prompt": {
        "prompt": "You are Veya, a sales development representative..."
      }
    },
    "dynamic_variable_placeholders": {
      "target": "prospect name",
      "targetPhone": "+1-555-0100",
      "objective": "Qualify lead as potential customer"
    },
    "phone": {
      "phone_number_to_dial": "+1-555-0100",  // Prospect's number
      "from_number": "+1-XXX-XXXX",           // Zeya's Telnyx number
      "webhook_url": "https://zeya.app/api/webhooks/elevenlabs",
      "webhook_events": ["session_created", "session_started", "session_ended"]
    }
  }
}
```

**Response**:
```json
{
  "session_id": "session_abc123",
  "status": "queued",
  "phone_number_called": "+1-555-0100",
  "created_at": "2026-06-05T10:30:00Z"
}
```

### 2.2 Phone Delivery: Where Calls Originate

**Key Finding**: Outbound calls originate **from ElevenLabs infrastructure**, but the **phone number comes from Telnyx**.

**Flow**:
1. **Zeya** sends outbound initiation to ElevenLabs API
2. **ElevenLabs** creates a session and initiates a call using:
   - `phone_number_to_dial`: prospect's phone number
   - `from_number`: Zeya's Telnyx-assigned phone number
3. **ElevenLabs** → (SIP INVITE) → **Telnyx** (SIP trunk)
4. **Telnyx** → (PSTN network) → **Prospect's phone**

**Important**: ElevenLabs **must be configured with Telnyx as a SIP trunk** to deliver calls. The call does NOT originate from Telnyx; Telnyx is the **carrier/transport layer**.

### 2.3 Required ElevenLabs Configuration Objects

**1. Agent (Already exists)**
```json
{
  "agent_id": "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "name": "Veya",
  "conversation_config": {
    "agent": {
      "prompt": {
        "prompt": "You are Veya, a professional sales representative..."
      }
    },
    "tts": {
      "voice_id": "ELEVENLABS_VOICE_ID",
      "model_id": "eleven_turbo_v2"
    }
  }
}
```

**2. Deployment (Phone Delivery)**
```json
{
  "deployment_id": "phone_delivery",
  "type": "phone",
  "agent_id": "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "name": "Veya Phone Outbound",
  "phone_config": {
    "provider": "telnyx",  // OR "twilio", but Zeya uses Telnyx
    "inbound_sip_endpoint": "sip:zeya@telnyx.voice.api",
    "outbound_from_number": "+1-XXX-XXXX",  // Telnyx-assigned number
    "webhook_url": "https://zeya.app/api/webhooks/elevenlabs",
    "webhook_signing_secret": "ELEVENLABS_WEBHOOK_SECRET"
  }
}
```

**3. Dynamic Variables (Passed per call)**
```json
{
  "target": "Jane Doe",
  "targetPhone": "+1-555-0100",
  "company": "DataFlow Inc.",
  "objective": "Qualify as potential customer",
  "keyTalkingPoints": "value delivered | benefits | stories",
  "inferredIntent": "SALES_FOLLOW_UP"
}
```

---

## 3. Telnyx Configuration & Integration

### 3.1 Telnyx Role: SIP Trunk Provider

**Telnyx acts as**:
- **SIP Trunk**: Receives SIP INVITE from ElevenLabs, routes to PSTN
- **Phone Number Carrier**: Owns the phone number Veya calls from
- **Call Event Reporter**: Sends webhooks for call status (optional if ElevenLabs handles)

**Telnyx does NOT**:
- Initiate calls directly
- Manage agent behavior
- Generate call outcomes
- Authenticate with ElevenLabs

### 3.2 Required Telnyx Configuration Objects

**1. SIP Connection (Inbound from ElevenLabs)**
```json
{
  "connection_id": "telnyx_sip_connection_id",
  "connection_name": "ElevenLabs SIP Trunk",
  "connection_type": "sip_trunking",
  "inbound": {
    "sip_uri": "sip:zeya@sip.telnyx.com",
    "ip_address": "api.elevenlabs.io"  // OR IP range
  },
  "outbound": {
    "outbound_voice_profile": "standard",
    "dtmf_type": "RFC_2833"
  }
}
```

**2. Outbound Phone Number (Identity)**
```json
{
  "phone_number": "+1-XXX-XXXX",  // Zeya's outbound caller ID
  "type": "local",
  "country_code": "US",
  "connection_id": "telnyx_sip_connection_id",  // Link to SIP trunk
  "calling_profile": {
    "name": "Zeya Sales Agent",
    "cnam": "Zeya Sales"  // Caller name for prospects
  }
}
```

**3. Messaging Profile (optional, for SMS follow-ups)**
```json
{
  "profile_name": "Zeya Sales Messaging",
  "messaging_enabled": true,
  "api_key": "TELNYX_API_KEY"
}
```

### 3.3 Telnyx Webhook Events (Optional)

If Telnyx sends call status webhooks (instead of ElevenLabs):
```json
{
  "event_type": "call.hangup",
  "call_control_id": "call_123",
  "connection_id": "telnyx_sip_connection_id",
  "from": "+1-XXX-XXXX",
  "to": "+1-555-0100",
  "duration_secs": 287,
  "hangup_reason": "customer_hangup",
  "timestamp": "2026-06-05T10:35:00Z"
}
```

---

## 4. Webhook Event Processing

### 4.1 ElevenLabs Webhook Events

**ElevenLabs sends events to**: `POST /api/webhooks/elevenlabs`

**Event Types**:

#### `session_created`
Fired when session is queued for outbound call.
```json
{
  "event_type": "session_created",
  "session_id": "session_abc123",
  "agent_id": "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "status": "queued",
  "phone_number_called": "+1-555-0100",
  "from_number": "+1-XXX-XXXX",
  "timestamp": "2026-06-05T10:30:00Z"
}
```

#### `session_started`
Fired when prospect answers the call.
```json
{
  "event_type": "session_started",
  "session_id": "session_abc123",
  "agent_id": "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "started_at": "2026-06-05T10:30:05Z"
}
```

#### `session_ended`
Fired when call completes.
```json
{
  "event_type": "session_ended",
  "session_id": "session_abc123",
  "agent_id": "NEXT_PUBLIC_ELEVENLABS_AGENT_ID",
  "duration_secs": 287,
  "ended_at": "2026-06-05T10:35:00Z",
  "reason": "customer_hangup",  // or "agent_hangup", "error"
  "transcript": {
    "text": "Full conversation transcript...",
    "segments": [
      { "speaker": "agent", "text": "Hi, this is Veya..." },
      { "speaker": "customer", "text": "Hi, thanks for calling..." },
      ...
    ]
  },
  "call_summary": {
    "outcome_type": "interested",      // From agent analysis
    "sentiment": "positive",
    "key_points": ["budget approved", "wants demo"],
    "next_action": "send demo link"
  }
}
```

### 4.2 Webhook Signature Verification

**ElevenLabs signs webhooks** using HMAC-SHA256.

```typescript
import crypto from 'crypto';

function verifyElevenLabsWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}
```

**Header**: `X-ElevenLabs-Signature`

---

## 5. Source of Truth: CallOutcome

### 5.1 Which System Is Authoritative?

**ElevenLabs is the source of truth** for:
- Call duration
- Transcript
- Outcome type (inferred by agent)
- Sentiment (from agent analysis)
- Call start/end times

**Zeya augments** with:
- WorkerBrief context (objective, lead context)
- Business context (company, mission)
- Next actions (derived from outcome + context)
- Memory event creation

### 5.2 CallOutcome from Real Calls

**Before Phase 12A**: `simulateCallOutcome(workerBrief)` generates synthetic outcomes.

**Phase 12A**: `buildCallOutcomeFromElevenLabsWebhook(webhook, workerBrief)` creates real outcomes.

**Implementation**:
```typescript
interface ElevenLabsSessionEndedWebhook {
  session_id: string;
  duration_secs: number;
  transcript: { text: string; segments: any[] };
  call_summary: {
    outcome_type: "interested" | "not_interested" | "callback" | ...;
    sentiment: "positive" | "neutral" | "negative";
    key_points: string[];
    next_action: string;
  };
}

function buildCallOutcomeFromElevenLabsWebhook(
  webhook: ElevenLabsSessionEndedWebhook,
  workerBrief: WorkerBrief
): CallOutcome {
  return {
    id: `outcome_${webhook.session_id}`,
    missionId: workerBrief.missionId,
    workerBriefId: workerBrief.id,
    workerName: "Veya",
    targetName: workerBrief.leadContext?.split(" - ")?.[0],
    targetPhone: workerBrief.dynamicVariables.targetPhone as string,
    
    outcomeType: mapElevenLabsOutcome(webhook.call_summary.outcome_type),
    sentiment: mapElevenLabsSentiment(webhook.call_summary.sentiment),
    
    summary: webhook.call_summary.next_action,
    transcript: webhook.transcript.text,
    callDurationSeconds: webhook.duration_secs,
    
    keyInsights: webhook.call_summary.key_points,
    objections: extractObjectionsFromTranscript(webhook.transcript),
    nextAction: webhook.call_summary.next_action,
    
    followUpRequired: shouldFollowUp(webhook.call_summary.outcome_type),
    meetingBooked: webhook.call_summary.outcome_type === "meeting_booked",
    
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

---

## 6. Implementation Plan: Step-by-Step

### Phase 12A-1: Environment & Configuration (Week 1)

**Deliverables**:
- Telnyx account setup
- ElevenLabs phone deployment configuration
- Environment variables

**Files to create**:
- None (pure configuration)

**Files to modify**:
- `.env.local` — Add Telnyx and ElevenLabs phone config

**Environment variables needed**:
```
# ElevenLabs (existing + phone)
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=<agent_id>
ELEVENLABS_API_KEY=<api_key>
ELEVENLABS_PHONE_DEPLOYMENT_ID=phone_delivery
ELEVENLABS_WEBHOOK_SECRET=<webhook_signing_secret>

# Telnyx
TELNYX_API_KEY=<api_key>
TELNYX_API_URL=https://api.telnyx.com/v2
TELNYX_SIP_CONNECTION_ID=<sip_connection_id>
TELNYX_PHONE_NUMBER=+1-XXX-XXXX
```

**Tasks**:
1. Create Telnyx account (or use existing)
2. Create SIP connection to ElevenLabs
3. Lease/assign phone number (+1-XXX-XXXX)
4. Update ElevenLabs agent with phone deployment config
5. Generate webhook signing secret
6. Add environment variables to `.env.local`

---

### Phase 12A-2: Webhook Receiver (Week 1)

**Deliverables**:
- Webhook endpoint for ElevenLabs events
- Request validation (HMAC verification)
- Queue/processing layer for async handling

**Files to create**:
- `app/api/webhooks/elevenlabs/route.ts` — Main webhook receiver
- `lib/webhooks/elevenlabs-webhook-handler.ts` — Signature verification
- `lib/webhooks/elevenlabs-webhook-types.ts` — Type definitions

**Route**: `POST /api/webhooks/elevenlabs`

**Implementation**:
```typescript
// app/api/webhooks/elevenlabs/route.ts

import { NextRequest, NextResponse } from "next/server";
import { verifyElevenLabsWebhook } from "@/lib/webhooks/elevenlabs-webhook-handler";
import { processElevenLabsWebhook } from "@/lib/webhooks/process-elevenlabs-webhook";

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Get raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-elevenlabs-signature");

  if (!signature || !verifyElevenLabsWebhook(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse body
  const webhook = JSON.parse(rawBody);

  // Queue for async processing (use Bull, RabbitMQ, or inline)
  // For now: inline with fire-and-forget
  try {
    processElevenLabsWebhook(webhook).catch((err) => {
      console.error("[webhook] Failed to process ElevenLabs event:", err);
    });
    
    return NextResponse.json({ status: "received" }, { status: 202 });
  } catch (err) {
    console.error("[webhook] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

**Tasks**:
1. Implement HMAC-SHA256 signature verification
2. Create webhook receiver endpoint
3. Parse webhook payload safely
4. Queue events for processing (async, non-blocking)
5. Test with ElevenLabs webhook tester

---

### Phase 12A-3: WorkerBrief → ElevenLabs Call Dispatch (Week 2)

**Deliverables**:
- Real call dispatch to ElevenLabs (replaces mock)
- Session tracking (session_id ↔ workerBriefId mapping)
- Error handling for dispatch failures

**Files to modify**:
- `lib/providers/provider-types.ts` — Add "ELEVENLABS_TELNYX" provider type
- `lib/providers/provider-factory.ts` — Add ElevenLabs provider implementation
- `lib/workers/worker-dispatcher.ts` — No changes (uses provider interface)

**Files to create**:
- `lib/providers/elevenlabs-provider.ts` — Implementation of outbound call dispatch
- `lib/elevenlabs-outbound/elevenlabs-client.ts` — ElevenLabs API client
- `lib/elevenlabs-outbound/session-tracker.ts` — Map session_id to workerBriefId

**Implementation**:
```typescript
// lib/providers/elevenlabs-provider.ts

import type { WorkerProvider } from "./provider-interface";
import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";
import { initiateElevenLabsCall } from "@/lib/elevenlabs-outbound/elevenlabs-client";
import { trackSession } from "@/lib/elevenlabs-outbound/session-tracker";

export class ElevenLabsProvider implements WorkerProvider {
  async dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    const deploymentId = process.env.ELEVENLABS_PHONE_DEPLOYMENT_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!agentId || !deploymentId || !apiKey) {
      return {
        providerType: "ELEVENLABS_TELNYX",
        providerCallId: "",
        status: "FAILED",
        message: "ElevenLabs configuration incomplete",
        createdAt: new Date().toISOString(),
      };
    }

    if (!request.targetPhone) {
      return {
        providerType: "ELEVENLABS_TELNYX",
        providerCallId: "",
        status: "FAILED",
        message: "Target phone number is required",
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const response = await initiateElevenLabsCall({
        agentId,
        deploymentId,
        apiKey,
        phoneNumber: request.targetPhone,
        targetName: request.targetName,
        dynamicVariables: request.dynamicVariables,
      });

      // Track session for webhook correlation
      await trackSession(response.session_id, request.workerBriefId);

      return {
        providerType: "ELEVENLABS_TELNYX",
        providerCallId: response.session_id,
        status: "DISPATCHED",
        message: `Call initiated to ${request.targetPhone}`,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        providerType: "ELEVENLABS_TELNYX",
        providerCallId: "",
        status: "FAILED",
        message: `Call dispatch failed: ${message}`,
        createdAt: new Date().toISOString(),
      };
    }
  }
}
```

**Tasks**:
1. Implement ElevenLabs outbound call API client
2. Create provider implementation
3. Implement session tracking (session_id ↔ workerBriefId)
4. Add error handling for network/API failures
5. Test with real ElevenLabs agent

---

### Phase 12A-4: Webhook Processing → CallOutcome (Week 2)

**Deliverables**:
- Webhook event processor
- ElevenLabs webhook → CallOutcome conversion
- CallOutcome persistence (Supabase)

**Files to create**:
- `lib/webhooks/process-elevenlabs-webhook.ts` — Main processor
- `lib/webhooks/elevenlabs-webhook-handler.ts` — Signature verification
- `lib/webhooks/elevenlabs-webhook-types.ts` — Type definitions
- `lib/webhooks/outcome-builder-from-elevenlabs.ts` — Webhook → CallOutcome

**Files to modify**:
- `lib/call-outcomes/call-outcome-builder.ts` — Add real call support
- `lib/call-outcomes/call-outcome-simulator.ts` — Keep for fallback

**Schema changes** (Supabase):
```sql
-- Existing: lib/supabase.ts defines sessions, messages, memory_events

-- Add call_outcomes table
CREATE TABLE call_outcomes (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  worker_brief_id TEXT,
  worker_name TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  
  target_name TEXT,
  target_phone TEXT,
  
  outcome_type TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  summary TEXT,
  transcript TEXT,
  call_duration_seconds INTEGER,
  
  objections JSONB,
  key_insights JSONB,
  next_action TEXT,
  
  follow_up_required BOOLEAN,
  follow_up_date TIMESTAMP,
  
  meeting_booked BOOLEAN,
  meeting_date TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add session tracking table
CREATE TABLE elevenlabs_sessions (
  session_id TEXT PRIMARY KEY,
  worker_brief_id TEXT NOT NULL,
  call_outcome_id TEXT REFERENCES call_outcomes(id),
  created_at TIMESTAMP DEFAULT NOW(),
  webhook_received_at TIMESTAMP
);
```

**Implementation**:
```typescript
// lib/webhooks/process-elevenlabs-webhook.ts

import { getElevenLabsSessionMapping } from "@/lib/elevenlabs-outbound/session-tracker";
import { buildCallOutcomeFromElevenLabsWebhook } from "@/lib/webhooks/outcome-builder-from-elevenlabs";
import { getWorkerBriefById } from "@/lib/workers/worker-brief-store";
import { saveCallOutcome } from "@/lib/call-outcomes/call-outcome-store";

export async function processElevenLabsWebhook(webhook: any): Promise<void> {
  const eventType = webhook.event_type;
  const sessionId = webhook.session_id;

  if (eventType === "session_ended") {
    // Look up corresponding WorkerBrief
    const workerBriefId = await getElevenLabsSessionMapping(sessionId);
    if (!workerBriefId) {
      console.warn(`[webhook] No WorkerBrief found for session ${sessionId}`);
      return;
    }

    const workerBrief = await getWorkerBriefById(workerBriefId);
    if (!workerBrief) {
      console.warn(`[webhook] WorkerBrief not found: ${workerBriefId}`);
      return;
    }

    // Build CallOutcome from webhook
    const outcome = buildCallOutcomeFromElevenLabsWebhook(webhook, workerBrief);

    // Persist to database
    await saveCallOutcome(outcome);

    // Create memory event (Phase 12C)
    // await createMemoryEventFromCallOutcome(outcome, workerBrief.missionId);
  }
}
```

**Tasks**:
1. Create Supabase schema for call_outcomes and elevenlabs_sessions tables
2. Implement webhook processor
3. Implement ElevenLabs webhook → CallOutcome conversion
4. Extract outcomes, sentiment, objections from webhook
5. Persist CallOutcome to database
6. Test with real call simulation

---

### Phase 12A-5: Integration with Worker Dispatch (Week 3)

**Deliverables**:
- Update provider factory to use ElevenLabs provider
- Update dispatcher to use real provider
- End-to-end test of WorkerBrief → Call → Outcome

**Files to modify**:
- `lib/providers/provider-factory.ts` — Add ElevenLabs case
- `lib/providers/provider-types.ts` — Add "ELEVENLABS_TELNYX" type
- `lib/workers/worker-dispatcher.ts` — No changes (uses provider interface)

**Implementation**:
```typescript
// lib/providers/provider-factory.ts

import { MockProvider } from "./mock-provider";
import { ElevenLabsProvider } from "./elevenlabs-provider";
import type { WorkerProvider } from "./provider-interface";
import type { ProviderType } from "./provider-types";

export function getProvider(type: ProviderType = "MOCK"): WorkerProvider {
  switch (type) {
    case "MOCK":
      return new MockProvider();
    case "ELEVENLABS_TELNYX":
      return new ElevenLabsProvider();
    case "TWILIO":
      throw new Error("TWILIO provider not yet implemented");
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}
```

**Tasks**:
1. Add "ELEVENLABS_TELNYX" to ProviderType enum
2. Update provider factory to instantiate ElevenLabsProvider
3. Test with real WorkerBrief dispatch
4. Verify session tracking and webhook correlation
5. Verify CallOutcome is created from webhook

---

### Phase 12A-6: Testing & Validation (Week 3)

**Deliverables**:
- Test plan for end-to-end flow
- Test fixtures and helpers
- Integration test suite

**Test scenarios**:

**Test 1: Dispatch a WorkerBrief (should initiate call)**
```
POST /api/workers/test-brief with workerType: CALLER
→ Should call ElevenLabs API
→ Should return session_id
→ Should track session in database
```

**Test 2: ElevenLabs webhook arrives (call ends as INTERESTED)**
```
POST /api/webhooks/elevenlabs with session_ended event
→ Should verify signature
→ Should look up WorkerBrief by session_id
→ Should create CallOutcome with outcomeType: INTERESTED
→ Should persist to database
```

**Test 3: Multiple calls in batch**
```
POST /api/execution-plans/test-plan with 5 targets
→ Should dispatch 5 WorkerBriefs to ElevenLabs
→ Should create 5 session mappings
→ When webhooks arrive, should create 5 CallOutcomes
```

**Tasks**:
1. Create test helper for ElevenLabs webhooks
2. Test webhook signature verification
3. Test CallOutcome creation from webhook
4. Test session tracking and correlation
5. Test error scenarios (invalid webhook, missing session, etc.)
6. Load test with multiple concurrent calls

---

### Phase 12A-7: Documentation & Handoff (Week 4)

**Deliverables**:
- Implementation guide
- Configuration guide
- Troubleshooting guide
- Operations runbook

**Documentation files to create**:
- `lib/elevenlabs-outbound/IMPLEMENTATION.md` — How outbound works
- `lib/webhooks/WEBHOOK_GUIDE.md` — Webhook processing
- `docs/PHASE_12A_RUNBOOK.md` — Operations guide

**Tasks**:
1. Document ElevenLabs outbound API usage
2. Document Telnyx SIP configuration
3. Document webhook event types
4. Document troubleshooting (failed calls, webhook delays, etc.)
5. Document monitoring (call success rate, duration, etc.)

---

## 7. Call Flow Details: Three Scenarios

### Scenario 1: Happy Path (INTERESTED)

```
1. Zeya creates WorkerBrief
   id: brief_001
   objective: "Follow up with free trial user"
   leadContext: "Jane Doe - downloaded 25 leads 3 days ago"
   dynamicVariables: { target: "Jane Doe", targetPhone: "+1-555-0100" }

2. dispatchWorkerBrief(brief_001, "ELEVENLABS_TELNYX")
   ↓
   POST /v1/convai/agents/{agentId}/sessions
   {
     "agent_id": "agent_xyz",
     "deployment_id": "phone_delivery",
     "phone": {
       "phone_number_to_dial": "+1-555-0100",
       "from_number": "+1-555-5555",
       "webhook_url": "https://zeya.app/api/webhooks/elevenlabs"
     },
     "dynamic_variables": { target: "Jane Doe", targetPhone: "..." }
   }
   ↓
   Response: { session_id: "session_abc123" }

3. Zeya tracks session
   elevenlabs_sessions { session_id, worker_brief_id: brief_001 }

4. ElevenLabs calls +1-555-0100
   ↓
   Jane answers
   ↓
   Veya: "Hi Jane, this is Veya with Zeya..."
   Jane: "Hi! Thanks for calling"
   ... (5 minute conversation) ...
   Veya: "Can I send you a demo link?"
   Jane: "Yes please!"
   Veya: "Perfect, I'll send it to your email"
   ↓
   Call ends

5. ElevenLabs sends webhook
   POST /api/webhooks/elevenlabs
   {
     "event_type": "session_ended",
     "session_id": "session_abc123",
     "duration_secs": 287,
     "transcript": { text: "Full transcript...", segments: [...] },
     "call_summary": {
       "outcome_type": "interested",
       "sentiment": "positive",
       "key_points": ["wants demo", "ready to try"],
       "next_action": "send demo link and follow up"
     }
   }

6. Zeya processes webhook
   ↓
   Verify signature ✓
   ↓
   Look up session_abc123 → brief_001
   ↓
   Build CallOutcome {
     id: outcome_session_abc123,
     workerBriefId: brief_001,
     outcomeType: INTERESTED,
     sentiment: POSITIVE,
     summary: "Jane is interested and wants a demo",
     transcript: "Full transcript",
     callDurationSeconds: 287,
     keyInsights: ["wants demo", "ready to try"],
     nextAction: "send demo link and follow up",
     followUpRequired: true,
     followUpDate: 2026-06-06T10:00:00Z
   }
   ↓
   Save to database ✓

7. CallOutcome ready for:
   - Memory event creation (Phase 12C)
   - Performance metrics
   - Zeya learning loop
```

### Scenario 2: Prospect Not Interested (NO_ANSWER)

```
1. Same as Scenario 1, steps 1-3

2. ElevenLabs calls +1-555-0100
   ↓
   No answer (goes to voicemail)

3. ElevenLabs webhook
   {
     "event_type": "session_ended",
     "session_id": "session_def456",
     "duration_secs": 3,
     "transcript": { text: "Voicemail system...", segments: [...] },
     "call_summary": {
       "outcome_type": "no_answer",
       "sentiment": "neutral",
       "key_points": ["no contact made"],
       "next_action": "retry at different time"
     }
   }

4. CallOutcome
   {
     outcomeType: NO_ANSWER,
     sentiment: NEUTRAL,
     callDurationSeconds: 3,
     nextAction: "retry at different time",
     followUpRequired: true,
     followUpDate: 2026-06-06T14:00:00Z
   }
```

### Scenario 3: Call Fails (FAILED)

```
1. Same as Scenario 1, steps 1-3

2. ElevenLabs attempts call
   ↓
   SIP INVITE to Telnyx fails
   ↓
   Error: Network timeout or Telnyx unreachable

3. ElevenLabs webhook
   {
     "event_type": "session_ended",
     "session_id": "session_ghi789",
     "duration_secs": 0,
     "transcript": null,
     "call_summary": {
       "outcome_type": "failed",
       "sentiment": "neutral",
       "key_points": ["technical failure"],
       "next_action": "retry"
     }
   }

4. CallOutcome
   {
     outcomeType: FAILED,
     sentiment: NEUTRAL,
     callDurationSeconds: 0,
     summary: "Call failed to complete",
     nextAction: "retry",
     followUpRequired: true,
     followUpDate: 2026-06-05T11:00:00Z  // Immediate retry
   }
```

---

## 8. Architecture Decisions

### 8.1 ElevenLabs as Outbound Initiator

**Decision**: ElevenLabs initiates outbound calls (not Zeya calling ElevenLabs, not Telnyx initiating).

**Why**:
- ElevenLabs has native outbound calling support
- Cleaner webhook architecture (ElevenLabs → Zeya)
- Veya agent starts immediately without relay
- Single provider integration (not ElevenLabs + Telnyx SDK simultaneously)

**Alternative considered**: Zeya calls Telnyx → Telnyx bridges to ElevenLabs
- ❌ More complex (two provider SDKs)
- ❌ Harder to pass dynamic variables to Veya
- ❌ More latency between user action and call initiation

### 8.2 Telnyx as SIP Trunk (Not Primary Integration)

**Decision**: Telnyx is configured as a SIP trunk that ElevenLabs uses.

**Why**:
- Telnyx provides phone number and PSTN routing
- ElevenLabs already supports multiple SIP trunks
- Minimal Telnyx SDK usage (mostly REST API for config)
- Simpler than using Telnyx as primary call engine

**Alternative considered**: Telnyx as primary call engine
- ❌ Would need to build agent on Telnyx (not Veya)
- ❌ Lose ElevenLabs voice quality and agent
- ❌ Harder to integrate with Zeya's context

### 8.3 ElevenLabs as Source of Truth for Outcomes

**Decision**: ElevenLabs webhook `call_summary` is the source of truth for outcome and sentiment.

**Why**:
- Agent has full conversation context
- Agent makes real-time outcome determination
- Transcript is immediately available
- No need for post-hoc analysis

**Alternative considered**: Zeya analyzes transcript to determine outcome
- ❌ Unnecessary duplication
- ❌ Agent already knows what happened
- ❌ Requires transcript analysis model

### 8.4 Async Webhook Processing

**Decision**: Webhooks are processed asynchronously (fire-and-forget).

**Why**:
- Webhook endpoint responds immediately (202)
- Long processing doesn't block webhook sender
- Allows for retries and error handling
- Can queue to job processor (Bull, RabbitMQ, etc.)

**Alternative considered**: Synchronous processing
- ❌ Webhook timeout if processing slow
- ❌ No retry logic
- ❌ Blocks webhook sender

---

## 9. Risk Mitigation

### 9.1 Webhook Reliability

**Risk**: Webhook arrives but processing fails → CallOutcome not created.

**Mitigations**:
1. Webhook processing is idempotent (session_id is unique key)
2. Failed processing logged to error tracking (Sentry)
3. Manual replay capability (webhook ID stored)
4. Monitoring alert if webhook processing fails

### 9.2 Session Tracking

**Risk**: Session mapping is lost → Webhook can't find WorkerBrief.

**Mitigations**:
1. Session mapping stored in database (not memory)
2. TTL on sessions (auto-cleanup after 24 hours)
3. Session lookup includes retry logic
4. Orphan sessions logged for investigation

### 9.3 Phone Number Configuration

**Risk**: Wrong phone number used → Calls routed to wrong prospects.

**Mitigations**:
1. Phone number validated before dispatch
2. Telnyx phone number hardcoded (not configurable)
3. Test with known number before production
4. Logging of all phone number data

### 9.4 Webhook Signature Bypass

**Risk**: Fake webhook → CallOutcome created with false data.

**Mitigations**:
1. HMAC-SHA256 signature verification required
2. Signature verification uses constant-time comparison
3. Missing/invalid signature → 401 Unauthorized
4. Webhook secret rotatable

---

## 10. Monitoring & Observability

### 10.1 Key Metrics

```
Call Dispatch:
├─ Success rate: % of calls initiated successfully
├─ Latency: Time from dispatch to session_created webhook
└─ Failures: Count by error type

Calls in Progress:
├─ Active sessions: Number of ongoing calls
├─ Average duration: Running average of call length
└─ Hang-up reasons: Distribution of how calls ended

Outcomes:
├─ Outcome distribution: % interested, meetings booked, etc.
├─ Sentiment distribution: % positive, neutral, negative
└─ Next actions: Distribution of recommended follow-ups

Webhooks:
├─ Received: Count of webhooks received
├─ Processed: Count of successfully processed webhooks
├─ Failed: Count of webhook processing failures
└─ Latency: Time from call end to webhook received
```

### 10.2 Logging

**Key events to log**:
- Dispatch attempt (brief_id, phone, worker)
- Session created (session_id, brief_id)
- Webhook received (event_type, session_id)
- Webhook verified (signature match)
- CallOutcome created (outcome_type, sentiment)
- Errors (type, message, brief_id)

---

## 11. Assumptions & Dependencies

### 11.1 Assumptions

1. **ElevenLabs Agent Capability**: Agent can automatically determine outcome/sentiment/key points
2. **Telnyx SIP Trunk**: Already available or can be provisioned quickly
3. **Webhook Latency**: Acceptable to receive webhooks 0-30 seconds after call ends
4. **Phone Number**: Telnyx can assign a US local number (+1-XXX-XXXX)
5. **Network**: Reliable SIP connectivity between ElevenLabs and Telnyx

### 11.2 Dependencies

- **ElevenLabs API** (https://api.elevenlabs.io)
- **Telnyx SIP Service** (sip.telnyx.com)
- **Supabase** (existing, for persistence)
- **Next.js API routes** (existing)

---

## 12. Success Criteria (Phase 12A Complete)

- ✅ ElevenLabs agent can initiate outbound calls
- ✅ Calls routed through Telnyx SIP trunk to PSTN
- ✅ Webhook receiver at `/api/webhooks/elevenlabs`
- ✅ Webhook signature verification working
- ✅ Session tracking (session_id ↔ workerBriefId)
- ✅ CallOutcome created from real webhook
- ✅ CallOutcome persisted to Supabase
- ✅ End-to-end test: WorkerBrief → Call → Webhook → CallOutcome
- ✅ No external provider blocking (Telnyx, ElevenLabs both ready)
- ✅ Monitoring in place (metrics, logging, errors)

---

## 13. Not in Scope (Phase 12B+)

- **Call Recording**: ElevenLabs only provides transcript, not audio
- **Voicemail Detection**: Will require additional logic
- **Sentiment Analysis from Transcript**: Can use existing ElevenLabs analysis
- **Memory Integration**: Phase 12C (CallOutcome → MemoryEvent)
- **Zeya Learning Loop**: Phase 12C
- **Callback Scheduling**: Phase 13+

---

## 14. Rollback Plan

If Phase 12A doesn't work:

1. **Revert to MockProvider**: `dispatchWorkerBrief(brief, "MOCK")` uses simulated outcomes
2. **Keep Webhook Receiver**: Even if not receiving webhooks, receiver code is harmless
3. **Database Rollback**: Call `DROP TABLE call_outcomes, elevenlabs_sessions`
4. **Environment Rollback**: Remove new env vars

**Timeline**: 1-2 hours to full rollback

---

## 15. Next Phases

### Phase 12B: Full Integration
- CallOutcome → MemoryEvent creation
- Zeya learns from call outcomes
- Execution plan adjustment based on results

### Phase 12C: Automation Loop
- Mission → ExecutionPlan → Dispatch → Outcomes → Learning → New Plan
- Zeya orchestrates multi-call campaigns

### Phase 13: Multi-Worker Orchestration
- Multiple workers executing simultaneously
- Distributed outcome aggregation
- Team-level performance metrics

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-05  
**Author**: Architecture Planning  
**Status**: Ready for Implementation
