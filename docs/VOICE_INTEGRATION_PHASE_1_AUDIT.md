# Voice Integration Phase 1 Architecture Audit

## Existing architecture

- Zeya realtime sessions are created by `hooks/realtime/useRealtimeBriefingSession.ts`, `lib/realtime/openai-realtime-client.ts`, and `app/api/openai/realtime/briefing-session/route.ts`.
- Veya outbound calls are created by `lib/workers/worker-dispatcher.ts` through the provider boundary in `lib/providers`, with ElevenLabs SIP payload construction in `lib/providers/elevenlabs-provider.ts`.
- Worker briefs are created in `lib/workers/worker-brief-builder.ts` and persisted by `lib/workers/worker-brief-repository.ts`.
- Conversation and provider IDs are persisted in `brief_conversation_mappings`; webhook capture and outcomes live under `lib/voice/events`, `lib/voice/outcomes`, and `app/api/webhooks/elevenlabs`.
- Tenant identity for authenticated Zeya sessions is the bearer-authenticated Supabase user. Veya dispatch receives a trusted server-side Business ID and resolves its owner before context assembly.
- Agent identity is the Zeya realtime agent identity or the dispatched WorkerBrief worker identity.

## Previous context and prompt path

- Zeya briefing voice accepted a browser-supplied `business_context` string and inserted it directly into the realtime system prompt.
- WorkerBriefs included `companyContext`, lead context, objectives, and arbitrary dynamic variables. The dispatcher forwarded all dynamic variables to ElevenLabs.
- ElevenLabs development logs printed dynamic-variable values and the provider payload.
- Conversation mappings recorded Business, mission, brief, conversation, and provider identifiers, but not the canonical Representation Version or authorized Element set.

These paths could bypass Canonical Representation filtering and could reintroduce internal, disputed, prohibited, expired, or otherwise unapproved facts after the authorized-context boundary.

## Selected integration point

`lib/voice/representation-context.ts` is the single read-only assembly boundary. It verifies Business ownership, resolves the tenant's current Business Representation and canonical Version, calls the existing authorized agent-context service, validates identifiers, and produces both a voice-safe context and immutable lineage metadata.

- Zeya realtime uses this service in the authenticated briefing-session route.
- Veya uses it in `dispatchWorkerBrief` before persistence or provider dispatch.
- `buildVoiceProviderVariables` creates an allowlisted final provider payload. Legacy WorkerBrief business variables are not merged into voice provider context.
- `voice_representation_lineage` stores stable identifiers and authorized Element keys without duplicating claim values or prompts.

## Final data flow

Authenticated user or trusted mission Business → ownership verification → current Business Representation and Version → authorized agent-context service → runtime validation → voice-safe prompt/provider variables → lineage persistence → external provider boundary → provider/conversation ID attachment.

## Security boundaries

- Context assembly has no Canonical Representation write operations.
- Provisional mode is an explicit boolean and defaults to false.
- Missing, foreign, inconsistent, or empty authorized context fails closed.
- Full prompts and dynamic-variable values are not written to ordinary provider logs.
- Provider callbacks continue to resolve conversations through existing mappings; lineage is tenant-scoped with RLS and relational Business/Representation/Version constraints.

## Deployment and behavioral verification

- `20260714_voice_representation_lineage.sql` and `20260715_voice_lineage_controlled_purge_patch.sql` were manually deployed successfully on 2026-07-15.
- The checked-in purge patch retains the deployed function signature and controlled-purge lifecycle, deletes lineage by both Business Representation and Business after Confidence Assessments and before pointer clearing and Version deletion, and returns the exact `voice_representation_lineage` count.
- Deployed authorization passed for anonymous denial, authenticated own-row SELECT with direct-write and privileged-RPC denial, service-role direct-write denial, service-role SELECT, service-role RPC access, and mismatched-lineage rejection.
- Valid lineage creation, multiple lineage rows, provider attachment, identical-attachment idempotency, conflicting identifier rejection, and wrong-Business purge rejection passed against the deployed database.
- The authenticated Zeya briefing route persisted lineage matching its authorized context and final allowlisted provider variables. Browser-supplied business facts were ignored.
- The Veya dispatcher, provider abstraction, and ElevenLabs adapter persisted and attached lineage matching the final provider-bound variables. Legacy WorkerBrief business variables and restricted Representation values were excluded.
- New-Version and rollback context selection passed. Historical canonical Versions remained immutable, and rollback advanced the active element pointers and voice context to the rollback-created Version.
- Voice context assembly, lineage creation, and provider attachment did not mutate Evidence, Observations, Proposals, Approval Decisions, Versions, Confidence Assessments, Audit Events, elements, eligibility, dispute, or rollback state.
- Controlled purge reported the exact lineage count and removed all registered lineage, Representation State, Business, and Auth fixtures. No recovery artifact or dynamic test server remained.
- A deliberate failure after the lineage-delete statement was not injected because no isolated production-safe failure mechanism exists in the deployed function. Transactional rollback for the wrong expected Business was proven; later-step rollback remains unexecuted by design.

## Logging and security verification

- Phase 1 targeted ESLint passed with zero errors.
- Repository lint still reports the 29 documented unrelated pre-existing errors.
- Ordinary Phase 1 logs contain identifiers, status, key names, counts, timestamps, and redacted phone metadata; they do not log provider variables, claim values, full prompts, credentials, or tokens.
- `/api/elevenlabs/variables-audit` remains permanently retired and returns HTTP 410 without accepting a request body.
- A private-value scan of source, tests, migrations, documentation, and clean production output found zero matches. Development-server cache artifacts containing server environment values were deleted before the clean production rebuild.

## Release decision

- Voice Integration Phase 1 release decision on 2026-07-15: GO. The remaining items below are non-blocking release-hardening debt for Phase 1.
- Remaining hardening proofs: isolated later-step controlled-purge rollback injection; persisted historical lineage across both a newly current Version and a rollback-created Version; unrelated-tenant lineage survival during multiple-lineage purge; and a provider-failure lineage recovery assertion.
- The later-step controlled-purge rollback injection was intentionally unexecuted because no safe isolated failure mechanism was available.
- The exact deployed definition of `zeya_create_canonical_version` remains open reproducibility debt and is required before production release.
