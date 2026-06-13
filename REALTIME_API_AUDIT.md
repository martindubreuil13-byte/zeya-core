# OpenAI Realtime API Implementation Audit

**Status:** Research Phase  
**Date:** 2026-06-13  
**Purpose:** Complete validation of Realtime implementation against current OpenAI API specification

---

## 1. Current Implementation Inventory

### Session Creation Endpoint

**File:** `app/api/openai/realtime/session/route.ts`

**Current Structure:**
```typescript
const sessionConfig = {
  session: {
    model,                          // gpt-realtime (updated)
    audio: {
      output: {
        voice,                      // sage (updated)
      },
    },
  },
};
```

**Key Details:**
- ✅ Model: `gpt-realtime` (confirmed valid)
- ✅ Voice: `sage` (confirmed valid from SDK types)
- ✅ Uses `session` wrapper (correct per OpenAI spec)
- ✅ Audio output voice properly nested
- ⚠️ No audio input configuration (turn_detection, transcription, etc.)
- ⚠️ No instructions field in session
- ⚠️ Missing output_modalities configuration

**Response Handling:**
- Extracts `client_secret.value` from response
- Expects ephemeral token format: `ek_live_*`

### Briefing Session Endpoint

**File:** `app/api/openai/realtime/briefing-session/route.ts`

**Current Structure:**
```typescript
const config = {
  session: {
    type: "realtime",
    model: "gpt-realtime",
    instructions: "...",
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: 0.35,
          prefix_padding_ms: 500,
          silence_duration_ms: 400,
          create_response: true,
          interrupt_response: true,
        },
        transcription: { model: "gpt-4o-mini-transcribe" },
      },
      output: {
        voice: "sage",
      },
    },
  },
};
```

**Key Details:**
- ✅ Includes session.type (may be redundant)
- ✅ Includes instructions
- ✅ Full audio.input configuration with VAD
- ✅ Transcription configured
- ⚠️ Missing output_modalities
- ⚠️ No max_output_tokens configuration
- ⚠️ No tool configuration

### WebRTC Connection Flow

**File:** `lib/realtime/openai-realtime-client.ts`

**Current Implementation:**

1. **Session Creation (lines 214-228)**
   - Calls `/api/openai/realtime/session`
   - Expects `client_secret.value` in response
   - Uses ephemeral token for WebRTC

2. **WebRTC Offer/Answer (lines 136-160)**
   - Creates RTCPeerConnection
   - Generates SDP offer
   - POSTs SDP to `https://api.openai.com/v1/realtime/calls`
   - Uses ephemeral token in Authorization header
   - Sets remote description from response

3. **Audio Setup (lines 126-127)**
   - Gets microphone audio via `getUserMedia`
   - Adds audio tracks to peer connection

4. **Event Handling**
   - Responds to WebRTC events
   - Parses conversation events from data channel
   - Manages transcript display

---

## 2. OpenAI SDK Type Reference

**Source:** `node_modules/openai/resources/realtime/client-secrets.d.ts`

### ClientSecretCreateParams

```typescript
interface ClientSecretCreateParams {
  expires_after?: {
    anchor?: 'created_at';
    seconds?: number;  // 10-7200
  };
  session?: RealtimeSessionCreateRequest;
}
```

### RealtimeSessionCreateRequest Structure

**Required:**
- (None - all fields optional)

**Commonly Used:**
- `model` - Model identifier (e.g., "gpt-realtime")
- `audio.output.voice` - Voice for responses
- `instructions` - System prompt
- `output_modalities` - ["audio"] or ["text"]

**Optional Audio Input:**
- `audio.input.turn_detection` - VAD configuration
- `audio.input.transcription` - Transcription settings
- `audio.input.noise_reduction` - Noise reduction type
- `audio.input.format` - Audio format

**Optional Audio Output:**
- `audio.output.format` - Audio format
- `audio.output.speed` - Playback speed (0.25-1.5)

**Other:**
- `max_output_tokens` - Token limit per response
- `output_modalities` - Response type
- `tools` - Available tools
- `truncation` - Context truncation behavior
- `tracing` - Trace configuration

### Valid Voices

From SDK types:
```
'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 
'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar'
```

**Recommended in SDK:** `'marin'` and `'cedar'` for best quality

### Valid Models

From SDK types:
```
'gpt-realtime' | 'gpt-realtime-1.5' | 'gpt-realtime-2' | 
'gpt-realtime-2025-08-28' | 'gpt-audio-1.5' | 'gpt-audio-mini' | 
'gpt-audio-mini-2025-10-06' | 'gpt-audio-mini-2025-12-15'
```

---

## 3. Implementation Inventory Summary

### Server-Side Endpoints

| Endpoint | File | Status | Payload | Response |
|----------|------|--------|---------|----------|
| POST /api/openai/realtime/session | session/route.ts | Minimal | session{model, audio{output{voice}}} | client_secret{value} |
| POST /api/openai/realtime/briefing-session | briefing-session/route.ts | Extended | session{type, model, instructions, audio{input, output}} | client_secret{value} |

### Client-Side Components

| Component | File | Purpose | Status |
|-----------|------|---------|--------|
| OpenAIRealtimeClient | lib/realtime/openai-realtime-client.ts | Core WebRTC connection | Implemented |
| useRealtimeOnboardingSession | hooks/realtime/useRealtimeOnboardingSession.ts | Onboarding hook | Implemented |
| useRealtimeBriefingSession | hooks/realtime/useRealtimeBriefingSession.ts | Briefing hook | Implemented |

---

## 4. Legacy Code Audit

### Search Results for Deprecated Terms

**gpt-4-realtime-preview / gpt-4o-realtime-preview:**
- ❌ Found only in documentation files (REALTIME_DEBUG_CHANGES.md, etc.)
- ✅ NOT in active code

**modalities (root level):**
- ✅ Not found at root level in code
- ⚠️ Only in session level (correct location)

**realtime-preview variants:**
- ❌ Not found in active code

**Deprecated session fields:**
- ⚠️ `type: "realtime"` in briefing-session.ts (may be redundant)

---

## 5. Next Steps: Awaiting Specification Research

**Pending from background research agent:**
- [ ] Complete OpenAI Realtime API specification document
- [ ] Session response structure validation
- [ ] WebRTC connection protocol details
- [ ] Event stream specifications
- [ ] Transcript event structure
- [ ] Audio configuration best practices
- [ ] Voice selection implications

**Once received, will produce:**
1. Complete gap analysis with risk levels
2. Sequence diagram of full flow
3. File-by-file implementation assessment
4. Recommended fix priority list

---

## 6. Known Issues Requiring Spec Validation

### Minor Inconsistencies

1. **Payload Complexity Mismatch**
   - `/session` endpoint: Very minimal payload (model + voice only)
   - `/briefing-session` endpoint: Full configuration (turn_detection, transcription, etc.)
   - **Question:** Should both be consistent? Should minimal endpoint also support audio input config?

2. **Session Type Field**
   - Briefing session includes `type: "realtime"`
   - Session endpoint doesn't include it
   - **Question:** Is this field required, optional, or redundant?

3. **Voice Selection**
   - Currently using `sage`
   - SDK recommends `marin` or `cedar` for best quality
   - **Question:** Should we update default voice?

4. **Transcription Model**
   - Briefing uses `gpt-4o-mini-transcribe`
   - **Question:** Is this the recommended transcription model or outdated?

5. **Modalities**
   - Not specified in either endpoint
   - Defaults likely to `["audio"]`
   - **Question:** Should we explicitly set `output_modalities: ["audio", "text"]`?

---

## 7. Files Requiring Audit

After specification research completes, these files will be audited:

1. **Server:**
   - ✅ app/api/openai/realtime/session/route.ts
   - ✅ app/api/openai/realtime/briefing-session/route.ts
   - ? app/api/webhooks/telnyx/route.ts (if relates to realtime)

2. **Client:**
   - ✅ lib/realtime/openai-realtime-client.ts
   - ✅ lib/realtime/realtime-events.ts
   - ✅ hooks/realtime/useRealtimeOnboardingSession.ts
   - ✅ hooks/realtime/useRealtimeBriefingSession.ts
   - lib/voice/voice-service.ts

3. **Configuration:**
   - ✅ .env.example / .env.local
   - ✅ Environment variable defaults

4. **Types:**
   - ✅ types/realtime.ts
   - ✅ types/voice.ts

---

## Status

**Research Phase:** In Progress  
**Specification Research:** Background agent running  
**Code Audit:** Paused pending specification research  
**Implementation:** Blocked until specification gaps are understood

---

Last updated: 2026-06-13 by Research Audit Process
