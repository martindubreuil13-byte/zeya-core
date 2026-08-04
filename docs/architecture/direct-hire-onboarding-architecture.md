# Zeya Direct Hire Onboarding Architecture

**Version:** 1.0.0-draft

**Status:** Reconstructed approved design; subordinate to the Product Constitution

**Date:** 2026-08-04

## 1. Authority

This document specifies an alternative pre-Formation entry path for an owner who has already decided to hire Zeya. It does not add a Product Constitution stage or renumber the lifecycle.

The [Product Constitution](../product-constitution-customer-journey.md) remains authoritative. The [Business Representation Intelligence Constitution](../brain/00-constitution.md) governs honest representation, evidence, confidence, and uncertainty. The [First Day protocol](../brain/12-first-day-at-work.md) governs preparation and Formation posture. [RF-A](../representation-formation-rf-a.md) governs the Formation state and conversation-linkage boundary.

Where this specification conflicts with a governing document, the governing document wins.

## 2. Purpose

Direct Hire gives an authenticated owner who has already chosen to work with Zeya a quiet, employment-oriented first meeting. It collects the minimum context needed for honest preparation, preserves that preparation durably, and converges into Formation when equivalent readiness exists.

It must not send that owner through the persuasive Public Experience or simulate work that has not occurred.

## 3. Scope

This architecture covers:

- authenticated Direct Hire entry and routing;
- a five-screen first-meeting experience;
- the five-field basic business profile;
- durable preparation state and resume;
- preliminary public research as sourced, non-canonical evidence;
- the readiness gate and Formation lineage;
- failure, retry, tenant isolation, idempotency, and Screen Lab boundaries.

It ends when a prepared Direct Hire owner enters Formation. Formation and Canonical Approval remain separate governed processes.

## 4. Dual-path model

### Journey A — Public Experience

```text
Discovery
→ Public Experience
→ Representation Brief
→ Imagine Working Together
→ Hiring decision
→ Preparation
→ Formation
```

This is the prospect path. It lets a person experience Zeya before deciding whether to hire her. It may contain discovery, demonstration, calibration, commercial explanation, and an explicit hiring decision.

### Journey B — Direct Hire

```text
Account creation or sign-in
→ First meeting with Zeya
→ Basic business profile
→ Preparation
→ Formation
```

This is the already-hired owner path. It must not repeat persuasive dialogue, a hiring decision, or a second Public Experience.

### Convergence rule

The paths may share downstream preparation, Evidence, Observation, Formation, and Representation governance primitives only where their semantics are equivalent. They do not share the same pre-hire Experience session or persuasive presentation.

Both paths may enter Formation only when they have a reviewable preparation package sufficient for the first working session. Equivalent readiness does not require identical upstream records.

## 5. Entry triggers and routing

| Condition | Required destination |
|---|---|
| Signed-out person elects to experience Zeya | Public Experience |
| Signed-out owner elects Direct Hire | Authentication, then safe return to Direct Hire |
| Authenticated clean owner with no completed Direct Hire onboarding | `/onboarding` |
| Authenticated owner with in-progress Direct Hire onboarding | Durable current `/onboarding` state |
| Authenticated owner with Direct Hire preparation ready and no Formation | Formation handoff |
| Authenticated owner with active Formation | Exact Formation session |
| Authenticated owner with current canonical Version | Living Representation |
| Owner with multiple Businesses and no explicit selection | Explicit business-selection-required state |

`/formation/entry` remains the authenticated journey resolver. The clean-owner result must resolve to `/onboarding`, not `/experience?entry=owner`. Public `/experience` remains independently available.

Return paths must use the repository's safe relative-path handling. Phone numbers, profile values, state payloads, and record identifiers must not be placed in URLs.

## 6. State model

Direct Hire uses five owner-visible screens and a durable lifecycle beneath them.

| Durable state | Owner-visible surface | Meaning |
|---|---|---|
| `first_meeting` | First Meeting | Relationship acknowledged; profile not submitted |
| `profile_pending` | Basic Business Profile | Owner may enter or correct the five fields |
| `profile_received` | Preparation Begins | Valid profile is durably accepted |
| `preparation_queued` | Preparation Begins/Conversation | Work is queued but not represented as active |
| `preparation_in_progress` | Preparation Conversation | Bounded work is actually executing |
| `preparation_ready` | Closing / readiness | Preparation package meets the Formation gate |
| `preparation_failed` | Preparation error | Failure is durable and safely retryable |
| `formation_initiated` | Redirect/resume | Exact Formation lineage exists |

Transitions must be server-validated. The browser may render optimistic affordances, but React state is not authoritative.

```text
first_meeting → profile_pending → profile_received
profile_received → preparation_queued
preparation_queued → preparation_in_progress | preparation_failed
preparation_in_progress → preparation_ready | preparation_failed
preparation_failed → preparation_queued (explicit retry)
preparation_ready → formation_initiated
```

When no research executor exists, the honest MVP path is `profile_received → preparation_queued`. It must not advance through research steps merely to animate progress.

## 7. Profile contract

Collect exactly:

1. Owner name
2. Business name
3. Website
4. Best phone number
5. Product or service they most want to sell or grow

No additional profile question is part of this Direct Hire MVP.

Business name remains in `businesses.business_name`. The remaining relationship and lifecycle fields belong to the Direct Hire onboarding record. Selected profile values may later project into `businesses.business_profile` through an explicit, governed mapping; that aggregate is not the onboarding state machine.

## 8. Persistence requirements

Public Experience tables must not store Direct Hire lifecycle state. Their call, reflection, Brief, calibration, and hiring semantics describe a different journey.

One narrowly scoped persistence structure is required:

### `direct_hire_onboarding_sessions`

The future schema must represent, at minimum:

- immutable record identity;
- authenticated `owner_id`;
- `business_id` and `business_representation_id` lineage;
- owner relationship name;
- normalized website and submitted website value where required for correction;
- normalized best phone number with appropriate access controls;
- product/service growth priority;
- current onboarding state;
- preparation status and safe failure classification;
- profile received, preparation queued/started/ready/failed, Formation initiated, and update timestamps;
- retry count and latest retry timestamp;
- client or server idempotency identity;
- Formation session linkage once initiated.

The record must support refresh, sign-out/sign-in, recoverable errors, duplicate submission, and exact resume without generic browser storage.

No migration is part of this document.

## 9. Authentication and tenant isolation

Every Direct Hire page and mutation requires an authenticated Supabase user.

Server boundaries must:

- derive the owner from the verified bearer token, never request JSON;
- verify the Business belongs to that owner;
- verify the Business Representation belongs to the same owner and Business;
- reject ambiguous multiple-Business state;
- prevent owners from selecting or mutating another tenant's identifiers;
- use owner RLS for ordinary reads and a dedicated service client only for operations that genuinely require it;
- prevent a user bearer token from replacing a service-role Authorization header;
- return safe error codes without logging owner profile data or secrets.

## 10. Idempotency and concurrency

- At most one active Direct Hire onboarding session may exist for a Business Representation.
- Replaying the same profile submission must return the same durable state rather than create another Business, Representation, or onboarding session.
- Concurrent clean-owner provisioning must be duplication-safe.
- Preparation retry must reuse lineage and retain earlier failure history.
- Formation initiation must be idempotent and return the existing matching session.
- A conflicting session or lineage must fail closed rather than be silently adopted.

## 11. Evidence and canonical-truth boundaries

Owner-submitted values are attributed assertions. Website material is public evidence. Neither is automatically canonical Representation truth.

Future research must preserve:

- source URL and retrieval time;
- content or excerpt provenance;
- retrieval outcome and limitations;
- fact, owner assertion, public claim, observation, assumption, contradiction, and question as distinct concepts;
- prompt-injection and untrusted-content treatment.

Research output should become sourced, non-canonical `evidence`. Interpretations may become `observations`. Preparation may propose what Formation should test, but it must not create a canonical Version, update the current Version pointer, or grant external authority.

## 12. Background research responsibilities

The research boundary may inspect only permitted public information required to prepare for Formation. A later executor must:

- validate HTTP(S) URLs;
- prevent SSRF, private-network access, credential forwarding, DNS rebinding, and unsafe redirects;
- limit redirects, time, bytes, pages, and content types;
- record partial and unavailable outcomes honestly;
- treat fetched content as untrusted evidence;
- never contact prospects or submit forms;
- never report a research step complete unless its durable output exists.

Deep crawling is outside MVP scope.

## 13. Preparation responsibilities

Preparation should organize what is already available into a concise first-session package:

- what appears supported;
- preliminary impressions;
- contradictions and missing information;
- assumptions requiring owner review;
- a small number of material questions;
- the selected product/service priority;
- topics Zeya should not ask again;
- provenance and explicit research failures.

The package is an internal working preparation document, not a canonical Representation.

## 14. Formation convergence and lineage

Formation may begin only when:

- authenticated owner, Business, and Representation lineage is valid;
- the five-field profile has been durably accepted;
- preparation is `ready`, or an explicitly approved partial-readiness rule exists;
- a reviewable preparation package or explicit source-unavailable result exists;
- no conflicting active Formation exists;
- no path attempts to bypass current canonical governance.

Formation requires an explicit initiation source:

```text
direct_hire_onboarding
```

The current `formation_initiation_source` enum does not contain this value. A later approved migration must add it and preserve the Direct Hire onboarding identifier as Formation lineage.

Formation orchestration must not create or activate canonical truth. Canonical Version creation remains behind separate authenticated owner review and approval.

## 15. Failure and resume paths

| Failure | Required behavior |
|---|---|
| Authentication expired | Preserve durable state; sign in; return safely |
| Profile validation | Keep entered values in the active form; explain the affected field |
| Profile persistence | Do not claim receipt; allow safe resubmission |
| Website unavailable | Record unavailable/partial; do not invent findings |
| Preparation executor unavailable | Show queued or failed, not false progress |
| Preparation failed | Preserve sources and failure class; offer explicit retry |
| Formation initiation failed | Keep `preparation_ready`; retry idempotently |
| Refresh or new browser session | Load the authoritative server state |
| Multiple Businesses | Require explicit governed selection |

Phone data must not enter URLs, logs, analytics, Screen Lab fixtures, `localStorage`, generic `sessionStorage`, or client error telemetry.

## 16. Known Formation P1 defect

The current generic Formation advance path can move:

```text
working_conversation_pending → working_conversation_linked
```

without the governed `/link-conversation` endpoint. RF-A requires traceable governed conversation linkage for that transition. Direct Hire must not call, copy, bless, or normalize the generic shortcut. Repair remains a separate P1 implementation task.

## 17. Screen Lab requirements

Direct Hire Screen Lab surfaces must reuse the smallest practical production presentation layer and use local immutable fixtures that:

- use the `screenlab:` namespace;
- avoid valid UUIDs where possible;
- contain no real phone number;
- invoke no database persistence or RPC;
- invoke no OpenAI, ElevenLabs, Twilio/Telnyx, speech, or other provider;
- perform no polling or analytics;
- do not mutate real Experience storage;
- prevent both pointer and keyboard activation of disabled production actions.

Screen Lab state is visual fixture state only and must never be accepted by normal persistence boundaries.

## 18. MVP boundaries

Direct Hire MVP prepares the owner and Zeya for Formation. It does not include:

- deep website crawling;
- CRM setup or operation;
- email or WhatsApp outreach;
- prospect contact;
- operational missions;
- multi-agent orchestration;
- autonomous canonical changes;
- advanced analytics;
- Workplace Readiness or Operational Training implementation.

## 19. Deferred capabilities

Deferred work may include bounded research expansion, owner-supplied documents, scheduling integration, preparation notifications, additional evidence sources, and operational readiness. These require separate designs and cannot be inferred from this architecture.

No timeline or earlier seven-week estimate is a constitutional commitment.

## 20. Implementation sequencing

1. Characterize Public Experience, owner routing, authentication, Formation, canonical approval, Living Representation, and Screen Lab safety.
2. Add the owner-scoped Direct Hire persistence and explicit Formation lineage through a reviewed migration.
3. Add authenticated status/read/write contracts with tenant and idempotency tests.
4. Route clean owners to the distinct Direct Hire entry without changing Public Experience.
5. Implement the five-screen presentation and exact five-field validation.
6. Implement durable resume and honest queued/failed preparation.
7. Add bounded research only when real execution and evidence persistence exist.
8. Gate and initiate Formation with explicit Direct Hire lineage.
9. Expand Screen Lab with immutable Direct Hire states.
10. Validate the full Direct Hire-to-Formation path without creating a canonical Version before approval.

## 21. Acceptance invariants

- A Public Experience prospect and a Direct Hire owner never receive the same persuasive journey by routing accident.
- Direct Hire collects exactly five fields.
- Refresh and reauthentication resume from durable state.
- No UI claims unperformed research.
- Public research is evidence, not truth.
- Preparation and Formation create no canonical Version.
- Owner approval remains the only canonical-creation gate.
- All reads and writes are tenant-safe and duplication-safe.
- Screen Lab cannot cause production side effects.
