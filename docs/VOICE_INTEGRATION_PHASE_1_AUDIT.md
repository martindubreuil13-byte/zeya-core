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

## Known release gates

- `20260714_voice_representation_lineage.sql` must be deployed before production voice dispatch uses lineage persistence.
- The exact deployed definition of `zeya_create_canonical_version` remains open reproducibility debt and is still required before production release.
