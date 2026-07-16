# Conversation Review and Promotion

## Architecture audit

Phase 3 extends the existing Founder Briefing Room and the deployed immutable conversation-output/candidate model. The authoritative pre-canonical write path remains Evidence → Observation → Representation Proposal. Approval Decisions, canonical Versions, Confidence Assessments, contradiction handling, rollback, and canonical Audit Events are untouched. No prior review/promotion implementation existed.

## Review model and state machine

`conversation_candidate_review_decisions` is append-only. Effective state is the latest decision: pending (no decision) may become deferred or terminal; deferred may repeat or become terminal. Rejected, duplicate, acknowledged, and accepted-for-promotion are terminal. Request UUIDs and candidate locks make exact replay idempotent and conflicting replay fail.

`conversation_candidate_promotions` is a one-to-one immutable link from a terminal accepted decision to exactly one Evidence, Observation, or Representation Proposal target. It preserves extracted and founder-confirmed content separately without changing the candidate.

There are two deliberately separate idempotency identities. Request-key identity detects exact replay and conflicting reuse of the same request UUID. Promotion-configuration identity hashes the complete normalized promotion configuration without the request key, allowing a different request UUID to converge on the already completed promotion only when the configuration is identical.

## Promotion mapping and canonical gating

- `candidate_evidence` may create Evidence only when provider-attested and spoken by a customer, founder, or staff member.
- Observation-oriented customer intelligence may create an Observation.
- Gaps, possible contradictions, and selected customer intelligence may create a draft Proposal.
- Operational-only candidate types cannot promote.

Promotion never creates an Approval Decision, canonical Version, Confidence Assessment, canonical Audit Event, or current Element value. Possible contradictions remain proposals or observations until the existing pipeline evaluates them.

Phase 2 source references use zero-based transcript indexes. Evidence promotion resolves every `source_reference.turnIndexes` member against the immutable stored transcript and rejects empty, nonnumeric, null, fractional, negative, duplicate, out-of-range, malformed-turn, and human-speaker/agent-turn mismatches before any review or target row is written.

`RepresentationStateAdapter.createObservation` stores its `affectedElements` input directly in `observations.affected_elements`. The authoritative service supplies Representation Element UUIDs, so Phase 3 stores the selected Element UUID as a text-array member. Proposal promotion uses the persisted Element row and creates the complete high-risk, pending-approval Evidence → Observation → Proposal graph; it cannot create canonical truth.

## Authorization, immutability, and provenance

Authenticated tenants have own-row SELECT only. Tables deny direct writes to anonymous, authenticated, and service-role roles. Controlled SECURITY DEFINER functions derive tenant, Business, Representation, Version, Voice Context, trust, and extraction identity from locked source rows. Functions use an empty search path, qualified names, no dynamic SQL, and sanitized errors. Immutable triggers allow deletion only inside the existing transaction-local controlled purge.

The queryable chain is canonical-pipeline target → promotion → decision → candidate → output → Voice lineage → conversation-time canonical Version. Full transcripts are not copied into canonical tables.

## Founder Briefing Room

The conversation review panel is embedded in `ZeyaBriefingRoom`. It provides conversation and candidate filters, trust labels, safe transcript viewing, review history, focused promotion confirmation, exact founder wording, loading/error/empty states, and tenant-safe API access. It avoids CRM concepts and never labels reviewed material canonical or approved.

## Concurrency and purge

Candidate row locks, request-key uniqueness, one-promotion-per-candidate uniqueness, and terminal-state checks handle duplicate tabs and races transactionally. Promotion target creation, accepted decision, and linkage occur in one transaction. The purge extension deletes promotions, decisions, candidates, outputs, lineage, then existing Representation descendants and reports exact counts.

## Manual deployment

1. Run `docs/database/preflight/conversation_review_and_promotion_preflight.sql`; stop unless every section returns zero rows.
2. Run `docs/database/preflight/phase2_purge_baseline.sql` against the deployed database and pin its returned definition and MD5. The repository cannot establish this deployed value locally.
3. Review and run `supabase/migrations/20260715120000_conversation_review_and_promotion.sql` in Supabase SQL Editor.
4. Compare the purge patch line by line with the pinned Phase 2 definition. Proceed only if the two Phase 3 deletion/count blocks are the only differences and owner, SECURITY DEFINER, search path, ACL, order, and all other behavior are unchanged.
5. Review and run `supabase/migrations/20260715121000_conversation_review_controlled_purge_patch.sql` in the same environment.
6. Run `docs/database/verification/conversation_review_and_promotion_verification.sql`.
7. Run the local and deployed test commands documented in the release package.

Rollback is the fully transactional manual file under `docs/database/rollbacks`; after it succeeds, restore the exact previously deployed Phase 2 purge definition. Never add the rollback file to migrations.

## Privacy and remaining risks

Application logs contain only safe categories and IDs. They do not log transcripts, candidate content, founder edits, notes, rationale, provider payloads, tokens, or private configuration. Deployment and deployed authorization/transaction tests remain required. Phase 2 hardening debt remains: signed ElevenLabs webhook replay, safe late purge rollback injection, transcript retention/deletion policy, and durable extraction retry scheduling.
