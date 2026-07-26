# Migration history reconciliation and preview recovery — 2026-07-26

## Environment boundary

- Default/production: `eqdhftogzzlkpjebgbue` — inspected read-only and not modified.
- Preview: `hdjojgvvlojbhgidirht` — persistent, `with_data=false`, associated with
  `full-cycle-backend-integration`.
- Final preview application alias:
  `https://zeya-core-wh6u-git-full-3deb71-martindubreuil13-bytes-projects.vercel.app`.
- Final verified source commit at the time of the preview recovery:
  `51ac678` plus the earlier RF-A/bootstrap fixes in this branch.

## Preview failure and recovery

The first clean reset reproduced the exact migration failure:

- first failing version: `20260721100000`
- SQLSTATE: `42P07`
- failing statement: `CREATE TABLE public.public_experience_representation_briefs`
- cause: `20260721000000_fix_reflection_ready_guard.sql` had already created a
  preliminary, incompatible version of the table and persistence RPC.

Using `IF NOT EXISTS` would have retained the weaker definition. The obsolete
table/RPC block was removed from `20260721000000`; the canonical
`20260721100000` migration now owns those objects exclusively. This historical
correction is limited to a version absent from production history whose only
recorded target was the disposable preview.

The preview was reset without seed data and the complete chain then applied
from `20260528000000` through `20260726110000`. The normalized migration list
contains 50 matching local/remote versions with no database-history gap.

Supabase's branch database is `ACTIVE_HEALTHY`. Its orchestration status remains
stuck at `MIGRATIONS_FAILED`; two explicit status transitions were accepted by
the CLI but the management API continued returning the stale failure value.
This is metadata drift, not database migration drift: the full reset, migration
list, structural queries, and deployed behavior all pass.

## Ten-version equivalence matrix

`version_hash` in the mission brief refers to the repository's canonical
`representation_versions.content_hash` contract. No migration defines a
physical `version_hash` column.

| Version | Intended material contract | Production state | Preview state | Production classification | Preview classification |
|---|---|---|---|---|---|
| `20260528000000` | Baseline businesses/call outcomes/memory tables, indexes, grants and owner RLS | Objects exist but have later/manual column, ACL and RLS differences | Rebuilt from the exact migration, then later migrations applied | `SUPERSEDED` | `FULLY EQUIVALENT` |
| `20260719110000` | Approval representation/approver FKs; Confidence representation, band, factors, affected elements and review flag; backfills/not-null | Approval and some Confidence fields exist; `affected_element_ids` and `review_required` are absent | All fields, FKs, defaults and nullability verified | `PARTIALLY PRESENT` | `FULLY EQUIVALENT` |
| `20260721000000` | Reflection-ready completion guard | Completion RPC exists but is replaced by the expiration migration and differs in grants/body | Guard applied, then deliberately superseded by `20260723180000` | `SUPERSEDED` | `SUPERSEDED` |
| `20260723120000` | Service-only Public Experience test records, trigger, grants and RLS | Table/trigger absent | Table, trigger, RLS and service-only surface verified behaviorally | `ABSENT` | `FULLY EQUIVALENT` |
| `20260723130000` | Evidence statement-hash trigger/function with empty search path and postgres-only execution | `statement_hash` exists, but the repository trigger/function contract is absent | Column, trigger, function and behavior pass | `PARTIALLY PRESENT` | `FULLY EQUIVALENT` |
| `20260723140000` | Proposal expiry and array defaults | `expires_at` exists; required array columns/defaults are absent | Columns/defaults present | `PARTIALLY PRESENT` | `FULLY EQUIVALENT` |
| `20260723150000` | Proposal relation tables, constraints, grants and tenant RLS | Tables exist, but current behavior is stronger/different than this historical policy body | Base objects applied; final tenant policy is superseded by `20260726100000` | `SUPERSEDED` | `SUPERSEDED` |
| `20260723160000` | Owner UPDATE policy/grant for proposals | Owner update behavior is present; exact historical provenance cannot be proven independently of drift | Policy/grant applied | `UNSAFE TO CLASSIFY` | `FULLY EQUIVALENT` |
| `20260723170000` | `content_hash` generation trigger/function with empty search path and postgres-only execution | Nullable `content_hash` exists; repository trigger/function is absent | Non-null hash contract, trigger and generated behavior present | `PARTIALLY PRESENT` | `FULLY EQUIVALENT` |
| `20260723180000` | `PZ410` expiration enforcement, two artifact triggers, final completion/persistence RPCs and grants | Some functions/columns exist; derived-artifact function/triggers and required `PZ410` behavior are absent | Structure, grants, triggers and deployed expiration behavior pass | `PARTIALLY PRESENT` | `FULLY EQUIVALENT` |

No production history row currently meets the strict evidence threshold for an
immediate repair. Table existence alone is not sufficient.

## Additional clean-chain corrections

- `20260724000000`: assigns the Formation uniqueness constraint an explicit
  short name to avoid PostgreSQL's 63-byte identifier truncation.
- `20260726000000`: preserves initiation replay semantics and qualifies
  PL/pgSQL output-column names in initiation/link lookups.
- `20260726100000`: requires proposal and linked evidence/observation/element
  rows to share the same representation and owner.
- `20260726110000`: revokes authenticated direct canonical Version creation and
  explicitly denies Audit UPDATE/DELETE.

## Production reconciliation plan — not executed

1. **Release boundary**
   - Freeze production schema writes from dashboards/automation.
   - Confirm PITR health and take a logical schema/history snapshot.
   - Record counts and null rates for every column to be added or constrained.

2. **Read-only preflight**
   - Re-run the exact catalog matrix for columns, types, defaults, constraints,
     indexes, functions and identity arguments, function bodies/search paths,
     grants, RLS policies, triggers and behavior.
   - Pin verification hashes for the current controlled purge and all replaced
     Public Experience RPCs.

3. **Create reviewed append-only production reconciliation migrations**
   - Confidence/approval parity and safe backfills.
   - Public Experience test-record table/trigger and service-only grants.
   - Evidence hash trigger.
   - Proposal parity columns/defaults.
   - Final proposal-link tenant policies.
   - Canonical Version `content_hash` backfill, not-null validation and trigger.
   - Final `PZ410` functions/triggers/grants.
   - Immutable Version/Audit privilege normalization.
   Each migration must have its own static and deployed verification.

4. **History repair only after equivalence**
   - Apply the corrective final-state migrations in dependency order.
   - Re-run every structural and behavioral check.
   - Only then mark each of the ten historical versions applied individually,
     in chronological order, with captured evidence. Do not bulk repair and do
     not use `--include-all`.

5. **Apply RF-A normally**
   - Dry-run must show only `20260724000000`, `20260726000000`,
     `20260726100000`, and `20260726110000` as applicable after history is
     coherent.
   - Apply in timestamp order. Never replay an old migration into an
     incompatible object.

6. **Locks and availability**
   - Function/policy/trigger replacement takes short catalog locks.
   - `ALTER TABLE ADD COLUMN` briefly takes `ACCESS EXCLUSIVE`.
   - Hash backfill takes row locks and may generate substantial WAL.
   - `SET NOT NULL` requires a table scan unless introduced via a validated
     check constraint. Use batched backfill, `NOT VALID`, `VALIDATE
     CONSTRAINT`, then the final nullability change.
   - No planned downtime is required for small tables, but pause governed
     representation writes during the final constraint/function cutover.

7. **Recovery**
   - Every step runs in a transaction where PostgreSQL permits it.
   - On pre-commit failure: rollback.
   - On post-commit behavioral failure: stop, disable affected application
     writes, restore prior function/policy definitions through a new forward
     migration, and use PITR only for demonstrated data corruption.
   - Migration-history repair is never used as rollback.

8. **Verification after each step**
   - Catalog definition/signature/search-path/grant/RLS/trigger checks.
   - Row-count/null/hash backfill checks.
   - Tenant-crossing negative probes.
   - `PZ410`, content-hash generation, immutability and controlled-purge probes.
   - Issue `NOTIFY pgrst, 'reload schema'` after final DDL and verify RPC
     discovery through PostgREST.

9. **Production regression order**
   - Representation infrastructure and A–E.
   - RF-A twice.
   - Voice lineage/representation/conversation/review.
   - Canonicalization and rollback.
   - Public Experience foundation/completion/governed learning.
   - Voice live learning.
   - Read-only production smoke sequence only after all deployed tests pass.

## Separate advisory

The clean chain leaves `public.call_outcomes` with RLS disabled, matching the
baseline migration. Supabase reports this as critical because the table retains
anon/authenticated privileges. This was not changed automatically because
enabling RLS without an access policy can break callers. A separate reviewed
security decision is required; the minimal mechanical statement would be:

```sql
ALTER TABLE public.call_outcomes ENABLE ROW LEVEL SECURITY;
```

Required owner/service policies and privilege revocations must be designed
before that statement is deployed.
