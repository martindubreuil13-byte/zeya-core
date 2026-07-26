# Representation Formation RF-A

RF-A is owner-scoped lifecycle orchestration inside the Representation domain. It prepares a hired Zeya representation for its first governed working conversation. It does not create or modify canonical Representation knowledge.

## Lifecycle

The only RF-A states are:

```text
initiated
  → getting_familiar
  → working_conversation_pending
  → working_conversation_linked
```

`working_conversation_linked` is the RF-A terminal boundary. There is no `formation_complete` state and no completion endpoint.

## API and service flow

An authenticated owner initiates Formation with:

```text
POST /api/formation/sessions/initiate
```

The route derives the owner from the authenticated context, verifies `businesses.user_id`, resolves the owner’s existing `business_representations` row, and invokes the service-role-only `zeya_initiate_formation_session` RPC. Repeated initiation for the same Representation returns the same session.

An owner retrieves the safe lifecycle view with:

```text
GET /api/formation/sessions/:sessionId
```

RLS hides sessions owned by another tenant. Authenticated users have read access only; lifecycle writes are restricted to internal service-role RPCs.

Internal orchestration advances only:

```text
initiated → getting_familiar
getting_familiar → working_conversation_pending
```

`zeya_advance_formation_status` rejects skipped, backward, repeated, and terminal transitions. Conversation linkage is a separate operation:

```text
POST /api/formation/sessions/:sessionId/link-conversation
```

The linked object must be a governed `voice_conversation_outputs` row belonging to the same Business Representation. Exact replay with the same output is idempotent. A different output cannot replace an existing link.

## Security boundary

Formation RPCs are `SECURITY DEFINER`, use an empty `search_path`, schema-qualify privileged objects, reject non-service-role execution, and revoke execution from `PUBLIC`, `anon`, and `authenticated`.

The initiation RPC independently verifies that:

- the Business exists and `businesses.user_id` is the supplied owner;
- the Representation belongs to that Business;
- the Representation’s `user_id` is the same owner.

The application never accepts an owner ID from the request body.

## Governance boundary

Formation creates only `representation_formation_sessions` rows and later stores an explicit reference to the first governed voice output. Formation does not automatically create or mutate:

- Evidence or Observations;
- Proposals or proposal relations;
- Approval Decisions;
- Confidence Assessments;
- Representation Elements or Versions;
- the active canonical Version pointer;
- canonical audit events.

Voice lineage, conversation output, and canonical fixtures used by integration tests are explicit prerequisites created through their existing governed APIs and RPCs; they are not Formation side effects.

## Controlled purge

`zeya_purge_business_representation` deletes the Formation session before deleting its Representation. The reconciled purge inventory preserves all voice lineage/output, candidate review/promotion/canonicalization, immutable governance, and canonical deletion paths present in the latest pre-RF-A controlled-purge definition. Deletion counts remain explicit in the RPC result, and the purge remains service-role-only.

## Verification

Run the RF-A lifecycle suite with:

```bash
npm run test:representation-formation-sessions
```

The suite uses two isolated tenants and a dynamic local application port. It verifies initiation idempotency, RLS isolation, direct-write denial, ordered transitions, invalid transition rejection, governed voice-output linkage, replay behavior, terminal state, governance separation, controlled purge, cross-tenant survival, and server cleanup.

Representation infrastructure cleanup is verified with:

```bash
npm run test:representation-state
```

## Explicitly deferred

RF-A contains no readiness model, operational authority, channel activation, automatic canonicalization, Formation-specific canonical audit event, or RF-B preparation intelligence. RF-B may consume the frozen `working_conversation_linked` boundary; it must not silently redefine RF-A contracts.
