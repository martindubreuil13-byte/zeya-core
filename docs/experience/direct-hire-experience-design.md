# Zeya Direct Hire Experience Design

**Version:** 1.0.0-draft

**Status:** Reconstructed approved design; exact reconstructed dialogue marked for owner confirmation

**Date:** 2026-08-04

## 1. Design authority and intent

This specification defines the Direct Hire interaction for an authenticated owner who has already decided to work with Zeya. It is subordinate to the [Product Constitution](../product-constitution-customer-journey.md), the [BRI Constitution](../brain/00-constitution.md), the [First Day protocol](../brain/12-first-day-at-work.md), [RF-A](../representation-formation-rf-a.md), and the [Direct Hire architecture](../architecture/direct-hire-onboarding-architecture.md).

The experience should feel like a newly hired AI Business Development Executive meeting the owner and preparing for her first day. It must not feel like SaaS onboarding, CRM configuration, a wizard, a tutorial, a sales pitch, or a second Public Experience.

The design uses five screens:

1. First Meeting
2. Basic Business Profile
3. Preparation Begins
4. Preparation Conversation
5. Closing / First Working Session Readiness

## 2. Dialogue reconstruction status

The protected concepts and required fields are recoverable from the approved task record. The complete previously approved verbatim script is not present in the repository or attachments.

Accordingly:

- text explicitly supplied in the approved record is marked **Protected**;
- newly reconstructed connective wording is marked **Owner confirmation required**;
- implementation must not present confirmation-required wording as frozen copy until the owner confirms it;
- product intent, actions, states, validation, governance, and completion criteria remain normative now.

## 3. Global experience rules

### Zeya's posture

Zeya is composed, concise, professional, observant, and quietly proactive. She speaks as a newly hired executive, not as a marketing persona or setup assistant.

She should:

- use short turns;
- state what she knows and does not know;
- respect the owner's time;
- avoid praise, hype, and celebration;
- explain preparation in employment language;
- never imply that submitted or public information is canonical;
- avoid asking questions already answered by the five fields or available evidence.

### Visual posture

- One primary task or thought per screen.
- Preserve the real Zeya typography, spacing, ambient background, and responsive layout.
- Avoid stepper/wizard chrome, numbered progress bars, confetti, badges, and dashboard panels.
- Preparation status may be visible as a restrained work list, not a gamified checklist.
- Primary actions are explicit; no hidden submission or automatic Formation creation.

### Navigation

- Browser refresh loads durable current state.
- Back navigation must not duplicate writes or regress a completed durable state.
- Signing out preserves server state.
- Signing in returns to the exact Direct Hire state through a safe relative return path.
- A completed profile is not requested again unless the owner explicitly chooses to edit it.

## 4. Screen 1 — First Meeting

### Entry condition

- The owner is authenticated.
- Owner routing has resolved this as Direct Hire.
- No active Formation or canonical Representation supersedes onboarding.
- The durable Direct Hire state is `first_meeting` or has not yet been created.

### Purpose

Acknowledge that Zeya has been hired without a prior Public Experience and establish a first-colleague relationship.

### Required Zeya line

> “I noticed we’ve never spoken before.”

**Protected:** The concept and direct observation must remain. It must not be rewritten into generic welcome language.

### Complete opening

> “I noticed we’ve never spoken before.”
>
> “Before my first day, I’d like to understand the essentials of the business and begin preparing for our first working session.”
>
> “I’ll keep this brief. I need five things to begin.”

**Owner confirmation required:** The second and third sentences are reconstructed wording. Their intent is approved; their exact wording was not recoverable.

### Owner action

Primary action: **Start our first meeting**

**Owner confirmation required:** Exact button label.

### Transition

Activation moves only to Screen 2. It does not connect voice, call a provider, write the profile, start research, or create Formation.

### Alternate states

- If authentication expires, offer sign-in and safe return.
- If status cannot load, show a quiet retry state.
- If an active Formation appears, route to it instead of rendering Direct Hire.

## 5. Screen 2 — Basic Business Profile

### Entry condition

The owner has continued from First Meeting, or a recoverable validation/persistence failure returns here with values preserved.

### Introductory line

> “Give me the basic context I should have before I begin preparing.”

**Owner confirmation required:** Reconstructed wording.

### Form

Collect exactly five fields.

#### Owner name

- **Label:** Owner name
- **Explanation:** “The name I should use when we work together.”
- Required, trimmed, human-readable text.
- Do not infer or silently overwrite it from email metadata.

**Owner confirmation required:** Explanation wording.

#### Business name

- **Label:** Business name
- **Explanation:** “The business I’m joining.”
- Required, trimmed text.
- Persists to `businesses.business_name` through the governed server boundary.

**Owner confirmation required:** Explanation wording.

#### Website

- **Label:** Website
- **Explanation:** “I’ll use this as preliminary public evidence while I prepare.”
- Required for the approved five-field profile.
- Accept a normal domain or HTTP(S) URL and normalize safely.
- Reject unsupported protocols, credentials in URLs, malformed hosts, and unsafe network destinations.
- Do not claim the website was accessed merely because validation succeeded.

**Owner confirmation required:** Explanation wording.

#### Best phone number

- **Label:** Best phone number
- **Explanation:** “A number for our work together. I won’t call anyone from this step.”
- Required and normalized using the established phone contract where applicable.
- Present country-code guidance without embedding a real example number.
- Never place the value in a URL, log, analytics event, Screen Lab fixture, or generic browser storage.

**Owner confirmation required:** Explanation wording.

#### Product or service priority

- **Label:** Product or service you most want to sell or grow
- **Explanation:** “This gives me a practical place to begin.”
- Required, concise free text.
- It is an owner assertion and does not become canonical automatically.

**Owner confirmation required:** Explanation wording.

### Required controls

- Primary action: **Begin preparation**
- Secondary action where supported: **Sign out**
- No “Skip”, hidden autosave, extra questions, uploads, or marketing opt-in.

**Owner confirmation required:** Primary button wording.

### Validation behavior

- Validate on explicit submission; field-level feedback appears beside the affected field.
- Focus the first invalid field and connect feedback with `aria-describedby`.
- Preserve every valid and invalid entered value after a recoverable error.
- Do not clear the form when the server rejects or times out.
- Do not expose raw provider/database errors.
- Duplicate submissions are disabled while pending and are idempotent server-side.

### Required error language

Field error language should be direct, for example:

- “Enter the name you’d like me to use.”
- “Enter the business name.”
- “Enter a valid public website address.”
- “Enter a valid phone number with its country code.”
- “Tell me which product or service should come first.”

**Owner confirmation required:** Exact error sentences. Validation meaning is normative.

Persistence failure:

> “I couldn’t save this yet. Your answers are still here. Try again when you’re ready.”

**Owner confirmation required:** Exact sentence.

### Successful transition

After the server durably accepts the profile, transition to Screen 3 using the returned authoritative state. Do not show receipt before persistence succeeds.

## 6. Screen 3 — Preparation Begins

### Entry condition

The five-field profile is durably stored and state is `profile_received` or `preparation_queued`.

### Purpose

Confirm receipt and explain what Zeya will do before the first working session without claiming unperformed work.

### Required heading concept

> “Before my first day”

**Protected concept:** Preserve this employment framing. Capitalization and punctuation require owner confirmation.

### Required Zeya language

> “I have what I need to begin preparing.”
>
> “I’ll review the public information available to me, separate what appears supported from what I’m assuming, and prepare the questions that matter for our first working session.”
>
> “Nothing I find becomes the truth about your business until we review it together.”

**Owner confirmation required:** All three sentences are reconstructed. Their honesty, evidence, and owner-governance meanings are required.

### Visible preparation items

The surface may show:

- Website received
- Reviewing homepage
- Understanding products
- Looking at positioning
- Preparing questions
- Drafting first impressions
- Organizing the first working session

Each item must display only a truthful state:

- Received
- Queued
- In progress
- Ready
- Failed
- Retrying

“Website received” may become Ready when the normalized website is durably stored. Research items may not become In progress or Ready without a real executing or completed backend operation and durable output.

### MVP without a research executor

Show:

- Website received — **Received**
- Preparation — **Queued**

Do not animate through fictional homepage, product, positioning, question, or first-impression completion.

### Owner actions

- Primary action when work remains queued: **Continue** to the preparation conversation/status explanation.
- Optional explicit action after a failure: **Try preparation again**.
- Optional edit action: **Edit business details**, returning to Screen 2 without creating a second onboarding record.

**Owner confirmation required:** Exact labels.

### Transition

- Queued/in-progress/failed states move to Screen 4 for explanation, status, or retry.
- A genuinely ready preparation package may move to Screen 5.

## 7. Screen 4 — Preparation Conversation

### Entry condition

Preparation is queued, executing, failed, retrying, or ready. This is not a second questionnaire.

### Purpose

Let Zeya explain what she is doing, what is preliminary, and what remains for the first working session.

### Queued dialogue

> “I have your website and the business priority you want me to begin with.”
>
> “My preparation is queued. I haven’t reviewed the material yet, so I won’t pretend that I have.”
>
> “When the review is ready, I’ll bring preliminary evidence, assumptions, and focused questions into our first working session.”

**Owner confirmation required:** Reconstructed wording. The explicit non-completion statement is required when queued.

### In-progress dialogue

> “I’m preparing now.”
>
> “I’m treating public information as evidence, not as settled truth. I’ll bring anything unclear or contradictory to you.”

**Owner confirmation required:** Reconstructed wording. Render only while real work is running.

### Failed dialogue

> “I wasn’t able to complete the preparation.”
>
> “Your business details are safe, and I haven’t filled the gaps with guesses. We can try again.”

**Owner confirmation required:** Reconstructed wording.

Actions:

- **Try again** — explicit, idempotent retry.
- **Review business details** — returns to Screen 2.
- Do not route to Formation unless an explicitly governed partial-readiness rule is approved and visible.

### Ready dialogue

> “I’ve prepared a first impression from the information available to me.”
>
> “I have separated what appears supported, what I’m assuming, and what I need to understand from you.”

**Owner confirmation required:** Reconstructed wording. Render only when the durable preparation package exists.

### Preparation summary

When ready, show a concise, reviewable structure rather than a polished diagnosis:

- What appears supported
- Preliminary impressions
- What is unclear or contradictory
- Questions for our first working session
- Sources unavailable or not reviewed

Every statement must expose its evidence/assumption status. This screen must not ask the owner to canonically approve the content.

### Transition

Only a ready preparation package—or a separately approved explicit partial-readiness state—may continue to Screen 5.

## 8. Screen 5 — Closing / First Working Session Readiness

### Entry condition

The durable preparation gate is satisfied and no Formation session has yet been initiated, or an idempotent handoff is being resumed.

### Purpose

Set expectations for Formation and allow one explicit handoff. The ending is a beginning, not a completion celebration.

### Required Zeya language

> “I’m ready for our first working session.”
>
> “I’ll arrive with preliminary evidence, assumptions to test, and a small number of questions. We’ll form the first responsible understanding of the business together.”
>
> “Nothing becomes canonical until you review and approve it.”
>
> “I’ll see you at our first working session.”

**Owner confirmation required:** These sentences reconstruct the approved intent. The final line preserves the approved ending concept and must remain closer to this posture than “Onboarding complete.”

### Owner action

Primary action: **Begin our first working session**

**Owner confirmation required:** Exact button label.

The action:

1. revalidates authenticated owner, Business, Representation, profile, and preparation readiness;
2. idempotently initiates or retrieves Formation with `direct_hire_onboarding` lineage;
3. stores the Formation link on the onboarding record;
4. routes to the exact Formation session.

It must not create a Representation Version or infer owner approval.

### Handoff pending

> “I’m preparing our first working session.”

**Owner confirmation required:** Exact sentence.

Disable duplicate activation while the request is pending, while retaining server-side idempotency.

### Handoff failure

> “I couldn’t open our working session yet. Your preparation is still here. Try again when you’re ready.”

**Owner confirmation required:** Exact sentence.

Retry from `preparation_ready`; do not restart the profile or preparation.

## 9. Complete transition table

| Current screen/state | Owner action or event | Next state/surface |
|---|---|---|
| First Meeting | Start | Basic Business Profile |
| First Meeting | Auth expires | Sign-in, then First Meeting |
| Profile | Invalid submit | Profile with values and field errors |
| Profile | Persistence fails | Profile with values and retry message |
| Profile | Valid durable submit | Preparation Begins |
| Preparation Begins | Continue while queued | Preparation Conversation — queued |
| Preparation Begins | Edit details | Profile, same durable record |
| Preparation Begins | Preparation becomes ready | Closing/readiness or ready conversation |
| Preparation Conversation — queued | Refresh/return | Same durable queued state |
| Preparation Conversation — in progress | Real completion | Ready state |
| Preparation Conversation — in progress | Real failure | Failed state |
| Preparation Conversation — failed | Try again | Retrying/queued |
| Preparation Conversation — failed | Review details | Profile, same record |
| Preparation Conversation — ready | Continue | Closing/readiness |
| Closing/readiness | Begin working session | Formation initiation pending |
| Handoff pending | Success | Exact Formation session |
| Handoff pending | Failure | Closing/readiness with retry |
| Any Direct Hire state | Existing Formation discovered | Exact Formation session |
| Any Direct Hire state | Canonical Representation discovered | Living Representation |

## 10. Refresh, re-entry, and resume

On every authenticated entry, load authoritative owner journey and Direct Hire state before choosing a screen.

- `first_meeting` resumes Screen 1.
- `profile_pending` resumes Screen 2 with durably saved values, if any.
- `profile_received` or `preparation_queued` resumes Screen 3 or queued Screen 4.
- `preparation_in_progress`, `failed`, or `retrying` resumes its exact Screen 4 state.
- `preparation_ready` resumes Screen 5.
- `formation_initiated` routes to the stored, revalidated Formation session.

React state may retain unsaved values during a recoverable same-page error. Unsaved values are not promised across sign-out or browser loss. No sensitive profile data belongs in generic browser storage.

## 11. Error behavior

Errors must be quiet, actionable, and truthful.

- Do not use “Something went wrong” when a safe specific class is known.
- Do not expose stack traces, SQL errors, provider bodies, record IDs, or credentials.
- Do not log owner name, website contents, phone, offer text, or authentication material.
- A retry must state what will be retried.
- A failed later step must not erase a completed earlier step.
- A timeout must not be interpreted as failure if the server operation may have succeeded; reload authoritative state first.
- Authentication failure returns through sign-in without losing durable progress.
- Tenant or lineage mismatch fails closed and does not offer adoption of the foreign record.

## 12. Accessibility requirements

- Use one visible `h1` describing the current surface.
- Every field has a persistent visible label; placeholders are examples or hints only.
- Associate instructions and errors programmatically.
- Move focus to the first invalid field after validation.
- Announce submission, retry, and preparation-status changes with appropriately restrained live regions.
- Maintain logical heading order and DOM reading order.
- All actions work with keyboard alone and have visible focus.
- Touch targets meet mobile accessibility expectations.
- Do not communicate status through color alone.
- Respect reduced-motion preferences; preparation must not depend on animation.
- Modal/panel use, if retained, must trap and restore focus correctly and close only through an intentional accessible action.
- Loading states must expose readable status and must not leave focus trapped on disabled controls.

## 13. Mobile behavior

- Use a single-column layout with comfortable horizontal padding.
- Keep the Zeya presence secondary to the current dialogue/form task.
- Do not force the form into a viewport-height panel that hides errors behind the keyboard.
- Use the appropriate input modes for URL and telephone fields.
- Keep labels, explanations, entered values, and errors visible without horizontal scrolling.
- Primary actions remain reachable in document flow; any sticky action must not cover fields or error text.
- Preparation items wrap naturally and retain text status labels.
- Preserve owner-entered values through orientation and responsive layout changes.

## 14. Completion criteria

Direct Hire onboarding is ready to hand off only when:

- the owner is authenticated;
- owner, Business, and Representation lineage is unambiguous and tenant-safe;
- exactly the five required fields are valid and durably stored;
- the selected business name is stored on the Business;
- preparation has an honest durable status;
- a reviewable preparation package exists, or a separately approved partial-readiness rule explicitly records unavailable sources;
- assumptions and public evidence remain non-canonical;
- no conflicting active Formation exists;
- no canonical Version has been created by Direct Hire or preparation.

The product must not label this “onboarding complete.” It is readiness for the first formal working session.

## 15. Formation boundary

Formation is the first formal working session. It uses the preparation package to test assumptions, surface contradictions, and build a proposed governed Representation with the owner.

Direct Hire must pass:

- authenticated owner identity;
- Business and Business Representation identity;
- Direct Hire onboarding lineage;
- selected product/service priority;
- sourced preparation evidence;
- explicit assumptions, gaps, and questions;
- preparation readiness outcome.

Formation does not automatically create canonical truth. Canonical Version creation remains behind a later, separate, authenticated owner approval.

The known P1 defect allowing generic `working_conversation_pending → working_conversation_linked` advancement without governed `/link-conversation` output remains outside this design and must not be used by Direct Hire.

## 16. Screen Lab specification

Provide local visual states for:

- First Meeting;
- empty profile;
- populated profile;
- field validation errors;
- profile persistence error;
- preparation received/queued;
- preparation in progress;
- preparation ready;
- preparation failed;
- preparation retrying;
- closing/readiness;
- Formation handoff pending;
- Formation handoff error.

Fixtures must be immutable, use `screenlab:` identifiers, avoid real UUIDs and real phone numbers, and invoke no persistence, RPC, provider, speech, polling, analytics, or real Experience storage. Disabled actions must resist pointer and keyboard activation.

## 17. Explicit exclusions

This experience does not include deep crawling, CRM, email, WhatsApp, prospect contact, operational missions, specialist orchestration, advanced analytics, autonomous canonical changes, or a timeline promise. It prepares Zeya and the owner for Formation.

## 18. Copy requiring owner confirmation

Before runtime implementation, the owner must confirm or replace every passage marked **Owner confirmation required**. Until then, the following are frozen without wording ambiguity:

- the first meeting preserves “I noticed we’ve never spoken before”;
- the experience uses the “Before my first day” concept;
- exactly five profile fields are collected;
- public information is preliminary evidence;
- assumptions and questions are explicit;
- Formation is the first formal working session;
- nothing becomes canonical before owner review and approval;
- the close feels like “I’ll see you at our first working session,” not “Onboarding complete.”
