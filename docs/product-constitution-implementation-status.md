# Product Constitution Implementation Status

**Audit date:** 2026-08-02

**Governing commit:** `55fbfb5921f6546d9edb15c52b446946f4923963`

**Scope:** Repository evidence only. No deployed database or provider calls were made.
**Classification rule:** Documentation, fixtures, Screen Lab states, and disconnected libraries are not counted as working production lifecycle stages.

## 1. Executive verdict

The current executable owner journey is:

`Discovery → voice-led Experience capture → phone collection → Veya call → reflection → persisted Representation Brief → calibration → commercial bridge → positive hiring choice → Formation → explicit approval → canonical Version → Living Representation`

This is a meaningful governed vertical slice through Stages 1–10. It is not the full constitutional journey. Stage 2 conflicts with the constitution: production still captures owner name, offer/product, customer and phone, but not business name or website, and performs no immediate website research. Stages 6–7 have real UI but incomplete commercial decision persistence. Stage 9 has a real state machine and governance handoff, but the “working conversation” is a UI advance rather than a traceable Formation conversation and refresh after summary generation can lose the rendered summary. Stage 10 has a strong atomic approval boundary but remains production-unvalidated by this audit.

The executable path stops at Living Representation. Stages 11–23 have varying amounts of older operational UI, mission, specialist, voice, evidence, reflection and governance infrastructure, but they are not joined to the constitutional post-hire lifecycle. They must not be represented as an operationally complete first-day journey.

### Direct Hire Vertical Slice 1 validation addendum — 2026-08-04

**VALIDATED IN PREVIEW.** Commit `7b095b61fb1834f17266261ac40882e07c81ceb4` was manually exercised against Preview Supabase project `hdjojgvvlojbhgidirht`. A clean authenticated owner routed from `/formation/entry` to the distinct `/onboarding` journey rather than Public Experience, saw the First Meeting, submitted exactly five profile fields, and reached the truthful `preparation/queued` state. Refresh and sign-out/sign-in restored preparation without repeating the meeting or profile.

Preview database inspection confirmed one owner-linked Direct Hire onboarding session, Business, and Business Representation; durable profile, website, and growth-priority data; normalized phone storage; Representation phase `surface`; and no current Version. It also confirmed zero Formation sessions, Evidence, Observations, Proposals, or Representation Versions created by the slice. The real phone value is not recorded. Two Public Experience sessions and one `representation_initialized` audit event were historical 2026-08-03 Preview leftovers and were not created by this validation.

Manual security verification confirmed RLS, owner-authenticated `SELECT`, denied direct authenticated mutations, denied anonymous access, authenticated-only RPC execution, one policy, two triggers, and zero unexpected rows before the run. This validates only Direct Hire Vertical Slice 1: routing, authentication return, five-field persistence, durable resume, honest queued preparation, and Formation/canonical boundaries. It does not validate website research, preparation execution, research-derived Evidence or Observations, Formation handoff, second-owner isolation, concurrent duplicate submission, profile editing, voice, or Production deployment. The full Direct Hire journey and the Public Experience constitutional Stage-2 gap remain open.

At the Slice 1 checkpoint, the approved next milestone was Vertical Slice 2: safe public website inspection, sourced non-canonical Evidence, cautious non-canonical Observations, truthful preparation progress, durable results, and error/retry handling, stopping before Formation or canonical change. The addendum below records its later validation.

### Direct Hire Vertical Slice 2 validation addendum — 2026-08-04

**DIRECT HIRE VERTICAL SLICE 2 — VALIDATED IN PREVIEW.** Commit `e2bdb89` was manually exercised in Vercel Preview project `zeya-core-wh6u` against Preview Supabase project `hdjojgvvlojbhgidirht`. An authenticated owner resumed the existing Direct Hire onboarding session, explicitly retried the earlier failed preparation attempt, observed truthful `running` progress, reached durable `ready`, refreshed, and returned to the same result.

The first attempt failed safely as `request_failed` before creating website Evidence or Observations. A Node 24 custom-lookup contract defect was confirmed and repaired: ordinary lookup still returns one pinned address and family, while `all: true` returns an array containing exactly that one pinned address. The correction preserves HTTPS-only requests, the original TLS hostname, DNS pinning, mixed-address rejection, and every SSRF boundary. Its structured diagnostic records only a constant event and stage, a native error code, and an optional HTTP status class.

Manual Preview inspection after the successful retry confirmed preparation `ready` on attempt 2; destination validation and homepage complete; About and Products/Services skipped; and Evidence and Observations complete. The linked Direct Hire lineage contained four sourced, non-canonical website Evidence records and one cautious deterministic website-derived Observation. The Representation remained in `surface`, its current Version pointer remained null, and it had zero Formation sessions. No Proposal, Approval, Confidence Assessment, Representation Version, canonical pointer change, voice call, prospect contact, or provider interaction was attributed to this slice.

This validation is scoped only to the tested Direct Hire onboarding session and linked Representation. Older Preview Representations, Versions, Formation sessions, Public Experience sessions, Evidence, Observations, and Audit records are historical test data and are not Slice 2 output. The full Direct Hire and core journeys remain incomplete. Still unvalidated are a second-owner cross-tenant runtime test, concurrent lease contention, stale-lease recovery, partial results, terminal-failure retry beyond this successful retry, profile editing, voice, Formation handoff, Production, and compatibility beyond the single tested public site.

The next milestone is **Direct Hire Vertical Slice 3 — Preparation to Formation Handoff**: Zeya brings the owner’s approved profile, sourced website Evidence, and cautious Observations into the first working session without treating any preliminary finding as canonical truth. It requires an explicit owner action, Direct Hire lineage, reviewable preliminary findings, correction/discussion, and durable handoff; it must create no canonical Version before the existing approval boundary. This addendum records the objective only and does not design or implement Slice 3.

Immediate manual testing should therefore cover the authenticated clean-owner path through first canonical approval and Living Representation, plus failure/re-entry boundaries. It should not treat missing website research, workplace setup, training, or first-mission progression as regressions in the current slice; those are known constitutional gaps.

## 2. Stage implementation matrix

| # | Stage | Status | Immediate manual test? | Decisive evidence |
|---:|---|---|---|---|
| 1 | Discovery | PARTIALLY IMPLEMENTED | Yes | Public entry and owner entry exist; attribution/decline governance is incomplete. |
| 2 | Intelligent Capture and Immediate Research | CONFLICTS WITH CONSTITUTION | Yes, to document current behavior | No production business-name/website capture or web research; older voice-led flow remains. |
| 3 | Voice Experience | IMPLEMENTED — UNVALIDATED | Yes | Real OpenAI Realtime → durable handoff → ElevenLabs/Telnyx path and lineage exist. |
| 4 | Handoff, Reflection and Representation Brief | IMPLEMENTED — UNVALIDATED | Yes | Traceable output and a persisted, validated brief/clarification result exist. |
| 5 | Calibration | PARTIALLY IMPLEMENTED | Yes | Confirm/refine/redirect/continue persist; robust pause/reject/resume does not. |
| 6 | Imagine Working Together | PARTIALLY IMPLEMENTED | Yes | Tailored three-step commercial bridge exists; scope/terms remain thin. |
| 7 | Hiring Decision | PARTIALLY IMPLEMENTED | Yes | Positive path reaches Formation; decline is local-only; no governed follow-up consent. |
| 8 | Pre-Employment Preparation | PARTIALLY IMPLEMENTED — SLICE 2 PREVIEW VALIDATED | No | Direct Hire now has durable bounded website preparation, sourced non-canonical Evidence, cautious Observations, retry, and truthful progress; Formation handoff/package review remains absent. |
| 9 | Formation | PARTIALLY IMPLEMENTED | Yes | Real session/summary/correction/approval path; conversation linkage and resume are incomplete. |
| 10 | Canonical Approval | IMPLEMENTED — UNVALIDATED | Yes | Authenticated approval uses the atomic canonical-Version RPC and immutable model. |
| 11 | Workplace Readiness | SCREEN LAB ONLY | No | Only exploratory Screen Lab concepts approximate the constitutional readiness stage. |
| 12 | Operational Training | NOT IMPLEMENTED | No | Evidence infrastructure exists, but no joined training lifecycle or readiness gate exists. |
| 13 | First Mission | PARTIALLY IMPLEMENTED | No | Mission UI/APIs exist separately; no transition from canonical approval/readiness. |
| 14 | Initial MVP Operational Scope | PARTIALLY IMPLEMENTED | No | Phone dispatch exists for the Experience demonstration, not a governed hired-worker mission. |
| 15 | Specialist Employee Coordination | PARTIALLY IMPLEMENTED | No | Worker briefs/assignments exist but are not joined to the constitutional employment path. |
| 16 | External Contact Preparation | PARTIALLY IMPLEMENTED | No | Private/speech-safe brief separation exists for Experience, not the post-hire mission lifecycle. |
| 17 | External Interaction | PARTIALLY IMPLEMENTED | No | Traceable provider return exists for Experience calls; operational mission execution is disconnected. |
| 18 | Owner Collaboration | PARTIALLY IMPLEMENTED | No | Briefing-room and mission controls exist, but not as the governed post-hire collaboration loop. |
| 19 | Reflection | PARTIALLY IMPLEMENTED | No | Experience reflection is real; generalized operational reflection is not joined end-to-end. |
| 20 | Explicit Representation Update Permission | PARTIALLY IMPLEMENTED | No | Candidate review/promotion infrastructure exists; no complete owner lifecycle gate follows missions. |
| 21 | Proposal, Approval and Versioning | IMPLEMENTED — UNVALIDATED | Yes through first Version only | Proposal, decisions, immutable versions, audit and rollback paths exist. |
| 22 | Propagation and Recursive Improvement | PARTIALLY IMPLEMENTED | No | Canonical context is read by future voice contexts; active-work propagation/staleness is incomplete. |
| 23 | Performance Review and Expansion | DEFERRED BEYOND MVP | No | No joined constitutional review/expansion lifecycle; generic metrics do not satisfy it. |

## 3. Stage evidence cards

Each card answers the required fields in the same order: purpose; status; production paths; Screen Lab/fixture paths; tests; database; providers; authentication; entry; completion; persisted state; missing behavior; missing pause/failure/rejection/resume; mismatch; validation; immediate test; next action.

### 1 — Discovery

1. **Purpose:** Invite a prospect to experience Zeya before hiring. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `app/page.tsx`, `app/formation/entry/page.tsx`, `app/experience/page.tsx`. 4. **Lab:** `app/experience/screen-lab/*`. 5. **Tests:** `tests/integration/rf-b-auth-routing.test.ts`, `public-experience-browser-contract.test.ts`. 6. **DB:** none until session start. 7. **Providers:** none at discovery. 8. **Auth:** public Experience permits signed-out use; owner entry resolves auth. 9. **Entry:** CTA or `/formation/entry`. 10. **Completion:** navigation to `/experience` (owner adds `?entry=owner`). 11. **Persisted:** only any existing browser analytics/attribution, not a governed discovery decision. 12. **Missing:** complete source/consent model and employment-position consistency. 13. **Boundary gaps:** decline/no-follow-up is not an auditable lifecycle outcome. 14. **Mismatch:** entry surfaces do not fully enforce the constitutional discovery contract. 15. **Validation:** route behavior has static/integration coverage, not production-tested here. 16. **Immediate test:** yes. 17. **Next:** manually verify signed-out and clean-owner entry and audit copy/consent separately.

### 2 — Intelligent Capture and Immediate Research

1. **Purpose:** minimally capture owner/business/website/phone/offer and create a bounded public-evidence brief. 2. **Status:** CONFLICTS WITH CONSTITUTION. 3. **Production:** `app/experience/page.tsx`, `hooks/voice/usePublicExperienceVoiceConversation.ts`, `hooks/realtime/useRealtimeOnboardingSession.ts`, `app/api/experience/session/route.ts`, `finalize-zeya/route.ts`. 4. **Lab:** Academy fixtures in `lib/testing/fixtures/academy.ts` contain richer fictional fields but are not production capture. 5. **Tests:** `public-experience-browser-contract`, `public-experience-v2.1`, `pre-canonical-public-experience-static`. 6. **DB:** `public_experience_sessions`, voice lineage/output tables; owner provisioning may create Business and Representation. 7. **Providers:** OpenAI Realtime starts before the later phone form. 8. **Auth:** public or authenticated owner context. 9. **Entry:** start Experience voice. 10. **Completion:** transcript-derived name/offer/customer plus valid E.164 phone. 11. **Persisted:** session, transcript/output/candidates and handoff data; no website evidence bundle. 12. **Missing:** business-name field, website field, URL validation, homepage/metadata/About/product inspection, provenance and partial-research state. 13. **Boundary gaps:** no research retry/partial/unavailable flow or consent withdrawal before dispatch. 14. **Mismatch:** this is the older four-item scripted flow—owner name, offer, customer and phone—not the constitutional capture contract. 15. **Validation:** current behavior is covered; constitutional behavior does not exist. 16. **Immediate test:** yes, to baseline the mismatch. 17. **Next:** design a bounded capture/research stage before changing the voice script.

### 3 — Voice Experience

1. **Purpose:** conduct a prepared, traceable Veya conversation. 2. **Status:** IMPLEMENTED — UNVALIDATED. 3. **Production:** `app/experience/page.tsx`; `finalize-zeya`, `delegate-call`, `reconcile`, `status` routes; `lib/experience/public-veya-brief.ts`; `lib/dispatch/*`; `app/api/webhooks/elevenlabs/*`; voice output services. 4. **Lab:** Experience voice-active/wait/delay/failure phases are local-only. 5. **Tests:** quality, v2.1, dispatch-integrity, completion, finalization-safety, voice-lineage suites. 6. **DB:** sessions, lineage, outputs, candidates, webhook receipts and dispatch state/RPCs. 7. **Providers:** OpenAI Realtime, ElevenLabs and Telnyx; Twilio-named concepts are not the selected current dispatch adapter. 8. **Auth:** public token or authenticated owner; service role performs durable writes. 9. **Entry:** finalized Zeya output and valid phone reserve a dispatch. 10. **Completion:** provider-correlated finalized output or explicit failed/resolution-pending state. 11. **Persisted:** dispatch IDs, provider IDs, lineage, transcript/output, candidates and outcome. 12. **Missing:** Stage-2 research input and full missed/interrupted rescheduling UX. 13. **Boundary gaps:** retry exists unevenly; consent withdrawal/reschedule is not a complete governed path. 14. **Mismatch:** prepared context lacks constitutional web evidence. 15. **Validation:** substantial tests; live providers were not called in this audit. 16. **Immediate test:** yes. 17. **Next:** run one Preview call and verify provider correlation, no spoken leakage, completion and failure recovery.

### 4 — Handoff, Reflection and Representation Brief

1. **Purpose:** synthesize evidence without creating canonical truth. 2. **Status:** IMPLEMENTED — UNVALIDATED. 3. **Production:** `app/api/experience/session/reflection/route.ts`, `lib/experience/representation-brief-generator.ts`, `app/experience/page.tsx`. 4. **Lab:** processing, valid brief and clarification-required fixtures. 5. **Tests:** `representation-brief-v1`, `transcript-to-brief-v2`, completion and Screen Lab tests. 6. **DB:** `public_experience_representation_briefs`, sessions, outputs, candidates, evidence. 7. **Providers:** no generation provider; current brief generator is deterministic over captured output. 8. **Auth:** experience token/user scope; service client persists. 9. **Entry:** completed provider output reconciles session. 10. **Completion:** persisted valid brief or clarification-required result. 11. **Persisted:** immutable per-session brief plus provenance/evidence links. 12. **Missing:** website evidence and richer contradiction/retry UX. 13. **Boundary gaps:** reflection retry/resume is polling-driven and not a complete user-controlled recovery workflow. 14. **Mismatch:** input set is narrower than the constitution. 15. **Validation:** static/integration coverage, no deployed verification here. 16. **Immediate test:** yes. 17. **Next:** manually prove completed call → reflection-ready → persisted brief and clarification behavior.

### 5 — Calibration

1. **Purpose:** let the owner govern the preliminary interpretation. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `app/experience/page.tsx`, `app/api/experience/session/reflection/response/route.ts`. 4. **Lab:** brief and calibration phases. 5. **Tests:** representation-brief and commercial-bridge suites. 6. **DB:** `public_experience_brief_responses`; evidence/candidate tables. 7. **Providers:** none required. 8. **Auth:** experience/session identity and authenticated owner where applicable. 9. **Entry:** reviewable brief. 10. **Completion:** confirm/refine/redirect/continue response opens bridge. 11. **Persisted:** response type/text with idempotent RPC; some bridge resume state is only `sessionStorage`. 12. **Missing:** explicit reject and durable pause/resume semantics. 13. **Boundary gaps:** preserved exact review state and auditable rejected interpretation are incomplete. 14. **Mismatch:** local browser resume is not governed persistence. 15. **Validation:** behavior tested locally, not production-validated here. 16. **Immediate test:** yes. 17. **Next:** test all response types and refresh; specify durable pause/reject states.

### 6 — Imagine Working Together

1. **Purpose:** explain a contextual working relationship before asking for hire. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** commercial-bridge phases in `app/experience/page.tsx`, generation in `lib/experience/commercial-bridge.ts`. 4. **Lab:** recognition, role and boundaries phases. 5. **Tests:** `commercial-bridge-v1.test.ts`, `commercial-bridge-experience.test.ts`. 6. **DB:** reads persisted brief; phase itself is browser state. 7. **Providers:** browser speech output where available. 8. **Auth:** inherited Experience session. 9. **Entry:** calibrated brief. 10. **Completion:** recognition → role → boundaries → hiring decision. 11. **Persisted:** limited `sessionStorage` resume marker, not a lifecycle object. 12. **Missing:** explicit initial scope, transparent commercial terms and full boundary decision record. 13. **Boundary gaps:** pause is browser-local; voice failure can fall back to text. 14. **Mismatch:** real tailored bridge exists, but it is not a complete informed-commercial-decision contract. 15. **Validation:** tests exist, no production validation here. 16. **Immediate test:** yes. 17. **Next:** manually verify personalization, claims and fallback; then define the commercial contract.

### 7 — Hiring Decision

1. **Purpose:** record hire, permitted follow-up, or refusal unambiguously. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** hiring/onboarding/identity phases in `app/experience/page.tsx`; positive handoff through `app/api/formation/prepare/route.ts`. 4. **Lab:** hiring, onboarding and identity phases. 5. **Tests:** `rf-b-experience-to-formation`, `formation-prepare-handoff`. 6. **DB:** positive path relies on confirmed brief/session and creates Formation session; no hiring-decision table is evidenced. 7. **Providers:** none. 8. **Auth:** Formation requires authenticated owner. 9. **Entry:** bridge complete. 10. **Completion:** positive action prepares Formation; decline returns to initial locally. 11. **Persisted:** Formation session only on positive path; decline/identity bridge values are browser storage. 12. **Missing:** terms, not-ready vs refusal, follow-up permission/window, permanent no-contact and audit. 13. **Boundary gaps:** no durable resume/follow-up task or owner-return policy. 14. **Mismatch:** a local decline marker is not an auditable refusal. 15. **Validation:** positive contract tested; full decision model absent. 16. **Immediate test:** positive path yes; observe decline as known gap. 17. **Next:** design a governed hiring-decision record before automation.

### 8 — Pre-Employment Preparation

1. **Purpose:** prepare evidence, assumptions and opportunities before Formation. 2. **Status:** PARTIALLY IMPLEMENTED — DIRECT HIRE SLICE 2 VALIDATED IN PREVIEW. 3. **Production:** authenticated Direct Hire preparation route and executor, safe public-site fetch, deterministic extraction, durable onboarding progress, and Evidence/Observation persistence; generic `FormationWorkflow` remains a separate boundary. 4. **Lab:** Direct Hire preparation states remain local-only fixtures. 5. **Tests:** Direct Hire safe-fetch, extraction, preparation, migration and boundary suites. 6. **DB:** durable preparation status/progress/attempt/lease fields plus website provenance on Evidence and idempotency on Observations. 7. **Providers:** none; bounded HTTPS research is server-side and deterministic. 8. **Auth:** authenticated owner claim plus dedicated service finalization. 9. **Entry:** explicit owner preparation action on a persisted Direct Hire session. 10. **Completion:** durable `ready`, `partial`, or safe `failed` result. 11. **Persisted:** sourced non-canonical Evidence, cautious Observations, attempt and truthful per-step progress. 12. **Missing:** owner review package and Formation handoff. 13. **Boundary gaps:** second-owner isolation, live lease contention, stale-lease recovery and partial-result paths remain unvalidated. 14. **Mismatch:** generic Formation copy is not proof of a Direct Hire handoff. 15. **Validation:** one Preview site completed on explicit retry with four Evidence records and one Observation, no Formation or Version. 16. **Immediate test:** no additional automated execution; targeted runtime boundary tests remain. 17. **Next:** define and separately authorize Vertical Slice 3 preparation-to-Formation handoff.

### 9 — Formation

1. **Purpose:** produce a governed first Representation proposal with the owner. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `/formation/sessions/[sessionId]`, `components/formation/FormationWorkflow.tsx`, prepare/initiate/session/advance/link-conversation/summary/correct/pause APIs. 4. **Lab:** all Formation UI states use the real workflow component with local fixtures. 5. **Tests:** formation sessions/static, RF-B critical path/handoff. 6. **DB:** `representation_formation_sessions`, proposals, evidence, observations and session RPCs. 7. **Providers:** summary is server-generated from available governed data; no real Formation voice provider is connected in the UI flow. 8. **Auth:** authenticated owner plus ownership/RLS/service authority. 9. **Entry:** confirmed valid Experience brief via `/formation/prepare`, or direct initiate. 10. **Completion:** current proposal/source fingerprint ready for approval. 11. **Persisted:** ordered Formation status, linked source IDs, corrections/evidence/proposal. 12. **Missing:** actual prepared conversation capture and complete domain coverage. 13. **Boundary gaps:** UI advances pending→linked without calling the dedicated linkage route; pause merely acknowledges saved state; refresh at linked status maps to summary review without refetching a summary, risking an empty screen. 14. **Mismatch:** orchestration may mark a conversation linked without traceable conversation output. 15. **Validation:** local contracts exist; live full path unvalidated. 16. **Immediate test:** yes. 17. **Next:** reproduce linkage and refresh defects, then repair before broadening Formation.

### 10 — Canonical Approval

1. **Purpose:** create the first immutable approved source of truth. 2. **Status:** IMPLEMENTED — UNVALIDATED. 3. **Production:** Formation approve route; `lib/representation/representation-service.ts`, `supabase-adapter.ts`; versions/rollback APIs. 4. **Lab:** approval confirmation/version-created visuals only. 5. **Tests:** representation-state, canonical pointer atomicity, RF-B critical path/living suites. 6. **DB:** proposals, approval decisions, immutable versions, confidence, audit events; `zeya_create_canonical_version_atomic`. 7. **Providers:** none. 8. **Auth:** owner visibility/approval plus dedicated service-role canonical writer; authenticated direct table writes are revoked. 9. **Entry:** current proposal and matching source fingerprint. 10. **Completion:** atomic Version creation/current pointer or safe non-success. 11. **Persisted:** approval, Version snapshot, confidence, history/audit and rollback lineage. 12. **Missing:** complete modify/reject/defer/request-evidence UI from approval screen. 13. **Boundary gaps:** stale proposal is checked, but recovery UX needs manual proof. 14. **Mismatch:** first approval flow emphasizes approve/correct, not every constitutional decision. 15. **Validation:** strong static/integration evidence; no deployed DB execution in this audit. 16. **Immediate test:** yes. 17. **Next:** verify exactly one Version and pointer, then verify duplicate/stale approval safety.

### 11 — Workplace Readiness

1. **Purpose:** establish least-privilege access and operational controls. 2. **Status:** SCREEN LAB ONLY. 3. **Production:** no joined readiness route/state. 4. **Lab:** exploratory operational UX in `app/experience/screen-lab/*`, explicitly marked concept. 5. **Tests:** Screen Lab rendering/safety tests only. 6. **DB:** no constitutional readiness object/gate. 7. **Providers:** no connection-verification lifecycle. 8. **Auth:** lab requires authenticated Preview user. 9. **Entry/completion:** absent in production. 10. **Persisted:** none from lab. 11. **Missing:** checklist, scoped grants, tests, failures and readiness gate. 12. **Boundary gaps:** revoke/pause/resume absent. 13. **Mismatch:** concept is not operational. 14. **Validation:** visual only. 15. **Immediate test:** no. 16. **Next:** define minimum phone-first readiness contract after canonical path stabilizes.

### 12 — Operational Training

1. **Purpose:** organize permitted business knowledge as evidence without silently changing Representation. 2. **Status:** NOT IMPLEMENTED. 3. **Production:** evidence/observation/proposal APIs and data model are reusable primitives, not a training stage. 4. **Lab:** small concept surfaces only. 5. **Tests:** representation/evidence tests, none for training lifecycle. 6. **DB:** evidence, observations, confidence and proposals. 7. **Providers:** no ingestion provider joined. 8. **Auth:** generic owner/RLS boundaries exist. 9. **Entry/completion:** absent. 10. **Persisted:** generic evidence only. 11. **Missing:** sources, sensitivity, objectives, progress/readiness and contradiction workflow. 12. **Boundary gaps:** access withdrawal/resume absent. 13. **Mismatch:** primitives must not be called a completed stage. 14. **Validation:** not applicable. 15. **Immediate test:** no. 16. **Next:** defer until readiness and source governance are specified.

### 13 — First Mission

1. **Purpose:** approve one bounded business-development assignment. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `components/leads/MissionControl.tsx`, `components/briefing-room/ZeyaBriefingRoom.tsx`, `/api/zeya/mission-*`, `lib/mission/*`, `lib/workflow/*`. 4. **Lab:** exploratory mission concepts. 5. **Tests:** mission/workflow tests where present; no constitutional handoff test. 6. **DB:** mission leads/assignments and business profile fields. 7. **Providers:** none required until execution. 8. **Auth:** bearer/Supabase user in legacy operational surfaces. 9. **Entry:** accessible through existing briefing-room state, not canonical approval. 10. **Completion:** assignment/brief state in that subsystem, not a constitutional approval gate. 11. **Persisted:** mission detail, leads, assignments. 12. **Missing:** readiness/training prerequisites, explicit authority/approval and owner-lifecycle routing. 13. **Boundary gaps:** reject/defer/resume semantics are not proven. 14. **Mismatch:** disconnected operational capability is not the First Mission stage. 15. **Validation:** unvalidated as a constitutional flow. 16. **Immediate test:** no. 17. **Next:** characterize legacy mission behavior before deciding what to reuse.

### 14 — Initial MVP Operational Scope

1. **Purpose:** constrain first work to approved phone-first scope. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** dispatch, provider and call-output infrastructure under `lib/dispatch`, `lib/voice`, provider/webhook APIs. 4. **Lab:** call states are Experience simulations. 5. **Tests:** dispatch/completion/voice suites. 6. **DB:** dispatches, briefs, lineage, outputs. 7. **Providers:** ElevenLabs/Telnyx. 8. **Auth:** service-provider boundaries plus owner tenancy. 9. **Entry/completion:** only concretely implemented for Experience demonstration. 10. **Persisted:** call trace/output. 11. **Missing:** hired-role scope gate, contact authority, hours/territory/compliance and mission linkage. 12. **Boundary gaps:** revocation/stop controls are incomplete. 13. **Mismatch:** demonstration call infrastructure is not operational employment authorization. 14. **Validation:** Experience path only, and not live-tested here. 15. **Immediate test:** no post-hire test. 16. **Next:** reuse infrastructure only behind explicit readiness and mission authority.

### 15 — Specialist Employee Coordination

1. **Purpose:** let Zeya brief, supervise and review specialists. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** worker brief generator/dispatcher, mission assignments, orchestration libraries and agent UI. 4. **Lab:** exploratory specialist surfaces. 5. **Tests:** worker-brief/dispatch/orchestration tests. 6. **DB:** worker briefs, dispatches, agents and assignments. 7. **Providers:** configured calling providers. 8. **Auth:** mixed service and owner boundaries. 9. **Entry:** legacy mission assignment, not the constitutional Stage-13 gate. 10. **Completion:** result can return to storage; executive review is not uniformly enforced. 11. **Persisted:** brief, assignment, dispatch/result. 12. **Missing:** senior-Zeya review/redirection/escalation lifecycle. 13. **Boundary gaps:** revoke/reassign/failure handling is fragmented. 14. **Mismatch:** infrastructure does not prove organizational hierarchy enforcement. 15. **Validation:** partial subsystem tests only. 16. **Immediate test:** no. 17. **Next:** specify the specialist contract and prove all results return through Zeya.

### 16 — External Contact Preparation

1. **Purpose:** generate governed private and speech-safe briefs. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `lib/experience/public-veya-brief.ts`, worker brief generator, dispatcher/provider adapter. 4. **Lab:** Experience handoff visuals. 5. **Tests:** `public-experience-quality` explicitly asserts private labels/names do not enter spoken handoff; v2.1 checks secret leakage. 6. **DB:** worker briefs/dispatch and voice lineage. 7. **Providers:** ElevenLabs/Telnyx. 8. **Auth:** service-owned dispatch. 9. **Entry:** Experience call handoff. 10. **Completion:** private guidance plus speech-safe opening/provider variables. 11. **Persisted:** brief and provider correlation. 12. **Missing:** constitutional operational mission/authority input and owner approval. 13. **Boundary gaps:** mission cancellation/update after brief generation is not joined. 14. **Mismatch:** proven separation applies to Experience, not the hired first mission. 15. **Validation:** leakage assertions exist; their standalone `tsx` runner was unavailable in this environment, and providers remain unvalidated. 16. **Immediate test:** indirectly during Experience. 17. **Next:** preserve this separation when operational missions are connected.

### 17 — External Interaction

1. **Purpose:** conduct authorized contact and return a traceable outcome. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** provider adapters/webhooks, reconcile/completion and voice output capture. 4. **Lab:** active/wait/delayed/failed states. 5. **Tests:** completion, dispatch integrity, webhook/lineage tests. 6. **DB:** receipts, lineage, outputs, candidates and dispatch state. 7. **Providers:** ElevenLabs/Telnyx. 8. **Auth:** signed webhooks/provider correlation/service writes. 9. **Entry:** Experience dispatch. 10. **Completion:** correlated finalized output/failure. 11. **Persisted:** provider IDs, transcript/output/outcome. 12. **Missing:** approved operational mission, contact policy and execution plan. 13. **Boundary gaps:** post-hire retry/escalation/reschedule absent. 14. **Mismatch:** this currently demonstrates Zeya, rather than executing hired scope. 15. **Validation:** local/deployed-test scripts exist; no provider call made here. 16. **Immediate test:** Experience call only. 17. **Next:** validate the current call, then keep operational calls gated off.

### 18 — Owner Collaboration

1. **Purpose:** give the owner decisions, exceptions and useful reports. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** `ZeyaBriefingRoom`, mission controls and reporting/workflow utilities. 4. **Lab:** exploratory operational area. 5. **Tests:** component/workflow tests where present, no joined lifecycle test. 6. **DB:** business profile, mission, lead/assignment and reporting records. 7. **Providers:** no single required provider. 8. **Auth:** authenticated business owner. 9. **Entry:** legacy app/briefing room, not Stage 17 outcome. 10. **Completion:** no constitutional collaboration gate. 11. **Persisted:** fragmented mission/business state. 12. **Missing:** joined exceptions, recommendations, approvals and reporting cadence. 13. **Boundary gaps:** notification failure/acknowledgement/resume unproven. 14. **Mismatch:** dashboard presence is not an executive collaboration lifecycle. 15. **Validation:** unvalidated in constitutional sequence. 16. **Immediate test:** no. 17. **Next:** inventory legacy owner collaboration before integration design.

### 19 — Reflection

1. **Purpose:** turn outcomes into governed learning objects. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** Experience reflection/brief generator; voice candidates, conversation review and learning libraries/APIs. 4. **Lab:** Experience reflection visuals only. 5. **Tests:** brief, governed-learning, voice-live-learning and candidate-promotion suites. 6. **DB:** outputs, candidates, evidence, observations, proposals, confidence. 7. **Providers:** extraction may use OpenAI in output capture; brief synthesis itself is deterministic. 8. **Auth:** tenant/owner visibility and service capture. 9. **Entry:** concretely, completed Experience call. 10. **Completion:** brief/candidates; generalized mission reflection gate absent. 11. **Persisted:** governed evidence and candidates. 12. **Missing:** operational comparison of plan/authority/outcome and explicit no-learning result. 13. **Boundary gaps:** retry/escalation across missions incomplete. 14. **Mismatch:** one Experience reflection does not implement recurring employee reflection. 15. **Validation:** substantial tests; deployed state not checked. 16. **Immediate test:** Experience reflection yes. 17. **Next:** preserve learning governance and add mission-scoped reflection only after execution exists.

### 20 — Explicit Representation Update Permission

1. **Purpose:** ask whether learning may become a proposed Representation change. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** conversation review/candidate promotion APIs and components; representation proposal services. 4. **Lab:** concept only. 5. **Tests:** candidate promotion/review/atomic canonicalization suites. 6. **DB:** review decisions, promotions, evidence/observations/proposals. 7. **Providers:** none. 8. **Auth:** owner reviewer and tenant checks. 9. **Entry:** candidate review subsystem, not a joined mission-reflection screen. 10. **Completion:** candidate can be accepted/rejected/promoted. 11. **Persisted:** review decision and promotion target. 12. **Missing:** clear “no change/consider update” gate in the constitutional journey. 13. **Boundary gaps:** defer/investigate/resume UX is incomplete. 14. **Mismatch:** backend promotion capability is not complete owner permission UX. 15. **Validation:** static tests, deployed behavior not checked. 16. **Immediate test:** no. 17. **Next:** characterize permission semantics before exposing post-mission proposals.

### 21 — Proposal, Approval and Versioning

1. **Purpose:** govern proposed truth changes and immutable Versions. 2. **Status:** IMPLEMENTED — UNVALIDATED. 3. **Production:** representation service/adapter; proposals/approvals/versions/rollback APIs; Formation approval. 4. **Lab:** first-Version approval visuals, not persistence. 5. **Tests:** representation state A–E, reconciliation, canonical atomicity, candidate promotion. 6. **DB:** domains/elements/evidence/observations/proposals/decisions/versions/confidence/audit and atomic RPC. 7. **Providers:** none. 8. **Auth:** owner decisions, RLS visibility, service-only atomic writes, immutable-table privilege reconciliation. 9. **Entry:** pending proposal plus evidence/current fingerprint. 10. **Completion:** approved Version or governed non-approval through underlying APIs. 11. **Persisted:** full immutable/audited governance graph. 12. **Missing:** a unified owner UI for all modify/reject/defer/investigate outcomes. 13. **Boundary gaps:** UI recovery from stale/conflict needs validation. 14. **Mismatch:** backend coverage exceeds current joined product UX. 15. **Validation:** strong tests/migrations, no deployed DB checks in this audit. 16. **Immediate test:** first Version only. 17. **Next:** validate atomicity and DB parity before relying on broader proposal flows.

### 22 — Propagation and Recursive Improvement

1. **Purpose:** propagate approved current truth to authorized future work. 2. **Status:** PARTIALLY IMPLEMENTED. 3. **Production:** representation context service/API, voice context/lineage, current-version pointer and agent-context route. 4. **Lab:** canonical Living states only. 5. **Tests:** voice representation context/lineage and canonical pointer tests. 6. **DB:** current Version pointer, element pointers, lineage and context records. 7. **Providers:** future voice sessions consume assembled context. 8. **Auth:** tenant and service boundaries. 9. **Entry:** canonical Version creation. 10. **Completion:** newly assembled authorized contexts reference a Version. 11. **Persisted:** Version/context lineage. 12. **Missing:** active-mission propagation policy, stale-artifact invalidation and recursive outcome loop. 13. **Boundary gaps:** rollback impact and in-flight work behavior are not a joined UX. 14. **Mismatch:** future-session context assembly is only part of constitutional propagation. 15. **Validation:** static/integration only. 16. **Immediate test:** Living Version identity, not operations. 17. **Next:** define propagation semantics before Stage Sandbox/executors.

### 23 — Performance Review and Expansion

1. **Purpose:** review results and continue, change, pause or expand scope. 2. **Status:** DEFERRED BEYOND MVP. 3. **Production:** generic metrics/reporting/workflow utilities do not form this stage. 4. **Lab:** any operational UX is explicitly conceptual. 5. **Tests:** none for the constitutional stage. 6. **DB:** no joined employment review/expansion object. 7. **Providers:** none defined. 8. **Auth:** would require owner authority; absent. 9. **Entry/completion:** absent. 10. **Persisted:** none specific. 11. **Missing:** performance period, evidence, scope decision, terms, authority and expansion gate. 12. **Boundary gaps:** pause/terminate/restart absent. 13. **Mismatch:** metrics alone must not be called performance review. 14. **Validation:** not applicable. 15. **Immediate test:** no. 16. **Next:** defer until the first-mission learning loop is operational.

## 4. Current executable journey and real-versus-Lab boundary

### Executable owner journey

1. `/formation/entry` resolves owner state and sends a clean authenticated owner to `/experience?entry=owner`.
2. `/api/experience/session` authenticates the user, provisions/loads their Business and Representation, and deliberately uses pre-canonical context when no current Version exists.
3. OpenAI Realtime drives the initial voice capture. `app/experience/page.tsx` extracts name, offer and customer; the UI then collects phone.
4. `finalize-zeya` captures/finalizes the initial output. `delegate-call` reserves dispatch, produces private and speech-safe Veya briefs, and initiates the ElevenLabs/Telnyx call.
5. Webhook/reconcile routes correlate the provider call, finalize output and candidates, and move the session to reflection readiness.
6. The reflection route generates and persists one Representation Brief or clarification result. The page records calibration and renders the commercial bridge.
7. A positive hiring choice calls `/api/formation/prepare`; this requires the owner, a valid unexpired pre-canonical Experience, a valid persisted brief and a persisted confirmation response.
8. Formation advances through entry/getting familiar/conversation-ready/linked/summary/correction/approval. Approval creates the first canonical Version atomically.
9. Living Representation fetches the owner’s canonical Version. There is no connected transition to Workplace Readiness.

### Screen Lab only

`/experience/screen-lab` is server-gated by `ZEYA_ENVIRONMENT_TARGET === "preview"` and then by authenticated access. It reuses Experience, Formation and Living presentation with immutable Academy fixtures. `screenlab:` identifiers are blocked at persistence boundaries. The operational area is marked `CONCEPT — NOT YET OPERATIONAL`. Lab phases, fixtures and concepts are visual evidence only; they make no provider or persistence calls and do not change the production classifications above.

One residual safety concern merits a regression test: the Lab wrapper uses pointer-event suppression while real Experience contains inline keyboard-activatable handlers that write `sessionStorage`. The component has broad `screenLab` guards around effects and network handlers, but keyboard activation of every inline action should remain explicitly covered so no real Experience storage is touched.

## 5. Mandatory deep-inspection findings

### A. Intelligent Capture field map

| Constitutional field | Real UI/form state | Validation/API/persistence | Downstream use |
|---|---|---|---|
| Owner name | Voice transcript; `extractedName` in `app/experience/page.tsx` | Transcript extraction; finalized output/session | Veya personalization and brief |
| Business name | Not captured in real initial flow; later identity UI/Screen Lab has `businessName` | No Stage-2 production validation/persistence | Not available to immediate call preparation |
| Website | No production field | No URL validation, research API or evidence persistence | None |
| Phone | `phoneNumber` in post-voice collection phase | normalize/E.164 validation; delegate-call/session RPCs | Provider destination |
| Product/service | Voice transcript offer beat | transcript extraction/finalized output | business summary, Veya objective, brief |

Target customer is also captured, making the current flow the older four-item scripted flow: owner name, product/service, target customer, phone. The real `businessName`/email identity form appears after the hiring bridge and writes browser state; it does not cure the Stage-2 mismatch.

### B. Immediate website research

Repository searches found website-related copy/profile fields and generic `fetch` usage, but no production crawler, HTML parser, sitemap inspector, OpenGraph/page-title extractor, bounded URL-analysis service, or website-evidence ingestion pipeline connected to Experience. `package.json` contains no dedicated HTML parsing/crawling dependency. No reusable capability is production-ready for Stage 2.

Any implementation must defend against SSRF: accept only intended HTTP(S) URLs; resolve and block loopback, private, link-local and metadata-service ranges before each request; defend against DNS rebinding; revalidate every redirect; cap redirects, bytes and time; restrict content types; never forward cookies/credentials; normalize provenance; and treat fetched text as untrusted evidence, including prompt-injection content. Provider choice remains open.

### C. Zeya-to-Veya handoff and leakage boundary

The path is `ExperienceScreen` → OpenAI Realtime session → `finalize-zeya`/`captureAndExtractConversationOutput` → durable session finalization → `delegate-call` → `planPublicExperienceVeyaConversation` → worker brief/dispatcher → ElevenLabs/Telnyx → provider webhook → reconciliation/completion RPC → reflection route → deterministic Representation Brief → Experience brief/calibration UI.

Owner provisioning and pre-canonical/canonical context selection occur in `app/api/experience/session/route.ts`. Conversation identity is preserved by Experience token, dispatch ID, voice-context ID, provider conversation/call IDs and `voice_representation_lineage`.

The prior leakage fix remains explicit: `planPublicExperienceVeyaConversation` returns `privateGuidance` separately from speech-safe `opening`/`spokenHandoffContext`; the provider first-message variable uses the speech-safe value. `public-experience-quality.test.ts` rejects internal labels, spelling guidance and visitor name from spoken context; `public-experience-v2.1.test.ts` checks serialized output for secret/private-instruction leakage.

### D–G. Lifecycle, Brief, bridge and hiring

Real UI phases are `initial`, `voice_active`, `handoff`, `collecting_phone`, `submitting_handoff`, `finalizing`, `dispatching_call`, `waiting_for_call`, `brief_review`, `calibration`, `bridge_preparing`, `bridge_error`, `bridge_recognition`, `bridge_role`, `bridge_boundaries`, `hiring_decision`, `onboarding_preview`, `identity_confirmation`, `living_representation`, `completed`, and `handoff_error`. Durable DB session states are separate and include initial/finalization/dispatch/wait/completion/failure/resolution/reflection states. “Call active” is largely provider state rendered as waiting, not a distinct durable page phase.

The Brief is persisted, not reconstructed: `public_experience_representation_briefs` has a per-session identity and the response table stores decisions. Inputs are finalized Zeya/Veya output, outcomes/candidates and provenance; validation can return clarification-required. No Representation Version is created during Experience. Pre-canonical mode remains until explicit Formation approval.

“Imagine Working Together” is approximated by the real recognition/role/boundaries commercial bridge. It is tailored from the Brief but remains partial. Positive hiring is real; not-ready, refusal and follow-up consent/date/no-contact are not durably modeled.

### H–J. Preparation, Formation, canonical approval and Living Representation

Direct Hire now implements and Preview-validates a bounded part of Pre-Employment Preparation: explicit authorization, safe website research, durable progress/retry, sourced Evidence, and cautious Observations. It does not yet transfer a reviewable preparation package into Formation, so the full stage and its completion gate remain incomplete. Generic Formation entry copy is not evidence of that missing handoff.

Formation’s DB states are `initiated → getting_familiar → working_conversation_pending → working_conversation_linked`. UI-only states add active conversation, processing, summary review/correction/approval and completion/error. The handoff correctly requires an authenticated clean pre-canonical owner, confirmed persisted brief and no existing canonical Version. Two defects require manual reproduction: the UI can advance directly to “linked” without the dedicated conversation-link endpoint, and a refresh at linked status does not retrieve a previously generated summary.

Canonical creation uses an owner-authenticated approval plus a dedicated service-role client and `zeya_create_canonical_version_atomic`; direct authenticated mutation privileges on immutable Versions are revoked. The model includes evidence, confidence, audit and rollback. Living Representation is at `/representation/living`, with explicit no-business, multiple-business, no-representation and no-canonical states. Its API queries an `is_canonical` row rather than dereferencing `current_version_id`; this should be checked against real multi-version data because multiple canonical history rows could make `maybeSingle()` fail.

### K–N. Auth, database/provider dependencies, Screen Lab and operational boundary

Public Experience allows signed-out entry. Owner Experience, Formation, canonical approval and Living require authenticated Supabase user context. Durable provider/Representation writes use dedicated service-role clients; provider callbacks use their verification/correlation boundary. Multi-business is rejected rather than silently selecting a business.

The database foundation is extensive but deployment parity was not queried. Core dependencies include Businesses; Business Representations; domains/elements; evidence/observations; proposals/decisions; Versions/confidence/audit; voice lineage/outputs/candidates/review; public Experience sessions/briefs/responses/webhook receipts; and Formation sessions. Relevant migrations run from `20260711000000_representation_state_foundation.sql` through later voice, Experience, Formation, atomicity and privilege reconciliations.

Environment/provider dependencies include `NEXT_PUBLIC_SUPABASE_URL`, public Supabase publishable/anon configuration for user clients, `SUPABASE_SERVICE_ROLE_KEY` for privileged server paths, `OPENAI_API_KEY`, OpenAI Realtime endpoint/model configuration, ElevenLabs configuration and Telnyx calling configuration. No values were read or logged by this audit.

Operational mission, specialist and learning code is real code, not merely documentation, but it is disconnected from the constitutional Stage-10→11 transition. That is why Stages 13–22 are partial rather than presented as an executable lifecycle.

## 6. Immediate manual Preview test

Use a fresh authenticated user with zero Businesses and a real reachable phone controlled by the tester.

1. Open `/formation/entry`; verify clean-owner routing to `/experience?entry=owner` and no loop.
2. Start the Experience; confirm only name, offer and customer are captured by voice, then phone by UI. Record the absence of business-name/website/research as the known Stage-2 gap.
3. Verify microphone completion leads once to phone capture; invalid phone stays local and no call dispatches.
4. Submit a valid phone. Verify visible finalizing/dispatch/wait states and exactly one inbound test call.
5. During Veya’s opening, listen for leaks: no internal labels, instructions, confidence data, spelling guidance, IDs or operational metadata.
6. Complete the call. Verify the browser reaches reflection processing then a valid Brief (or an explicit clarification-required result), without manual reload.
7. Refresh during waiting and during brief review; verify the Experience resumes the same durable session rather than dispatching twice.
8. Exercise calibration confirm and one correction/refinement. Verify the commercial bridge is contextual, not a generic feature tour.
9. Choose the positive hiring action. Verify `/api/formation/prepare` leads to one Formation session and no canonical Version exists yet.
10. Advance Formation to conversation-ready. Confirm whether “begin conversation” merely advances to linked; capture this as a defect if no traceable Formation output is created.
11. Generate a summary, refresh before approval, and verify whether the summary disappears/blank state occurs.
12. Submit a correction, regenerate, then approve once. Verify exactly one Version is created and Living Representation displays it.
13. Re-submit/back-refresh approval; verify idempotent response and no duplicate Version.
14. Open `/representation/living` directly after sign-in and after refresh. Verify Version number/content and the owner’s business.
15. Separately test signed-out public Experience, an active-Formation owner, a canonical owner and a multiple-business owner for the documented redirect/fallback behavior.
16. In Preview only, open `/experience/screen-lab`; tab through controls and confirm no network, provider, analytics, DB, or real Experience `sessionStorage` mutation occurs. In a production-target build, confirm not-found.

Do not use Production customer phone numbers, do not inspect or print secrets, and do not use the Screen Lab to infer provider/database readiness.

## 7. Prerequisites for that test

- Preview deployment built with `ZEYA_ENVIRONMENT_TARGET=preview`.
- Correct branch-scoped Supabase URL, public key and service-role key; service role must have the committed RPC execute grants.
- Applied migration parity through Formation/canonical privilege reconciliations.
- Valid OpenAI Realtime credentials/model configuration.
- Valid ElevenLabs agent/webhook configuration and Telnyx outbound number/credentials.
- Webhook URL reachable from providers and signatures/secrets configured.
- A new auth account with no Business for clean-owner testing, plus controlled accounts for active Formation, canonical and multiple-business states.
- A tester-owned E.164 phone and consent to receive the call.
- Browser devtools network/storage panes and provider/Supabase logs available without exposing secret values.

## 8. Issue classification

| Priority | Issue | Why |
|---|---|---|
| P0 | None proven by repository inspection alone | No evidence here of an active security/data-corruption incident; deployed parity was intentionally not queried. |
| P1 | Stage-2 capture/research conflicts with governing constitution | The primary Experience contract is structurally different and downstream briefs lack required public evidence. |
| P1 | Formation can mark conversation linked without traceable linkage | It can violate the Formation governance boundary and source completeness. |
| P1 | Formation summary refresh/resume may render no summary | It can block approval after a normal reload. |
| P1 | Hiring refusal/follow-up consent is not durable | Risks unauthorized follow-up or inability to prove refusal/permission. |
| P2 | Living route selects `is_canonical` with `maybeSingle()` rather than current pointer | Multi-version history may fail or become ambiguous; reproduce against parity-safe data. |
| P2 | Formation preparation copy exceeds the validated Direct Hire handoff | Slice 2 performs bounded research, but no prepared-context transfer into Formation exists. |
| P2 | Calibration pause/reject/resume is browser-local/incomplete | Owner governance is not durable enough. |
| P2 | Screen Lab keyboard/sessionStorage boundary needs explicit regression proof | Pointer suppression alone does not block keyboard activation. |
| Deferred | Stages 11–23 joined lifecycle | Known product work, not defects in the current Stages 1–10 slice unless advertised as operational. |

## 9. Database parity checklist

Run only as a separately approved, read-only deployment audit:

- Confirm every migration in repository order is recorded in Preview.
- Confirm tables, columns, enum/check constraints, FKs and unique indexes for Experience, voice lineage/output, Brief, Formation and Representation match migrations.
- Confirm RPC signatures/owners/security-definer/search paths and EXECUTE grants, especially owner provisioning, Experience lifecycle, Formation lifecycle and atomic canonical creation.
- Confirm RLS is enabled and policies match for owner reads and service writes.
- Confirm immutable triggers and table privileges prevent authenticated direct Version mutation.
- Confirm current-version and element-pointer atomicity functions are the latest definitions.
- Confirm webhook receipt/provider-ID uniqueness and replay protection.
- Confirm one-Brief-per-session and Formation uniqueness/conflict constraints.
- Confirm no clean owner has duplicate Business/Representation rows after provisioning.
- Confirm a test Representation’s `current_version_id` and canonical-history semantics agree with the Living query.
- Never print keys, tokens, emails, phone numbers, transcripts or business content during parity checks.

## 10. Risk register

| Risk | Impact | Evidence/mitigation |
|---|---|---|
| Constitution outruns current capture | Misleading personalization and incomplete evidence | Stage 2 is explicitly classified as conflict; design before script change. |
| Deployed schema/ACL drift | Runtime failures despite passing static tests | Complete the read-only parity checklist before manual call test. |
| Duplicate dispatch/provider replay | Multiple calls or conflicting output | Existing reservation, uniqueness and webhook receipt controls; test one submission/reload. |
| Briefing leakage | Internal instructions spoken to owner | Private/speech-safe split and tests exist; listen during Preview call. |
| Premature canonicalization | Unapproved truth becomes current | Experience remains pre-canonical; atomic approval is service-only; inspect Version count. |
| Formation source gap | Canonical Version based on a simulated conversation transition | Stop and repair linkage before treating Formation as complete. |
| Resume loss | Owner cannot safely continue | Reproduce Experience and Formation refresh points. |
| Unauthorized follow-up | Consent breach | Do not automate follow-up until a durable decision model exists. |
| Screen Lab side effect | Fixture interaction touches real browser state/network | Existing guards plus identifier rejection; add keyboard/storage regression coverage. |
| Legacy operational code overclaimed | False readiness/customer expectation | Keep Stages 11–23 disconnected and concept-labeled until gated end-to-end. |
| Website-research SSRF/prompt injection | Network compromise or poisoned evidence | Direct Hire uses HTTPS, DNS pinning, mixed-address rejection, bounded extraction and non-canonical output; preserve these controls and validate broader sites before expansion. |

## 11. Recommended implementation sequence

1. Complete the manual Preview test and read-only database parity check for the existing owner path.
2. Repair only proven Formation linkage/resume and Living-current-pointer defects, with characterization tests first.
3. Specify and implement the constitutional Stage-2 capture/research contract, including consent, bounded failure and SSRF defenses; only then revise the conversation script.
4. Add durable Calibration pause/reject/resume and a governed Hiring Decision/follow-up-consent object.
5. Define a truthful Pre-Employment Preparation package and gate Formation on it; align copy with executed work.
6. Validate first canonical approval, rollback and propagation under deployed concurrency/replay conditions.
7. Define minimum Workplace Readiness and Operational Training contracts.
8. Characterize legacy mission/specialist/briefing-room code, then connect only the reusable pieces behind readiness, authority and approval gates.
9. Implement the mission → specialist → external interaction → owner collaboration → reflection → explicit update-permission loop before Stage 23 expansion.
10. Keep all undefined future operational UX visibly conceptual and stop before any Stage Sandbox work until separately approved.

## 12. Audit limitations

This audit inspected repository code, migrations, tests and governing documents. It did not execute SQL, query deployed Supabase metadata/data, call OpenAI/ElevenLabs/Telnyx, inspect environment values, or deploy. Therefore all provider-dependent and deployed-database-dependent paths are classified no higher than **IMPLEMENTED — UNVALIDATED**, even where static and integration coverage is strong.

## 13. Validation results

- `npx tsc --noEmit`: passed.
- Targeted ESLint over Experience, Formation, Representation and supporting libraries: passed.
- `npx vitest run tests/integration/rf-b-experience-to-formation.test.ts tests/integration/rf-b-living-representation.test.ts tests/integration/screen-lab-live-characterization.test.ts`: 3 files and 43 tests passed.
- `npm run build`: passed; the production build generated all 67 static pages and included the expected Experience, Formation, Living and Screen Lab route entries.
- `public-experience-quality.test.ts` and `representation-brief-v1.test.ts`: not completed because the repository has no local `tsx` executable and `npx tsx` waited for unavailable package resolution in the restricted environment. Both attempts were terminated without test output; this is a tooling limitation, not a passing result.
- `git diff --check`: passed.
- Audit completeness search: 23 of 23 stage headings present and every matrix row uses one of the required classifications.
