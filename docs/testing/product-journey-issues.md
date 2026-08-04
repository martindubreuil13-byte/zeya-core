# Product Journey Issue Register

**Audit/test date:** 2026-08-03

**Current verdict:** CORE JOURNEY NOT YET VALIDATED

This register separates runtime defects, constitutional gaps, deferred work and test-environment limitations. Future requirements are not assigned P0–P3 merely because they are absent.

## Runtime defects

### PJ-001 — Formation can claim working-conversation linkage without governed linkage

- **Classification:** P1 — Major journey function fails
- **Constitutional stage:** 9 — Formation
- **Environment:** Repository-confirmed; deployed Preview reproduction pending
- **Preconditions:** Authenticated owner has a Formation session in `working_conversation_pending`.
- **Reproduction:** Open `/formation/sessions/{sessionId}`; advance to conversation ready; press “Begin Working Conversation”/the action that completes the conversation; inspect network traffic and session status.
- **Expected:** UI calls `/api/formation/sessions/{sessionId}/link-conversation` with a traceable governed output; linked UI appears only after `zeya_link_formation_conversation` succeeds.
- **Actual:** `FormationWorkflow` calls `advanceState('working_conversation_linked')`; `/advance` permits pending→linked without a conversation ID or lineage.
- **Evidence:** `components/formation/FormationWorkflow.tsx`; `app/api/formation/sessions/[sessionId]/advance/route.ts`; the unused live linkage path in `link-conversation/route.ts`.
- **Suspected code path:** UI transition is wired to generic status advance instead of provider/conversation capture followed by linkage.
- **Database impact:** Formation status can be `working_conversation_linked` without `first_working_conversation_id` being established by the governed RPC.
- **Provider impact:** No Formation provider/conversation output is required by the current UI.
- **Tenant/canonical risk:** Owner scoping remains in the route, so no cross-tenant evidence is proven. Canonical risk is material because a summary/proposal could proceed from falsely linked state. No canonical corruption has yet been executed or observed, so classification is P1 rather than P0.
- **Workaround:** Do not approve any Formation reached through the generic pending→linked UI transition.
- **Recommended fix:** Remove pending→linked from the generic UI path; require a real governed conversation output and successful linkage response before updating durable/UI state.
- **Retest:** Successful, failed, duplicate, refreshed, wrong-owner and wrong-Representation linkage; prove no linked UI/state after any failed request.

### PJ-002 — Formation summary is not restored after refresh or re-entry

- **Classification:** P1 — Major journey function fails (repository-likely; confirm in Preview)
- **Constitutional stage:** 9 — Formation
- **Environment:** Repository-confirmed state-loss path; deployed reproduction pending
- **Preconditions:** Linked Formation session and successfully generated summary.
- **Reproduction:** Generate summary, observe it, refresh or sign out/in, return to the same Formation session.
- **Expected:** Identical current summary/proposal is retrieved and rendered.
- **Actual:** Summary response is held only in React state. Session reload maps `working_conversation_linked` to `summary_review` but does not retrieve/regenerate `summary`; summary review content depends on non-null `summary`.
- **Evidence:** `FormationWorkflow` `generateSummary`, mount loader, `mapSessionToUIState`, and conditional `summary_review && summary` rendering.
- **Suspected code path:** GET session response omits the current summary/proposal projection and the client has no summary retrieval call.
- **Database impact:** Proposal/evidence may exist while the client loses its review handle/fingerprint.
- **Provider impact:** None.
- **Tenant/canonical risk:** No cross-tenant access is proven. It blocks resumable owner review and may encourage unsafe regeneration.
- **Workaround:** Do not refresh between summary generation and approval; this is not an acceptable production guarantee.
- **Recommended fix:** Persist a stable summary/proposal reference and retrieve the current summary on load, with current-fingerprint validation.
- **Retest:** Refresh, sign-out/in, deep-link, duplicate generation, correction/regeneration and stale proposal handling.

### PJ-003 — Full repository ESLint baseline fails

- **Classification:** P2 — State, navigation, loading, persistence, or usability defect
- **Constitutional stage:** Cross-cutting; several files are outside the immediate journey
- **Environment:** Local repository
- **Preconditions:** Current committed tree, ESLint version in lockfile.
- **Reproduction:** Run `npm run lint`.
- **Expected:** Zero errors.
- **Actual:** 26 errors, including unescaped entities, synchronous state changes in effects, ref access during render and memoization dependency mismatches.
- **Evidence:** ESLint output cites `app/experience-v2-test`, legacy Experience components, Briefing Room, Learn overlay, Mission Control and business onboarding.
- **Suspected code path:** Pre-existing lint debt exposed by current React/Next lint rules.
- **Database impact:** None directly.
- **Provider impact:** None directly.
- **Tenant/canonical risk:** None proven.
- **Workaround:** Journey-targeted ESLint passes; production build passes.
- **Recommended fix:** Fix by component area with behavior characterization, without mixing it into Formation governance repairs.
- **Retest:** Full `npm run lint`, targeted tests and build.

### PJ-004 — Screen Lab shell is not keyboard-inert and can write real Experience browser state

- **Classification:** P2 — State, navigation, loading, persistence, or usability defect
- **Constitutional stage:** Testing architecture, not a lifecycle stage
- **Environment:** Preview Screen Lab
- **Preconditions:** Authenticated Preview user opens a phase containing a focusable real Experience button/form.
- **Reproduction:** Open `/experience/screen-lab`; select hiring decision or identity confirmation; use keyboard Tab/Enter rather than pointer input; inspect real Experience `sessionStorage` keys.
- **Expected:** Every rendered real action is semantically disabled/inert and only the Lab selector changes local fixture state.
- **Actual:** Shell uses `pointer-events-none` and `aria-disabled`, neither of which removes descendant controls from keyboard focus. Inline handlers in `ExperienceScreen` write `zeyaCommercialBridgeState` and `zeyaCommercialBridgeIdentity` without a `screenLab` guard.
- **Evidence:** `app/experience/screen-lab/screen-lab-client.tsx`; hiring/identity inline handlers in `app/experience/page.tsx`. Existing tests assert pointer suppression and shell-local source only, not keyboard activation or storage immutability.
- **Suspected code path:** Visual disabling was implemented without HTML `inert`, descendant `disabled`, or guarded inline handlers.
- **Database impact:** No Supabase/server write path is proven; fixture-ID guard remains intact.
- **Provider impact:** Voice/provider construction is disabled; no provider reachability is proven.
- **Tenant/canonical risk:** No tenant/canonical risk proven. Browser storage can contaminate subsequent real Experience behavior in the same tab/profile.
- **Workaround:** Do not keyboard-activate previewed real actions; clear only the documented Lab-contaminated browser keys before a real test if reproduction occurs.
- **Recommended fix:** Make preview content genuinely inert and guard every inline persistence handler; add an interaction test that asserts network and relevant storage remain unchanged.
- **Retest:** Pointer, keyboard, form submission, synthetic click, storage snapshot, network interception and provider-constructor assertions for every phase.

## Constitutional gaps

### PJ-101 — Public Experience constitutional capture and immediate website research remain incomplete

- **Classification:** CONSTITUTIONAL GAP — Required by the Product Constitution but not yet implemented
- **Constitutional stage:** 2
- **Environment:** All
- **Preconditions:** Start current Experience.
- **Reproduction:** Observe production capture and repository research services.
- **Expected:** Owner name, business name, website, phone, selected product/service, explicit consent, bounded website research and evidence provenance.
- **Actual:** Public Experience captures name, offer/product and customer; UI later captures phone. It still lacks the constitutional business-name, website and immediate-research contract. The separate authenticated Direct Hire path now has Preview-validated five-field capture and bounded website preparation, but that does not repair or silently replace the Public Experience contract.
- **Evidence:** `app/experience/page.tsx`, voice hooks and Experience API routes; Direct Hire Slice 1 and Slice 2 Preview validation records.
- **Suspected code path:** Current journey preserves the older scripted capture.
- **Database impact:** Public Experience still persists no constitutional website evidence bundle; Direct Hire website Evidence is separate, owner-authorized lineage.
- **Provider impact:** OpenAI voice begins without web evidence.
- **Tenant/canonical risk:** Experience remains pre-canonical, reducing canonical risk; brief input is incomplete.
- **Workaround:** Record as a known gap; do not fail the existing runtime test solely for absent future fields.
- **Recommended fix:** Preserve the distinct journeys and the validated Direct Hire safety boundaries; separately resolve the Public Experience constitutional capture/research contract with consent, partial failure and SSRF defenses.
- **Retest:** Validation, provenance, unavailable/partial research, consent withdrawal and downstream private brief.

### PJ-102 — Calibration lacks durable reject, pause and resume

- **Classification:** CONSTITUTIONAL GAP — Required by the Product Constitution but not yet implemented
- **Constitutional stage:** 5
- **Environment:** All
- **Preconditions:** Persisted Representation Brief.
- **Reproduction:** Attempt reject/pause, refresh and re-enter.
- **Expected:** Auditable reject/pause and exact durable resume state.
- **Actual:** Confirm/refine/redirect/continue responses persist; commercial bridge resume relies partly on `sessionStorage`.
- **Evidence:** Experience page and reflection response route/table.
- **Suspected code path:** Brief response vocabulary/lifecycle does not model all constitutional outcomes.
- **Database impact:** Missing durable lifecycle decisions.
- **Provider impact:** None.
- **Tenant/canonical risk:** No canonical Version exists yet; governance/auditability remains incomplete.
- **Workaround:** Use confirm/refine only during the controlled positive path.
- **Recommended fix:** Add idempotent reject/pause/resume states with owner scope and timestamps.
- **Retest:** Refresh, re-entry, concurrent tabs and repeated requests.

### PJ-103 — Hiring refusal and follow-up consent are not durable

- **Classification:** CONSTITUTIONAL GAP — Required by the Product Constitution but not yet implemented
- **Constitutional stage:** 7
- **Environment:** All
- **Preconditions:** Reach hiring decision.
- **Reproduction:** Select not-now/refusal and inspect durable records/re-entry.
- **Expected:** Unambiguous hire/not-ready/refusal, follow-up permission, timeframe and permanent no-contact state.
- **Actual:** Positive path creates Formation; decline writes local browser state and returns to initial. No durable decision record is evidenced.
- **Evidence:** Hiring handlers in `app/experience/page.tsx`; Formation prepare API/migrations.
- **Suspected code path:** Commercial bridge predates governed employment decision persistence.
- **Database impact:** Missing consent/refusal audit record and follow-up suppression state.
- **Provider impact:** No automated follow-up is implemented or authorized.
- **Tenant/canonical risk:** Consent/compliance risk, not canonical corruption.
- **Workaround:** Do not create or send follow-up contact from current local state.
- **Recommended fix:** Add explicit owner-scoped decision model before any follow-up automation.
- **Retest:** Hire, not-ready with/without permission, timing, refusal/no-contact and owner-initiated return.

### PJ-104 — Direct Hire preparation executes; Formation handoff remains incomplete

- **Classification:** PARTIALLY RESOLVED CONSTITUTIONAL GAP — Slice 2 validated; full Stage 8 handoff remains incomplete
- **Constitutional stage:** 8
- **Environment:** All
- **Preconditions:** Positive hiring path enters Formation.
- **Reproduction:** Inspect Formation entry and preceding jobs/records.
- **Expected:** Proven deeper research, evidence inventory, assumptions, contradictions, questions and preparation package.
- **Actual:** Direct Hire Vertical Slice 2 now performs bounded HTTPS website preparation after explicit owner authorization, persists truthful progress and retry history, and stores sourced non-canonical Evidence plus cautious deterministic Observations. Preview validation reached durable `ready` on attempt 2 and survived refresh. Formation handoff and owner review of prepared context do not yet exist.
- **Evidence:** 2026-08-04 Gate-6 Preview validation record, Direct Hire preparation implementation/tests, and fix commit `e2bdb89`.
- **Suspected code path:** Slice 2 ends deliberately at preparation readiness; generic Formation entry is not linked to Direct Hire preparation lineage.
- **Database impact:** The validated lineage contains four website Evidence records and one website-derived Observation; its Representation remains `surface`, current Version is null, and Formation session count is zero.
- **Provider impact:** No research provider.
- **Tenant/canonical risk:** Trust/accuracy risk; draft remains pre-canonical until approval.
- **Workaround:** Treat `ready` as preparation readiness only, not onboarding completion, Formation, or canonical truth.
- **Recommended fix:** Implement a separately reviewed Vertical Slice 3 handoff with explicit owner action, Direct Hire lineage, preliminary-finding review/correction, and the existing canonical approval boundary.
- **Retest:** Second-owner isolation, concurrent and stale leases, partial/unavailable results, terminal retry, prepared-context handoff, and no Version before approval.

## Deferred features

### PJ-201 — Workplace Readiness through Performance Review are not a joined journey

- **Classification:** DEFERRED — Explicitly outside the current MVP
- **Constitutional stage:** 11–23, except reusable partial infrastructure documented in the audit
- **Environment:** All
- **Preconditions:** First canonical Version.
- **Reproduction:** Look for a production transition from Living Representation to readiness/training/mission lifecycle.
- **Expected:** Only after separately approved implementation.
- **Actual:** Journey stops at Living Representation; Screen Lab concepts and disconnected legacy operational subsystems exist.
- **Evidence:** Product audit matrix and route/component inventory.
- **Suspected code path:** Intentionally unjoined future lifecycle.
- **Database/provider impact:** No approved end-to-end operational contract.
- **Tenant/canonical risk:** Risk arises only if concepts are presented as operational.
- **Workaround:** Keep concept labels and do not perform real customer contact.
- **Recommended fix:** Follow the sequence in the manual validation record, beginning with minimum phone-first readiness.
- **Retest:** Separate Stage Sandbox/operational authorization after explicit approval.

## Test-environment limitations

### PJ-T01 — Audit push and automatic Preview deployment were blocked — RESOLVED

- **Classification:** Test-environment limitation
- **Constitutional stage:** Cross-cutting
- **Environment:** Local/GitHub/Vercel
- **Preconditions:** Local audit commit `d5a2e4f`.
- **Reproduction:** Push current branch to `origin`.
- **Expected:** Remote branch update and automatic Preview deployment if repository integration is configured.
- **Actual:** Initial execution safety review rejected transmission until the owner explicitly confirmed the destination. After confirmation, the exact documentation commit was pushed and Vercel created a Ready Preview deployment.
- **Evidence:** Remote branch and deployment metadata both identify `d5a2e4f5b295cf756e789bcc9ec3dc368f20ee70`; deployment `dpl_C7cKqPa7cakpuBRZJDJ6ZUcSCxsk` targets Preview.
- **Suspected code path:** External-action policy, not repository code.
- **Database/provider impact:** None.
- **Tenant/canonical risk:** None.
- **Workaround:** None required.
- **Recommended fix:** Resolved by explicit authorization.
- **Retest:** Complete; remote commit and Preview deployment confirmed without Production promotion.

### PJ-T02 — Full provider journey readiness remains unvalidated

- **Classification:** Test-environment limitation
- **Constitutional stage:** 1–10
- **Environment:** Intended Preview
- **Preconditions:** Vercel CLI/project link and pulled metadata.
- **Reproduction:** Query CLI identity/project/deployments and inspect safe local Preview metadata.
- **Expected:** Confirmed deployment URL/commit/target, callback configuration, test account and owner-controlled phone.
- **Actual:** A clean authenticated owner and authentication return were proven during Direct Hire Vertical Slice 1, and the current Preview deployment/commit/Supabase project are confirmed. The full provider journey, provider credential validity, callback completion, and deployed cleanup parity remain unvalidated. No phone number is recorded.
- **Evidence:** Vercel deployment/API metadata, branch-scoped environment names, Gate-3 baseline, and Gate-5 Direct Hire validation in the manual validation record.
- **Suspected code path:** Missing CLI auth/session or incomplete pulled environment snapshot.
- **Database/provider impact:** Does not invalidate the completed no-call Direct Hire slice; it still blocks claiming the provider-dependent journey as validated.
- **Tenant/canonical risk:** The validated slice stayed in Preview and created no Formation or Version. Any later provider/canonical test still requires the controlled scope and boundary checks in the manual record.
- **Workaround:** Keep the validated Direct Hire state separate from any later provider run; use only an owner-controlled number entered in the application when separately authorized.
- **Recommended fix:** Verify provider credentials/callback completion and the cleanup definition before the separately authorized full provider journey.
- **Retest:** Resume from the exact controlled journey sequence; do not repeat Vertical Slice 1 merely to validate providers.

### PJ-T03 — Legacy routing characterization assertions are stale

- **Classification:** Test-environment limitation
- **Constitutional stage:** Entry/routing
- **Environment:** Local tests
- **Preconditions:** Run `rf-b-routing-fixes.test.ts`.
- **Reproduction:** Execute through Vitest.
- **Expected:** Tests characterize current helper-based routing semantics.
- **Actual:** Four assertions require literal `router.push('/experience')` and template-literal `router.replace(...)`; production now delegates to `resolveOwnerJourneyPath` and `/experience?entry=owner`.
- **Evidence:** Failing assertion output; `lib/owner/owner-route.ts`; passing `rf-b-auth-routing` suite.
- **Suspected code path:** Test was not updated after routing extraction.
- **Database/provider impact:** None.
- **Tenant/canonical risk:** None proven.
- **Workaround:** Rely on the current helper-focused auth-routing tests for this validation, while retaining the failure as visible debt.
- **Recommended fix:** Update characterization expectations only when test-code changes are authorized; assert behavior rather than source-string literals.
- **Retest:** Both routing suites.

### PJ-T04 — Standalone `tsx` audit scripts cannot run locally

- **Classification:** Test-environment limitation
- **Constitutional stage:** Experience/Brief quality
- **Environment:** Local package installation
- **Preconditions:** Run package scripts using `npx tsx`.
- **Reproduction:** Execute `public-experience-quality.test.ts` or `representation-brief-v1.test.ts` through the declared package script.
- **Expected:** Local `tsx` executable runs top-level assertions.
- **Actual:** No `node_modules/.bin/tsx`; `npx tsx` waits for unavailable package resolution. Running a top-level assertion file through Vitest executes it but fails because it defines no Vitest suite, so that is not a valid pass.
- **Evidence:** executable inventory and runner results.
- **Suspected code path:** `tsx` is referenced by scripts/lock metadata but not installed in the current dependency tree.
- **Database/provider impact:** None for these static scripts.
- **Tenant/canonical risk:** None.
- **Workaround:** None that preserves runner validity without changing/installing dependencies.
- **Recommended fix:** Restore the repository-declared local runner in a separately authorized dependency maintenance task, or convert scripts to proper Vitest suites.
- **Retest:** Run the exact package scripts and require zero exit status/output PASS.

### PJ-T05 — Direct Hire Vertical Slice 1 runtime validation — RESOLVED

- **Classification:** Test validation record
- **Constitutional stage:** Direct Hire onboarding before Formation
- **Environment:** Vercel Preview and Supabase project `hdjojgvvlojbhgidirht`
- **Preconditions:** Clean authenticated owner, commit `7b095b61fb1834f17266261ac40882e07c81ceb4`, applied Direct Hire migration.
- **Reproduction:** Enter through `/formation/entry`, authenticate, complete First Meeting and the five-field profile, reach `preparation/queued`, refresh, then sign out/in and return.
- **Expected:** Direct Hire routing without Public Experience, durable profile and resume, honest queued/pending preparation, and no Formation or canonical Version.
- **Actual:** Expected behavior was observed. One Direct Hire onboarding session, Business, and Business Representation were present; zero Formation sessions, Evidence, Observations, Proposals, and Representation Versions were created by the slice.
- **Evidence:** 2026-08-04 manual Preview run and owner-run database/security verification summarized in `product-journey-manual-validation.md`.
- **Security:** RLS and grants behaved as designed: owner-authenticated read and RPC execution only; direct authenticated mutations and anonymous access were denied.
- **Historical data:** Two Public Experience sessions and one `representation_initialized` audit event predated the test and are not classified as Direct Hire contamination.
- **Resolution:** Routing, authentication return, exact five-field capture, persistence, refresh/sign-in resume, honest queued preparation, and the Formation/canonical boundaries are validated for Vertical Slice 1 only.
- **Still open at this checkpoint:** Website research/execution, research Evidence/Observations, Formation handoff, second-owner isolation, concurrent duplicate submission, profile editing, voice, and Production deployment. PJ-T06 supersedes only the Slice 2 research items after its later run.

### PJ-T06 — Direct Hire Vertical Slice 2 runtime validation and Node 24 lookup defect — RESOLVED

- **Classification:** Test validation record and resolved runtime defect
- **Constitutional stage:** Direct Hire preparation before Formation
- **Environment:** Vercel Preview project `zeya-core-wh6u` and Supabase project `hdjojgvvlojbhgidirht`
- **Preconditions:** Existing authenticated Direct Hire session, applied Slice 2 migration, explicit owner retry, fix commit `e2bdb89`.
- **Expected:** Safe bounded website preparation reaches a durable truthful result, creates only sourced non-canonical output, and stops before Formation and canonical Version creation.
- **Actual:** Attempt 1 failed safely as `request_failed` with zero website Evidence and Observations. The custom DNS lookup was incompatible with Node 24 `all: true`; the corrected pinned lookup preserved TLS hostname verification, DNS pinning, mixed-address rejection, and SSRF rules. Attempt 2 reached `ready`, persisted four Evidence records and one cautious Observation, and survived refresh.
- **Boundary:** The linked Representation remained `surface`, current Version was null, and Formation sessions were zero. No voice or provider interaction occurred.
- **Historical data:** Other Preview Representations, Versions, Formation sessions, Public Experience sessions, Evidence, Observations, and Audit records are historical test data and are not attributed to Slice 2.
- **Resolution:** Preparation execution, successful explicit retry, truthful durable progress, website Evidence creation, cautious Observation creation, and the no-Formation/no-canonical boundary are validated for this single Preview lineage and site.
- **Still open:** Second-owner isolation, real concurrent lease contention, stale-lease recovery, partial results, additional terminal-failure retry, profile editing, voice, Formation handoff, broader website compatibility, and Production.
