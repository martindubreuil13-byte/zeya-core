# Voice Integration Phase 2 — Conversation Output Capture

## Architecture audit

Zeya realtime currently receives final transcript turns in `useRealtimeBriefingSession`, stores them as business-memory messages, and invokes the legacy memory processor when the user ends a session. That path does not preserve an immutable transcript linked to the Voice Representation lineage used to authorize the conversation.

Veya receives ElevenLabs `post_call_transcription` webhooks, keeps the provider conversation in an in-memory store, derives a `call_outcomes` record, and creates a memory event. Persistent brief/conversation mappings survive restarts, but existing outcome persistence does not structurally bind transcript provenance to the canonical Version used during dispatch. The prior in-memory webhook deduplication also does not survive a server restart.

The minimal shared integration point is a lineage-bound conversation-output service invoked by both the authenticated Zeya completion route and the trusted ElevenLabs webhook processor. Provider-specific capture ends at a normalized turn array; storage and extraction are shared.

## Data model and provenance

`voice_conversation_outputs` stores one capture per `voice_context_id`. Tenant, Business, Business Representation, canonical Version, and agent identity are copied only from `voice_representation_lineage` inside a service-role-only database function. Composite foreign keys prevent mixed lineage identities. Capture source, submitting user, provider attestation, and transcript trust level are persisted explicitly. A finalized transcript is immutable.

`voice_conversation_candidates` stores typed, non-canonical review candidates. Every candidate is tied structurally to its output, tenant, and Business and defaults permanently to `pending_review` in this phase. It stores source turn references, speaker role, statement kind, confidence, rationale, and relevant authorized Element keys without inserting Canonical Representation records.

## Capture flows

- Zeya: the briefing-session response supplies the server-created voice-context ID to the realtime client. Final turns are reconstructed from authenticated WebRTC browser events and relayed to an authenticated completion route. They are explicitly classified as `authenticated_client_relay`, are not provider-attested, and cannot create candidate Evidence. The route verifies that lineage is visible to the user and that its server-stored conversation ID matches before invoking the privileged capture boundary.
- Veya: the signed provider webhook resolves the stored lineage by the finalized conversation ID. Tenant and canonical identifiers are never accepted from the callback. Normalized provider turns, completion status, duration-derived timestamps, and safe metadata are passed to the same capture boundary.

Capture is idempotent only when every persisted caller-supplied field is null-safe identical; any conflicting provenance, timing, transcript, outcome, schema version, or normalized JSONB safe metadata is rejected. A provider call ID is always derived from stored lineage: callers may omit it or supply the identical value, but cannot introduce or conflict with it. Veya can create a status-only output with zero turns for a failed or incomplete call. A provider callback may perform exactly one transition from an empty `missing`, `pending`, or `unavailable` status-only transcript to a provider-attested finalized transcript; replay additionally requires identical effective completion time, conversation status, and completion reason. Conflicting replacement or outcome metadata is rejected. Failed extraction remains retryable through the controlled processing-status function. Candidate extraction stores one immutable schema version, normalized JSONB result hash, and candidate count per output. This makes identical nonempty and zero-candidate results durable and rejects conflicting replays. The storage RPC independently validates candidate structure, Evidence trust and speaker rules, and the complete authorized Element-key subset from stored lineage.

## Structured extraction and safety

The shared extractor uses a stable system instruction through the existing OpenAI SDK and sends transcript content only as JSON user data. It exposes no tools. Runtime validation rejects unsupported types, invalid source references, unauthorized Element keys, prompt-injection output, and any attempt to classify a Zeya or Veya statement as candidate Evidence. Client-relayed transcripts cannot create candidate Evidence regardless of speaker classification. Possible contradictions remain candidate records only.

The implementation never writes Evidence, Observations, Proposals, Approvals, Versions, Confidence Assessments, Audit Events, Element eligibility, dispute state, or rollback state. Founder review and promotion remain out of scope.

## Authorization and privacy

- Anonymous users have no table or RPC access.
- Authenticated tenants have SELECT-only RLS access to their own output and candidate rows.
- Authenticated and service-role clients have no direct table writes.
- Capture and candidate persistence are available only through fixed-empty-search-path service-role functions.
- Ordinary logs may contain IDs, counts, provider names, statuses, schema versions, durations, and transcript lengths. Transcript text and candidate content are never logged by the new path.

## Deployment and deployed verification

Both Phase 2 migrations were deployed manually on July 15, 2026 and each completed with `Success. No rows returned`. The live PostgREST schema exposes both tables and all extraction-result marker columns. Behavioral authorization proved anonymous denial, tenant-scoped authenticated reads, foreign-row exclusion, service-role reads, denial of direct writes for all application roles including service role, denial of privileged RPC execution to anonymous and authenticated callers, service-role-only controlled execution, and denial of direct trigger-function execution.

Controlled purge order is candidates, outputs, Voice Representation lineage, then the existing canonical descendants in their deployed order. Counts are reported under `voice_conversation_candidates`, `voice_conversation_outputs`, and `voice_representation_lineage`.

The deployed integration runner proved authenticated Zeya capture with an injected external extraction-model boundary, exact replay, sanitized conflict behavior, client-relay Evidence rejection, provider-attested Veya shared capture/extraction, lineage-derived provider-call identity, full capture-field conflict behavior, status-only capture and one-way delayed finalization, durable nonempty and zero-candidate extraction, RPC validation, processing transitions, tenant isolation, wrong-Business purge safety, exact controlled-purge counts, Canonical State invariance, disabled diagnostic behavior, and exact cleanup.

Phase 2 has final GO status. Privileged catalog verification passed for defaults, constraints, owners, ACL arrays, fixed search paths, triggers, and the deployed purge source. PostgreSQL catalog aliases `int4 = integer` and `bool = boolean` were confirmed. A deliberate later-stage purge failure was not injected because no safe isolated failure mechanism was available without creating a temporary production database object. Wrong-Business failure transactionality and normal exact purge behavior passed.

## Known limitations

- Zeya transcript capture necessarily crosses the authenticated browser/server boundary because OpenAI Realtime transcript events are received by WebRTC in the client. Tenant and canonical provenance remain server-resolved, but transcript content is explicitly unverified client-relayed data rather than trusted provider evidence.
- Extraction currently runs synchronously after capture. A durable background processing queue and delayed retry policy remain future hardening.
- Retention duration and transcript deletion policy require an explicit product/privacy decision before production release.
- Full signed ElevenLabs webhook ingestion was not replayed in the deployed Phase 2 runner; dispatch/provider boundary coverage and the shared provider-attested capture/extraction service passed independently.
- An isolated later-stage purge rollback injection remains production-hardening evidence debt; it is not a known runtime defect.

## Manual deployment

1. Run `supabase/manual/20260715_voice_conversation_output_preflight.sql` and stop on any unexplained collision.
2. Execute `supabase/migrations/20260715090000_voice_conversation_output_capture.sql` unchanged.
3. Run `supabase/manual/20260715_voice_conversation_purge_preflight.sql` and compare the complete deployed definition to the authoritative Phase 1 baseline.
4. Execute `supabase/migrations/20260715093000_voice_conversation_output_controlled_purge_patch.sql` unchanged.
5. Run `supabase/manual/20260715_voice_conversation_output_verification.sql`.

Manual emergency rollback uses `docs/database/rollbacks/voice_conversation_output_capture_rollback.sql`; it is deliberately outside `supabase/migrations` and cannot enter normal forward migration sequencing. In one transaction it restores the authoritative Phase 1 purge, removes the Phase 2 objects, drops the Phase 2-created lineage identity index, reloads PostgREST, and commits.
