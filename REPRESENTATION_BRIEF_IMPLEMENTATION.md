# REPRESENTATION BRIEF V1 — IMPLEMENTATION DECISION

## CURRENT STATE AUDIT

### Architecture
- Zeya conversation: stored in `voice_transcript[]` (client), `voice_conversation_outputs` (server)
- Veya call: stored in `voice_conversation_outputs` (server)
- Session: `public_experience_sessions` table with standard state machine
- Reflection: `/api/experience/session/reflection` endpoint already fetches Veya output and derives call outcome
- Conversation analysis: `analyzeConversationInsights()` utility exists with extraction logic

### Current Completion Flow
1. Experience → Phone → Handoff → Waiting for call
2. Polling `/api/experience/session/reconcile` checks for `reflection_ready` state
3. When ready, fetches `/api/experience/session/reflection`
4. Returns: `outcome` (call interest), `reflection` (summary + observations)
5. UI shows generic completion with "Learn more" button

### Storage Pattern
- No explicit Representation Brief column in `public_experience_sessions`
- Reflection data is computed on-demand and not persisted in main session
- Session state is controlled (write-protected triggers in DB)

## INTEGRATION DECISION

### Approach: Extend Existing Reflection Endpoint

**Why this approach:**
1. Avoids DB schema migration (no new columns needed)
2. Brief is computed when reflection is ready (same timing as call outcome)
3. Reuses existing authorized session retrieval
4. Brief is part of reflection context, not a separate entity
5. Keeps public_experience_sessions write-protected
6. Allows caching/idempotency through ETag or generation ID

**Implementation path:**
1. Create `RepresentationBrief` type in `/types/experience/index.ts`
2. Create generator: `/lib/experience/representation-brief-generator.ts`
   - Takes: Zeya transcript + Veya transcript + session identity + extracted insights
   - Returns: structured brief with evidence sources
   - Validates: evidence, interpretation, governance gates
3. Extend `/api/experience/session/reflection` route to generate and return brief
4. Update UI `completed` phase to display brief + response capture
5. Add tests for generation, validation, authorization

### What NOT to do
- Do not persist brief in `public_experience_sessions` (no new columns)
- Do not create a separate `representation_briefs` table (out of scope)
- Do not make the brief part of approved Representation (it's a proposal)
- Do not expose internal generator prompts or reasoning to visitor

### Data Flow
```
Waiting for call
  ↓ (polling /api/experience/session/reconcile)
State transitions to reflection_ready
  ↓ (polling detects change, fetches /api/experience/session/reflection)
Reflection endpoint:
  1. Load Zeya conversation output
  2. Load Veya conversation output + transcript
  3. Load extracted candidates/insights
  4. Load session identity (name, offer, customer)
  5. Generate RepresentationBrief
  6. Validate (evidence, interpretation, governance)
  7. Return { outcome, reflection, brief }
  ↓
UI completed phase:
  1. Display brief with sections
  2. Visitor can confirm/refine/redirect
  3. Response stored in session metadata (client-side)
  4. Transition to "What this could become" section
```

### Idempotency
Brief generation will be **deterministic** based on fixed inputs:
- Same Zeya transcript → same observations extracted
- Same Veya transcript → same patterns identified
- Same identity → same context

Repeated calls to `/api/experience/session/reflection` will generate identical briefs.

### Production Quality Gates
1. **Evidence test** — All claims traceable to actual utterances
2. **Interpretation test** — Brief adds meaning, not just recap
3. **Governance test** — Proposes without mandating, invites confirmation
4. **Word count** — 150-250 words target, 320 hard limit
5. **Authorization** — Only valid Experience token can retrieve
6. **Regression** — Existing reflection tests still pass

### Rollout
- V1: Generation + endpoint + UI display
- Brief response capture (confirm/refine) deferred to next increment
- "What this could become" section deferred to Phase 5.5 continuation

---

## NEXT STEPS

Proceed with:
1. Increment 2 — Types and generator
2. Increment 3 — Reflection endpoint extension
3. Increment 4 — UI integration
4. Increment 5 — Speech narration
5. Increment 6 — Testing and regressions
