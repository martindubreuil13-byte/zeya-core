# OpenAI Realtime API - Complete Sequence Flow

**Diagrams showing the complete conversation flow from browser to OpenAI API**

---

## Flow 1: Session Creation → WebRTC Connection → Audio Stream

```
┌─────────────┐                                          ┌──────────────────┐
│   Browser   │                                          │   OpenAI API     │
│  (Client)   │                                          │                  │
└──────┬──────┘                                          └──────┬───────────┘
       │                                                         │
       │  1. User clicks "See how"                              │
       │     or enters onboarding                               │
       │                                                         │
       ├────────── 2. POST /api/openai/realtime/session ───────>│
       │          (Zeya's backend)                              │
       │                                                         │
       │                      ┌─────────────────────────────┐   │
       │                      │  OpenAI Backend             │   │
       │                      │                             │   │
       │                      │  3. POST /v1/realtime/      │   │
       │                      │      client_secrets         │   │
       │                      │                             │   │
       │                      │  Payload:                   │   │
       │                      │  {                          │   │
       │                      │    session: {               │   │
       │                      │      model: "gpt-realtime"  │   │
       │                      │      audio: {               │   │
       │                      │        output: {            │   │
       │                      │          voice: "marin"     │   │
       │                      │        }                    │   │
       │                      │      }                      │   │
       │                      │    }                        │   │
       │                      │                             │   │
       │                      │  4. Return 200 OK           │   │
       │                      │  {                          │   │
       │                      │    value: "ek_live_ABC..."  │   │
       │                      │    expires_at: 1718...      │   │
       │                      │    session: {...}           │   │
       │                      │  }                          │   │
       │                      └─────────────────────────────┘   │
       │                                                         │
       │<───────────── 5. Return ephemeral token ───────────────┤
       │          (client_secret.value)                         │
       │                                                         │
       │  6. Store token: "ek_live_ABC..."                      │
       │     Store expiration: 1718...                          │
       │                                                         │
       │  7. Create RTCPeerConnection                           │
       │     - Add audio input track (microphone)               │
       │     - Create audio output track (for speaker)          │
       │     - Generate SDP offer                               │
       │                                                         │
       ├──────────── 8. WebRTC Connection ─────────────────────>│
       │          POST /v1/realtime/calls                       │
       │          Header: Authorization: Bearer ek_live_ABC...  │
       │          Body: SDP offer                               │
       │                                                         │
       │                   (WebRTC Signaling Gateway)           │
       │                   Validates ephemeral token            │
       │                   Creates session instance             │
       │                   Sends SDP answer                     │
       │                                                         │
       │<─────────── 9. SDP Answer + WebSocket ────────────────┤
       │          (WebRTC connection + data channel)            │
       │                                                         │
       │  10. Set remote description (SDP answer)               │
       │      WebRTC ICE candidates exchanged                   │
       │      Audio tracks negotiated (PCM16 24kHz)             │
       │                                                         │
       │  11. WebSocket Connection Established                  │
       │      to: wss://api.openai.com/v1/realtime/...          │
       │                                                         │
       │<──────────── 12. session.created event ────────────────┤
       │          {                                              │
       │            type: "session.created"                      │
       │            session: {                                   │
       │              id: "sess_ABC123..."                       │
       │              type: "realtime"                           │
       │              model: "gpt-realtime"                      │
       │              audio: { output: { voice: "marin" } }     │
       │            }                                            │
       │          }                                              │
       │                                                         │
       │  ✅ READY FOR CONVERSATION                              │
       │
       └────────────────────────────────────────────────────────
```

---

## Flow 2: User Speaks → VAD → Transcript → Response

```
┌─────────────┐                                    ┌──────────────────┐
│   Browser   │                                    │    OpenAI API    │
│  (WebSocket)│                                    │  (Realtime)      │
└──────┬──────┘                                    └──────┬───────────┘
       │                                                   │
       │  1. User speaks into microphone                  │
       │     Audio stream: PCM16 24kHz mono               │
       │                                                   │
       ├───────── 2. input_audio_buffer.append ─────────>│
       │          {                                       │
       │            type: "input_audio_buffer.append"     │
       │            audio: "base64_encoded_audio_chunk"   │
       │            event_id: "evt_123"                   │
       │          }                                       │
       │                                                   │
       │  [Multiple chunks as user continues speaking]   │
       │                                                   │
       │                  ┌──────────────────────────────┐│
       │                  │  Server-side VAD (Voice      ││
       │                  │  Activity Detection)          ││
       │                  │                              ││
       │                  │  - Accumulates audio frames  ││
       │                  │  - Applies noise reduction   ││
       │                  │  - Detects speech onset      ││
       │                  │  - Monitors for silence      ││
       │                  │                              ││
       │                  │  When speech is detected:    ││
       │                  │  Threshold: 0.5 (per spec)   ││
       │                  │  Prefix padding: 500ms       ││
       │                  │  (include previous silence)  ││
       │                  └──────────────────────────────┘│
       │                                                   │
       │<─────── 3. input_audio_buffer.speech_started ────┤
       │          {                                       │
       │            type: "input_audio_buffer.speech..."  │
       │            event_id: "evt_124"                   │
       │          }                                       │
       │                                                   │
       │  [User continues speaking...]                   │
       │                                                   │
       │  4. Continue appending audio                     │
       │     ├───── input_audio_buffer.append             │
       │     ├───── input_audio_buffer.append             │
       │     └───── input_audio_buffer.append             │
       │                                                   │
       │                  ┌──────────────────────────────┐│
       │                  │  VAD Monitors Silence        ││
       │                  │                              ││
       │                  │  Silence Duration Threshold: ││
       │                  │  400ms (per config)          ││
       │                  │  Default: 500ms              ││
       │                  │                              ││
       │                  │  If 400ms+ silence detected: ││
       │                  │  → Speech ended              ││
       │                  └──────────────────────────────┘│
       │                                                   │
       │<──── 5. input_audio_buffer.speech_stopped ───────┤
       │          {                                       │
       │            type: "input_audio_buffer.speech..."  │
       │            event_id: "evt_125"                   │
       │          }                                       │
       │                                                   │
       │                  ┌──────────────────────────────┐│
       │                  │  Parallel Processing         ││
       │                  │                              ││
       │                  │  1. Transcription            ││
       │                  │     Model: gpt-4o-mini...    ││
       │                  │     Generates transcript     ││
       │                  │                              ││
       │                  │  2. Response Generation      ││
       │                  │     Model: gpt-realtime      ││
       │                  │     Creates audio response   ││
       │                  │     to user's speech         ││
       │                  └──────────────────────────────┘│
       │                                                   │
       │  6. Multiple events arrive simultaneously         │
       │                                                   │
       │<────── conversation.item.created ────────────────┤
       │          {                                       │
       │            type: "conversation.item.created"     │
       │            item: {                               │
       │              id: "msg_ABC"                       │
       │              type: "message"                     │
       │              role: "user"                        │
       │              content: [...]                      │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │<─── conversation.item.input_audio... ────────────┤
       │          (input audio transcription events)      │
       │                                                   │
       │<──── conversation.item.input_audio_... delta ────┤
       │          Incremental transcript:                 │
       │          "What is" → "What is the" →            │
       │          "What is the weather" → ...             │
       │                                                   │
       │<──── conversation.item.input_audio_... done ─────┤
       │          Final transcript: "What is the weather?"│
       │                                                   │
       │<────────── response.created ────────────────────┤
       │          {                                       │
       │            type: "response.created"              │
       │            response: {                           │
       │              id: "resp_XYZ"                      │
       │              status: "in_progress"               │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │<────── response.content_part.added ──────────────┤
       │          {                                       │
       │            type: "response.content_part.added"   │
       │            part: {                               │
       │              type: "audio"                       │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │<─ response.output_audio_transcript.delta ────────┤
       │          Incremental response transcript:        │
       │          "The" → "The weather" → ...             │
       │                                                   │
       │<────── response.output_audio.delta ──────────────┤
       │          {                                       │
       │            type: "response.output_audio.delta"   │
       │            delta: "base64_audio_chunk"           │
       │          }                                       │
       │                                                   │
       │  7. Decode and play audio in real-time           │
       │     As chunks arrive (streaming)                 │
       │                                                   │
       │<────── response.output_audio.delta ──────────────┤
       │<────── response.output_audio.delta ──────────────┤
       │<────── response.output_audio.delta ──────────────┤
       │        [many more chunks...]                     │
       │                                                   │
       │<─ response.output_audio_transcript.done ─────────┤
       │          Final response text:                    │
       │          "The weather is sunny, 72°F"            │
       │                                                   │
       │<────── response.output_audio.done ────────────────┤
       │          {                                       │
       │            type: "response.output_audio.done"    │
       │          }                                       │
       │                                                   │
       │<───────────── response.done ──────────────────────┤
       │          {                                       │
       │            type: "response.done"                 │
       │            response: {                           │
       │              id: "resp_XYZ"                      │
       │              status: "completed"                 │
       │              output: [...]                       │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │  ✅ RESPONSE COMPLETE                             │
       │     Audio played to speaker                      │
       │     Transcript visible to user                   │
       │                                                   │
       │  Ready for next user input                       │
       │
       └───────────────────────────────────────────────────
```

---

## Flow 3: Onboarding Conversation (User's Perspective)

```
┌──────────────────────────────────────────────────────────────┐
│                    BROWSER UI STATE                          │
└──────────────────────────────────────────────────────────────┘

1. LANDING PAGE (First Visit)
   ┌────────────────────────────────────┐
   │ "Most businesses don't have enough │
   │ conversations with the right       │
   │ people."                            │
   │                                     │
   │ [See how] ← CTA Button              │
   └────────────────────────────────────┘

   User clicks: [See how]
   → Navigate to /experience


2. OPENING QUESTION
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "Hi. What does your business       │
   │ sell?"                              │
   │                                     │
   │ [Text input box]                    │
   │ → User types: "I run a fitness     │
   │   studio focused on boxing"        │
   └────────────────────────────────────┘

   Backend: Store answer in session


3. ZEYA'S HYPOTHESIS
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "So you're filling classes with   │
   │ consistent revenue from members.   │
   │ You're probably dealing with one  │
   │ of three things:                  │
   │                                    │
   │ One: finding the right audience   │
   │ in the first place                │
   │                                    │
   │ Two: converting interest into     │
   │ actual bookings                   │
   │                                    │
   │ Three: building relationships so  │
   │ they stay and refer friends       │
   │                                    │
   │ Which one is the toughest right   │
   │ now?"                              │
   │                                    │
   │ [Option A] [Option B] [Option C]  │
   │ OR                                 │
   │ [Text input]                       │
   └────────────────────────────────────┘

   User selects: "Option Two - Conversion"
   Backend: Store choice


4. TRANSITION TO DEMO
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "When someone says they're        │
   │ interested — what's usually       │
   │ happening when they don't book?"  │
   │                                    │
   │ [Text input box]                   │
   │ → User types: "They need time to  │
   │   think about it"                 │
   │                                    │
   │ ZEYA:                              │
   │ "Got it. Here's what I want to    │
   │ show you. I'm going to play a     │
   │ call with someone just like       │
   │ your prospects—a fitness          │
   │ enthusiast who's uncertain. Watch │
   │ what happens when they say        │
   │ 'I'm interested but I'm not       │
   │ sure.'"                            │
   │                                    │
   │ [Play Demo Call Button]            │
   └────────────────────────────────────┘


5. DEMO CALL PLAYER
   ┌────────────────────────────────────┐
   │                                    │
   │  [Video/Audio Player]              │
   │  [Audio waveform or video frame]   │
   │                                    │
   │  AGENT: "Hi, is this Sarah?"      │
   │  PROSPECT: "Yeah, hi."             │
   │                                    │
   │  AGENT: "I'm calling because you   │
   │  downloaded our free trial class  │
   │  info yesterday. Did you get a    │
   │  chance to look at it?"            │
   │                                    │
   │  PROSPECT: "I did, yeah. It looks │
   │  interesting, but honestly... I'm │
   │  not sure if boxing is for me."   │
   │                                    │
   │  AGENT: "I hear that a lot. And   │
   │  I'll tell you what—most people   │
   │  who come to us say the exact     │
   │  same thing. Here's what's        │
   │  actually true: boxing is one of  │
   │  the few classes where your       │
   │  fitness level doesn't matter on  │
   │  day one. You're working against  │
   │  a heavy bag, not comparing       │
   │  yourself to anyone else. The     │
   │  rhythm is what matters."          │
   │                                    │
   │  PROSPECT: "Okay... yeah. I mean, │
   │  when could I try a class?"       │
   │                                    │
   │  AGENT: "Tomorrow morning we have │
   │  a 6 AM and a 9:30. Or Thursday   │
   │  evening. What fits?"              │
   │                                    │
   │  PROSPECT: "Thursday evening."    │
   │                                    │
   │  AGENT: "Perfect. I'm putting you │
   │  down for Thursday 6 PM. Sound    │
   │  good?"                            │
   │                                    │
   │  PROSPECT: "Yeah, I'll be there."  │
   │                                    │
   │  [90 seconds total]                │
   │                                    │
   │  ────────────────────────────────  │
   │  [Continue Button]                │
   └────────────────────────────────────┘


6. POST-CALL REFLECTION
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "What did you notice?"             │
   │                                    │
   │ [Text input box]                   │
   │ → User types: "She reframed it as │
   │   discovery, not a fitness test"  │
   │                                    │
   │ ZEYA:                              │
   │ "Right. She heard 'I'm not        │
   │ athletic' and reframed it as      │
   │ 'you're not competing, you're     │
   │ learning.' That's the thing that  │
   │ converts uncertain people into    │
   │ bookings.                          │
   │                                    │
   │ That's what I do. I understand    │
   │ your business and I represent it  │
   │ in a way that makes sense to      │
   │ prospects.                         │
   │                                    │
   │ So here's where we go from here.  │
   │ You have three options:"           │
   │                                    │
   │ [A] START NOW                     │
   │     Set this up for your studio.  │
   │     Five minutes.                  │
   │                                    │
   │ [B] SEE TAILORED VERSION           │
   │     I'll build it specifically    │
   │     for boxing studios.            │
   │                                    │
   │ [C] SHARE WITH TEAM                │
   │     I'll send you everything you  │
   │     just saw.                      │
   │                                    │
   │ What makes sense?"                 │
   └────────────────────────────────────┘

   User selects: [A] START NOW


7. ACCOUNT CREATION
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "Great. I'm going to build out    │
   │ your profile with everything      │
   │ you've told me.                    │
   │                                    │
   │ I need three things:               │
   │                                    │
   │ [Name]          [Text input]       │
   │                                    │
   │ [Email]         [Text input]       │
   │                                    │
   │ [Password]      [Text input]       │
   │                                    │
   │ [Start representing my business]  │
   │  → Button                          │
   └────────────────────────────────────┘

   Backend: Create account, store profile


8. WORKSPACE ENTRY (No Onboarding)
   ┌────────────────────────────────────┐
   │ ZEYA:                              │
   │ "Welcome to your briefing room,   │
   │ [Name].                            │
   │                                    │
   │ Here's what I understand:          │
   │ - You run a boxing studio         │
   │ - You fill classes with recurring │
   │   members                         │
   │ - The bottleneck is converting   │
   │   interest into bookings          │
   │                                    │
   │ Here's my first plan:              │
   │ Call 20 prospects in [City] who   │
   │ have shown interest in fitness    │
   │ classes. Reframe boxing as        │
   │ personal discovery, not a fitness │
   │ test. Book classes.                │
   │                                    │
   │ Ready to start? Or should we      │
   │ refine the approach first?"        │
   │                                    │
   │ [Start Now] [Let's refine it]     │
   └────────────────────────────────────┘

   ✅ ONBOARDING COMPLETE
      Next: Dispatch first mission
```

---

## Flow 4: Error Handling Paths

```
┌──────────────┐                                    ┌──────────────────┐
│   Browser    │                                    │   OpenAI API     │
└──────┬───────┘                                    └──────┬───────────┘
       │                                                   │
       │  1. Session Creation Fails                       │
       │     (Bad API key, invalid payload, etc.)         │
       │                                                   │
       ├───────── POST /api/openai/realtime/session ─────>│
       │                                                   │
       │                    Error: 401 Unauthorized        │
       │                    or 400 Bad Request             │
       │                                                   │
       │<───────── Return error to client ────────────────┤
       │          {                                       │
       │            error: "OpenAI API Error (401)..."   │
       │            details: { status: 401 }              │
       │          }                                       │
       │                                                   │
       │  Server logs detailed error info ✅               │
       │                                                   │
       │  2. WebRTC Connection Fails                       │
       │     (Bad SDP, network issue)                      │
       │                                                   │
       │  Client cannot connect to wss://api.openai...    │
       │                                                   │
       │  Browser detects error:                          │
       │  WebSocket close event with error                │
       │                                                   │
       │  Client logs:                                    │
       │  "WebRTC connection failed: [reason]"            │
       │                                                   │
       │  3. VAD Timeout                                  │
       │     (No speech detected for 30+ seconds)         │
       │                                                   │
       │<──────── input_audio_buffer.timeout_triggered ───┤
       │          {                                       │
       │            type: "input_audio_buffer.timeout..."│
       │            event_id: "evt_xyz"                  │
       │          }                                       │
       │                                                   │
       │  Client logs idle timeout                       │
       │  Prompts user to continue speaking              │
       │                                                   │
       │  4. Transcription Fails                          │
       │     (Corrupted audio, unsupported language)      │
       │                                                   │
       │<──── conversation.item.input_audio_... failed ───┤
       │          {                                       │
       │            type: "conversation.item.input_..."   │
       │            status_details: {                     │
       │              type: "failed"                      │
       │              error: { type: "server_error" }     │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │  Client logs transcription error                │
       │  Shows user: "Couldn't understand audio"        │
       │  Allows retry                                    │
       │                                                   │
       │  5. Response Generation Fails                    │
       │     (Max tokens, content filter, system issue)   │
       │                                                   │
       │<───────── response.done ──────────────────────────┤
       │          {                                       │
       │            status: "failed"                      │
       │            status_details: {                     │
       │              reason: "error"                     │
       │              error: { type: "server_error" }     │
       │            }                                     │
       │          }                                       │
       │                                                   │
       │  Client logs response error                     │
       │  Retries or shows user error message            │
       │
       └───────────────────────────────────────────────────
```

---

## Data Flow Timing

```
Timeline of a typical conversation turn:

User starts speaking:
  t=0ms    User says: "Hello"
  t=100ms  Audio appended (chunk 1)
  t=200ms  Audio appended (chunk 2)
  t=300ms  Audio appended (chunk 3)
  t=400ms  User finishes speaking

  ├─ VAD detects speech onset (at ~t=50ms)
  │  → input_audio_buffer.speech_started event
  │
  ├─ User continues with more audio chunks
  │
  └─ VAD detects silence for 400ms (threshold)
     → input_audio_buffer.speech_stopped event
     → Server starts processing

Server processing (parallel):
  t=0ms    Transcription starts
  t=50ms   Response generation starts
  
  ├─ Transcription:
  │  t=100ms → First transcript chunk: "H"
  │  t=150ms → "He"
  │  t=200ms → "Hel"
  │  t=300ms → "Hello"
  │  t=350ms → FINAL: "Hello"
  │
  └─ Response generation:
     t=50ms   → conversation.item.created (user message)
     t=100ms  → response.created
     t=150ms  → response.content_part.added
     t=200ms  → First audio chunk arrives
     t=250ms  → Audio chunk 2
     t=300ms  → Audio chunk 3
     t=400ms  → Audio playback begins to user
     t=600ms  → Final audio chunk
     t=650ms  → response.done

Total time: ~650ms from end of user speech to completion
Actual response latency perceived by user: ~400ms (starts playing before complete)
```

---

## State Diagram: Session Lifecycle

```
┌─────────────────┐
│     INITIAL     │
└────────┬────────┘
         │
         │ User clicks "See how" / enters onboarding
         │ Browser calls: POST /api/openai/realtime/session
         │
         ▼
┌──────────────────────────┐
│  FETCHING_CLIENT_SECRET  │
│                          │
│ Waiting for OpenAI to    │
│ return ephemeral token   │
└────────┬─────────────────┘
         │
         │ ✅ Token received: "ek_live_ABC..."
         │ ❌ Error: Treat as fatal
         │
         ▼
┌──────────────────────────┐
│  ESTABLISHING_WEBRTC     │
│                          │
│ Browser creates          │
│ RTCPeerConnection        │
│ Generates SDP offer      │
│ POSTs to /v1/realtime/.. │
└────────┬─────────────────┘
         │
         │ ✅ SDP answer received, WebSocket opens
         │ ❌ Network error: Retry or show error
         │
         ▼
┌──────────────────────────┐
│  WAITING_SESSION_CREATED │
│                          │
│ WebSocket open           │
│ Listening for events     │
└────────┬─────────────────┘
         │
         │ Receives: session.created event
         │
         ▼
┌──────────────────────────┐
│     SESSION_READY        │  ◄──────────┐
│                          │             │
│ Ready for audio input    │             │
│ Microphone armed         │             │
└────────┬─────────────────┘             │
         │                               │
         │ User speaks                   │
         │ Audio appended                │
         │                               │
         ▼                               │
┌──────────────────────────┐             │
│   WAITING_SPEECH_STOP    │             │
│                          │             │
│ VAD monitoring audio     │             │
│ speech_started emitted   │             │
└────────┬─────────────────┘             │
         │                               │
         │ 400ms+ of silence detected    │
         │                               │
         ▼                               │
┌──────────────────────────┐             │
│  PROCESSING_RESPONSE     │             │
│                          │             │
│ Transcription running    │             │
│ Response generation      │             │
│ Audio streaming          │             │
└────────┬─────────────────┘             │
         │                               │
         │ response.done event           │
         │ (or response.done with        │
         │  status: "failed")            │
         │                               │
         └───────────────────────────────┘
            (loops back to SESSION_READY)

Exit states:
  - ERROR: WebRTC connection fails
  - CLOSED: User disconnects
  - TIMEOUT: Idle 30+ seconds
  - MAX_RETRIES: Multiple failures
```

---

## Message Exchange Summary

### Total Events Expected in One Turn

**User Speech → Response Completion:**

1. `input_audio_buffer.append` (multiple)
2. `input_audio_buffer.speech_started`
3. `input_audio_buffer.append` (more)
4. `input_audio_buffer.speech_stopped`
5. `conversation.item.created`
6. `conversation.item.input_audio_transcription.delta` (multiple)
7. `conversation.item.input_audio_transcription.completed`
8. `response.created`
9. `response.content_part.added`
10. `response.output_audio.delta` (many)
11. `response.output_audio_transcript.delta` (multiple)
12. `response.output_audio_transcript.done`
13. `response.output_audio.done`
14. `response.output_item.added`
15. `response.output_item.done`
16. `response.done`

**Total: 16 event types, ~30-50 individual messages**

---

Last updated: 2026-06-13
