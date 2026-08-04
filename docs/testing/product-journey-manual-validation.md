# Product Journey Manual Validation

**Status:** Direct Hire Vertical Slice 1 validated in Preview; full core journey not yet run

**Release verdict:** **CORE JOURNEY NOT YET VALIDATED**

The verdict remains mandatory because the full Public Experience/provider/Formation/canonical journey was not run. Repository evidence also confirms that Formation can present a working conversation as linked without the governed linkage endpoint, and Formation summary durability after refresh is not implemented in the client.

The verdict applies to the full Public Experience-to-Living Representation journey. It does not negate the separately completed Direct Hire Vertical Slice 1 validation recorded below.

## Original preflight identity — 2026-08-03

This table preserves the earlier preflight state. It is superseded for Direct Hire Vertical Slice 1 by Gate 5; no owner identifier is added to this document.

| Field | Value |
|---|---|
| Test date | 2026-08-03 |
| Branch | `full-cycle-backend-integration` |
| Local commit | `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70` |
| Remote branch commit | `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70` |
| Deployment URL | `https://zeya-core-wh6u-2gm74buh2-martindubreuil13-bytes-projects.vercel.app` |
| Environment | Vercel Preview; deployment `dpl_C7cKqPa7cakpuBRZJDJ6ZUcSCxsk` |
| Supabase environment | Preview project `hdjojgvvlojbhgidirht`; distinct from the Production project referenced by local `.env.local` |
| Test owner identifier | NOT DESIGNATED |
| Test business identifier | NOT CREATED/SELECTED |
| Representation identifier | NOT CREATED/SELECTED |
| Starting database state | UNVERIFIED; no database query or cleanup was executed |
| Provider configuration | ElevenLabs runtime diagnostic reports all required values set and callback on the branch Preview alias; OpenAI and Twilio variable names are configured in Vercel but credential validity is untested |
| Screen Lab | Must not be used for the journey run |

Do not add an email, phone number, transcript, credential, token or private payload to this record. Use provider/database identifiers only when they are safe internal correlation IDs.

## Issue classification

- **P0 — Security, tenant isolation, corrupted canonical truth, or unrecoverable blocker**
- **P1 — Major journey function fails**
- **P2 — State, navigation, loading, persistence, or usability defect**
- **P3 — Visual polish, minor copy, or non-blocking issue**
- **CONSTITUTIONAL GAP — Required by the Product Constitution but not yet implemented**
- **DEFERRED — Explicitly outside the current MVP**

## Gate results

### Gate 1 — Audit validation

**PASS WITH DOCUMENTATION CORRECTIONS.** All 23 stages appear exactly once and use approved classifications. Production, Screen Lab, documentation, fixtures and deferred work are separated. The BRI Constitution and RF-A document are unchanged. Formation/canonical approval and private/speech-safe boundaries match code. One stale route citation was corrected to `app/api/experience/session/reflection/response/route.ts`.

### Gate 2 — Audit commit and push

- Commit created: `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70`
- Commit message: `docs: audit product constitution implementation status`
- Commit content: only `docs/product-constitution-implementation-status.md`
- Excluded: `ZEYA_Customer_Journey_Architecture_v1.pdf`
- Push: PASS after explicit owner authorization; remote branch is `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70`.
- Vercel deployment: automatically created and Ready as Preview deployment `dpl_C7cKqPa7cakpuBRZJDJ6ZUcSCxsk`. No Production promotion occurred.

### Gate 3 — Baseline

The repository is linked to Vercel project `zeya-core-wh6u`. The deployment is Ready, targets Preview, serves the expected Zeya entry page, and its Git metadata identifies branch `full-cycle-backend-integration` and commit `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70`. Its branch-scoped Supabase URL resolves to Preview project `hdjojgvvlojbhgidirht`; local `.env.local` resolves to a different Production project and must not be used for this test.

Supabase Auth is reachable, email auth is enabled and signup is not disabled. Supabase site URL and redirect allowlist remain unverified because the public Auth settings endpoint does not expose them. The login route uses password sign-in directly; password reset and any email confirmation return depend on the configured redirect allowlist. No clean test owner is documented or designated.

The deployed ElevenLabs diagnostic reports its agent, branch, phone-number ID, API key, webhook URL and webhook secret all set. The webhook points to the branch Preview alias at `/api/webhooks/elevenlabs` and resolves. OpenAI and Twilio variables are present in Vercel configuration, but validity was not tested. The active Experience call path is ElevenLabs; the provider factory explicitly does not implement Twilio. No Production cleanup was attempted.

The existing fixture cleanup helper, `tests/integration/representation-state-test-cleanup.ts`, is destructive but tightly registry/tenant scoped: it purges only registered Representation IDs with the expected Business ID, verifies the Business owner before deletion, and deletes only registered test auth users. It is appropriate only for fixtures created by the same test registry and is not a general owner reset.

`supabase/manual/20260730_owner_application_data_controlled_purge.sql` defines a broader service-role-only, owner-ID-plus-email-bound, transactional owner application-data purge. It delegates immutable Representation deletion to the controlled purge, deletes Experience/Formation/voice/governance/operational descendants, verifies zero remaining application rows, and deliberately preserves the Auth user. It is a manual SQL artifact rather than a migration or authenticated application endpoint. Its deployed Preview definition and ACL have not been proven, so it is not approved for use in this test preflight. No cleanup was run.

### Gate 4 — Automated preflight

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit --incremental false` |
| Production build | PASS | `npm run build`; 67 static pages generated |
| Targeted journey ESLint | PASS | Experience, Formation, Representation, Screen Lab and supporting libraries |
| Full repository ESLint | FAIL | 26 pre-existing errors in legacy/test/operational components; see issue register |
| Journey characterization | PASS | 9 Vitest files, 107 tests |
| Earlier focused characterization | PASS | 3 files, 43 tests |
| Screen Lab safety | PASS with residual gap | Static/provider/persistence guards pass; keyboard/browser-storage path is not covered |
| Legacy `rf-b-routing-fixes` | FAIL | 4 stale literal-string assertions; current code routes through `resolveOwnerJourneyPath` |
| Commercial bridge top-level script through Vitest | INVALID RUNNER | Assertions execute and print PASS, but file contains no Vitest suite |
| Standalone `tsx` scripts | UNVALIDATED | `tsx` is in package-lock metadata but absent from local executables; `npx tsx` could not resolve in the restricted environment |
| Secret scan | PARTIAL | No configured repository secret-scan command found. Heuristic found example/debug documents with key-shaped placeholder text; no values were printed or adjudicated as secrets |
| `git diff --check` | PASS | No whitespace errors |

The clean 107-test suite covered Screen Lab, Formation preparation, authenticated fetch, auth routing, owner status, Experience-to-Formation, critical path and Living Representation. No deployed test, SQL, provider call or persistence mutation was run.

### Gate 5 — Direct Hire Vertical Slice 1 runtime validation

**Status: VALIDATED IN PREVIEW on 2026-08-04.**

| Item | Validated result |
|---|---|
| Deployment | Vercel Preview project `zeya-core-wh6u`, branch `full-cycle-backend-integration`, commit `7b095b61fb1834f17266261ac40882e07c81ceb4` |
| Preview application | `https://zeya-core-wh6u-qlvec21rl-martindubreuil13-bytes-projects.vercel.app` |
| Supabase | Preview project `hdjojgvvlojbhgidirht` |
| Route and authentication return | Clean authenticated owner entered at `/formation/entry` and routed to `/onboarding` |
| Journey isolation | Public Experience was not used |
| First Meeting | Rendered with the protected-dialogue concept, including “I noticed we’ve never spoken before.” |
| Profile | Exactly five fields rendered and submitted successfully |
| Durable resume | Refresh and sign-out/sign-in both resumed at preparation; First Meeting and profile did not repeat |
| Preparation truthfulness | `preparation/queued` rendered Business profile received, Preparation queued, and website review, questions, and first-working-session preparation as pending; no completed research was claimed |
| Governance boundaries | No voice call, Formation initiation, or canonical Version creation occurred |

The corresponding Preview database inspection found one Direct Hire onboarding session, one Business, and one Business Representation for the test lineage. The Representation remained in `surface` with no current Version. The onboarding row was in `preparation` with preparation `queued`, a profile-completion timestamp, complete owner/Business/Representation lineage, persisted website and growth priority, and a normalized E.164 phone value. The phone value is intentionally not recorded here.

The boundary inspection found zero Formation sessions, Evidence, Observations, Proposals, or Representation Versions created by this slice. Two Public Experience sessions and one `representation_initialized` audit event already associated with the same Preview owner predated this test on 2026-08-03; they are historical Preview leftovers, not Direct Hire contamination.

Manual post-migration security verification confirmed RLS enabled; authenticated `SELECT` allowed; authenticated `INSERT`, `UPDATE`, and `DELETE` denied; anonymous `SELECT` denied; authenticated RPC execution allowed; anonymous RPC execution denied; one policy; two triggers; and zero unexpected rows before the runtime test.

Still unvalidated for Direct Hire are website research, preparation execution, research-derived sourced Evidence and cautious Observations, Formation handoff, a second-owner cross-tenant runtime test, concurrent duplicate submission, profile editing, voice interaction, and Production deployment. This is not validation of the full Direct Hire journey.

### Direct Hire Vertical Slice 2 — next milestone

> Zeya will perform real lightweight website research after profile submission, store findings as sourced non-canonical Evidence, create cautious Observations where appropriate, and update the preparation screen with truthful progress.

The milestone is limited to safe public website inspection, sourced Evidence, non-canonical Observations, truthful preparation-status progression, error/retry handling, and durable results. It must not initiate Formation, change canonical state, use voice, or contact a prospect. This record defines the objective only; it does not design or implement Vertical Slice 2.

## Controlled journey test log

Use one evidence row per real attempt. Screenshot filenames should contain only a test step and timestamp, never an owner name or phone number.

| Step | Route | Automated result | Human/deployed result | Expected evidence | Status/classification |
|---:|---|---|---|---|---|
| 1 Starting state | `/formation/entry` | Auth/owner routing contracts pass | Not run | Owner-scoped status response and zero contaminating records | BLOCKED — clean owner and Auth redirects not confirmed |
| 2 Experience entry | `/experience?entry=owner` | Current capture code verified | Not run | Session request/status, actual fields, validation/retry/refresh | Current fields: name, offer, customer, phone; constitutional fields recorded separately |
| 3 Veya briefing | `/api/experience/delegate-call` | Private/speech-safe split verified statically | Not run | Sanitized request status and provider correlation ID | Automated contract PASS |
| 4 Real Veya call | Experience UI | Not simulated | Not run | Provider call/conversation IDs and timestamps | BLOCKED — no designated clean owner or owner-controlled phone |
| 5 Result handoff | Experience status/reconcile APIs | Completion/replay contracts inspected | Not run | Correct session/Business/Representation correlation | UNVALIDATED |
| 6 Reflection | Reflection API | Persistence/generation contracts inspected | Not run | Source IDs, brief ID, audit/evidence references | UNVALIDATED |
| 7 Representation Brief | `/experience` | Rendering/response contracts pass | Not run | Brief refresh/re-entry and response records | UNVALIDATED |
| 8 Imagine Working Together | `/experience` bridge phases | Tailored bridge exists | Not run | Recognition/role/boundary screenshots | PARTIAL runtime; constitutional contract remains a gap |
| 9 Hiring decision | `/experience` | Positive Formation handoff tests pass | Not run | Positive session; not-ready/refusal persistence checks | PARTIAL; gaps confirmed by code |
| 10 Formation entry | `/formation/sessions/{id}` | Preparation and auth tests pass | Not run | Correct IDs; no Version at entry; refresh state | UNVALIDATED |
| 11 Conversation linkage | Formation UI/API | Code proves unsafe split | Not run | Network call to `/link-conversation` before linked UI | FAIL — P1 PJ-001 |
| 12 Summary durability | Formation UI/API | Code proves summary is client-only after POST | Not run | Same summary after refresh/re-entry | NOT PROVEN; likely FAIL — P1 PJ-002 |
| 13 Correction/pause/resume | Formation APIs | Ownership/correction contracts inspected | Not run | persisted correction, exact status after return | PARTIAL; pause does not change state |
| 14 Formation boundary | Formation approval UI | Governance boundary tests pass | Not run | proposal exists; Version absent before approval | Automated contract PASS, deployed UNVALIDATED |
| 15 Canonical approval | Formation approve API | Atomic/authorization tests pass | Not run | approval, Version, confidence, audit and pointer IDs | UNVALIDATED against deployed DB |
| 16 Living Representation | `/representation/living` | State/auth tests pass | Not run | all supported states and current Version | UNVALIDATED against deployment |
| 17 Version/rollback integrity | Representation APIs | Static atomicity/immutability evidence exists | Not run | immutable history, active pointer, audit | UNVALIDATED; no rollback executed |
| 18 Screen Lab isolation | `/experience/screen-lab` | 107-test suite includes lab guards | Browser keyboard path not run | zero network/provider/real storage writes | P2 residual risk PJ-006 |

## Confirmed code-level defects and gaps

### Formation linkage — P1

`components/formation/FormationWorkflow.tsx` calls `advanceState('working_conversation_linked')` from the conversation-ready UI. That sends `/advance`, whose API explicitly permits pending→linked. The real UI never calls `/link-conversation`, despite the dedicated route and governed `zeya_link_formation_conversation` RPC. The UI can therefore present durable linkage without a traceable conversation output.

### Formation summary durability — P1 pending deployed reproduction

`generateSummary()` stores the returned summary only in React state. On mount, a persisted `working_conversation_linked` session maps directly to `summary_review`, but the loader does not retrieve or regenerate the summary. The summary review UI requires `summary`; a refresh can therefore leave the owner unable to review/approve. Classify P1 if reproduced because it blocks the journey; otherwise P2 if deployed recovery exists outside the inspected client.

### Constitutional gaps

- Stage 2 lacks business name, website and immediate research. The current product/service capture is the voice-derived offer, so the gap is business/website/research rather than total absence of an offer.
- Calibration lacks durable reject/pause/resume state.
- Hiring lacks durable not-ready, refusal, follow-up permission/timing and permanent no-contact records.
- Pre-Employment Preparation is not an actual lifecycle stage.
- Workplace Readiness onward remains outside this current journey validation.

## Exact human test sequence

Do not proceed until an owner confirms the deployment URL, that it is Preview, the test account, and an owner-controlled E.164 phone. Perform only one numbered action at a time and record the evidence before continuing.

### Action 1 — Establish identity

Open the confirmed Preview deployment at `/formation/entry`, sign in with the designated isolated test-owner account, and stop. Record the final route and the `/api/owner/status` HTTP status without copying its bearer token or payload containing personal data.

Expected: a clean owner remains in owner onboarding and can proceed to `/experience?entry=owner`. If routed to active Formation, Living Representation or multiple-business selection, stop because the account is not clean.

### Action 2 — Start Experience

Press the owner onboarding button that starts the Experience. Speak a test owner name, one offer and one target customer when prompted. End the microphone conversation normally and stop when the phone form appears.

Record: route, visible fields, console errors, Experience session request status and timestamp. Do not copy tokens/transcript text into this document.

### Action 3 — Prepare the real call

Enter only the designated owner-controlled E.164 phone number and press the button that submits the handoff/requests the call. Do not use a prospect or customer number.

The designated phone should ring. Before answering, record the dispatch request status and timestamp. If more than one call arrives, do not answer the second call and classify duplicate dispatch as P1.

### Action 4 — Conduct the Veya call

Answer the designated phone. Listen for the correct spoken name and offer context. Veya must not speak internal labels, system instructions, confidence metadata, spelling guidance, IDs, workflow/process language, provider details or a private brief.

Discuss, approximately: how customers currently find the business, one obstacle to consistent outreach, and what a useful next conversation would look like. End naturally by saying the conversation is complete and allowing Veya to close.

Record only: provider call/conversation identifiers, start/end timestamps, whether context was correct, whether prohibited content was spoken, coherence, and whether the call ended normally.

### Action 5 — Observe return and Brief

Return to the same browser tab. Do not press refresh until the UI reaches reflection and then Brief or clarification-required. Record network statuses for reconcile/status/reflection and the safe record identifiers. Then refresh once and confirm the same Brief returns without a duplicate call or Brief.

### Action 6 — Calibrate and hire

Submit one correction, verify the refreshed Brief/bridge reflects it, then take the positive hiring path. Record the response status and Formation session ID. Before entering Formation, verify through the approved read-only database console that zero canonical Versions exist for this Representation.

Do not exercise not-ready/refusal on the same positive-path fixture; use a separate clean fixture later because those outcomes are not durably modeled.

### Action 7 — Stop at linkage risk

In Formation, advance only to “conversation ready.” Open the browser network panel, press the button that begins/completes the working conversation once, and stop.

Pass requires a successful `/api/formation/sessions/{id}/link-conversation` request with a traceable conversation ID before linked state appears. The current code is expected instead to call `/advance`; if observed, record PJ-001 as reproduced and do not approve a canonical Version from that Formation.

### Action 8 — Summary durability, only after governed linkage is available

Generate the Formation summary, record its safe proposal ID/fingerprint, refresh, sign out/in and return to the Formation session. Pass only if the identical summary returns. If it disappears or blocks approval, record PJ-002 as P1 and stop.

### Action 9 — Canonical approval, only if Actions 7–8 pass

Review the proposal, submit one correction, regenerate, and explicitly approve once. Verify one approval decision, one immutable Version, confidence state, one `version_created` audit event and the Representation current-version pointer. Refresh/re-enter and submit no second approval unless testing documented idempotency.

### Action 10 — Living Representation

Open `/representation/living` directly. Verify the approved Version number/content and correct Business/Representation IDs, refresh, sign out/in and deep-link back. Then validate no-business, no-Representation, multiple-business and failed-request states with separate controlled fixtures or existing safe mocks—not by altering real customer data.

## Database and deployment parity audit

### Confirmed locally

- Repository migration definitions, static schema/RPC tests and build contracts are present.
- Preview-isolation code expects distinct Preview and Production Supabase project references and distinct Experience Business IDs.
- Local pulled metadata points at the expected Preview Supabase host used by the isolation test.
- Service-role-only and immutable canonical functions are defined in migrations.

### Unverified

Deployed tables, columns, types, constraints, applied migration history, functions/RPC definitions, policies, triggers, indexes, grants, auth redirect URLs, edge functions, provider callback URLs, storage buckets and Production parity were not directly inspected. No SQL was executed.

### Exact owner-run read-only checks

Run these in the Supabase SQL editor separately in Preview and Production. Export only schema metadata, never customer rows or secrets. Compare results offline.

```sql
select version from supabase_migrations.schema_migrations order by version;

select table_schema, table_name, column_name, ordinal_position, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity, c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p')
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;

select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef,
       coalesce(array_to_string(p.proconfig, ','), '') as configuration,
       md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;

select table_schema, table_name, constraint_name, constraint_type
from information_schema.table_constraints
where table_schema = 'public'
order by table_name, constraint_name;

select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
order by event_object_table, trigger_name, event_manipulation;

select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
order by routine_name, grantee, privilege_type;
```

In Supabase Dashboard, compare Authentication → URL Configuration (site URL and redirect allowlist), Edge Functions and Storage buckets. In Vercel, compare only environment-variable names/scopes and the Supabase project host; never export secret values. In ElevenLabs/Telnyx/Twilio, compare the callback host/path, selected agent/number/environment and signature configuration without copying credentials.

### Parity result

| Area | Result | Impact |
|---|---|---|
| Repository schema contracts | Confirmed locally | Stages 3–10 |
| Preview deployed parity | UNVERIFIED | Blocks journey validation |
| Production deployed parity | UNVERIFIED | No Production change authorized |
| Auth redirects | UNVERIFIED | Blocks reliable sign-in test |
| Provider callbacks | UNVERIFIED | Blocks call-result proof |
| Environment names | Confirmed in code | Values/scopes remain unverified |

## Release decision

**CORE JOURNEY NOT YET VALIDATED**

The journey did not run to Living Representation in a verified deployment. Formation linkage is falsely representable by the current UI/API path, summary resumability is uncertain and likely blocking, tenant/deployed parity was not inspected, and no real provider handoff occurred. This verdict must remain until PJ-001 and PJ-002 are corrected and retested in an isolated Preview journey.

## Recommended engineering sequence

1. Repair P1 Formation working-conversation linkage so the UI can become linked only after the governed endpoint succeeds.
2. Persist/retrieve Formation summary so refresh and authenticated re-entry restore the identical review state.
3. Retest the entire existing core journey and canonical boundary in Preview.
4. Make hiring refusal, follow-up consent/timing and no-contact durable.
5. Implement constitutional Stage-2 capture with business name and website while preserving the current offer field.
6. Add bounded immediate website research with provenance and SSRF controls.
7. Use the new evidence to further personalize the Zeya-to-Veya brief while preserving private/speech-safe separation.
8. Complete the constitutional Imagine Working Together decision contract.
9. Implement truthful Pre-Employment Preparation.
10. Define minimum phone-first Workplace/Operational Readiness.
11. Execute the first governed telephone mission before CRM, email, WhatsApp, broad Settings, advanced analytics or multi-agent expansion.
