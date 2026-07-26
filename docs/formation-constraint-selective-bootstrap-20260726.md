# Formation constraint selective production bootstrap — 2026-07-26

## Decision and scope

The manual bootstrap is
`supabase/manual/20260726_formation_constraint_bootstrap.sql`. It changes only
the name of the existing unique constraint on
`public.representation_formation_sessions(business_representation_id)`.
It does not change application data, columns, functions, privileges, RLS,
triggers, or migration history.

Production was inspected read-only. It has zero duplicate
`business_representation_id` groups and exactly one matching constraint:

- constraint:
  `representation_formation_session_business_representation_id_key`
- backing index:
  `representation_formation_session_business_representation_id_key`
- definition: `UNIQUE (business_representation_id)`
- index state: unique, valid, ready, non-partial, non-expression

PostgreSQL `ALTER TABLE ... RENAME CONSTRAINT` renames the constraint and its
owned backing index as a catalog operation. It never drops the constraint or
opens an unprotected interval. This is safer than building a second index or
changing the RF-A RPC to depend on a different conflict mechanism.

## Statement-by-statement safety

1. `BEGIN` makes the checks and rename atomic.
2. `LOCK ... IN SHARE ROW EXCLUSIVE MODE` prevents concurrent Formation
   inserts/updates during the duplicate and catalog checks. Reads continue.
3. The duplicate query raises SQLSTATE `23505` before DDL if any representation
   has more than one session.
4. The attribute lookup proves the target column exists.
5. If the target name already exists, its constraint and index structure must
   be exactly the required single-column, valid, ready, ordinary uniqueness
   contract. Otherwise execution stops with SQLSTATE `55000`.
6. If the target name is absent, the catalog query requires exactly one
   structurally matching unique constraint. Zero or multiple matches stop the
   transaction.
7. Dynamic SQL quotes the discovered source identifier with `%I`; the target is
   a fixed reviewed identifier.
8. `RENAME CONSTRAINT` retains the same constraint OID semantics and continuous
   protection while PostgreSQL renames its owned index.
9. `COMMIT` publishes only the catalog rename. Any error rolls back the lock and
   all catalog changes.

The file contains no `DROP`, DML, migration-history access, or unrelated table
reference.

## Required read-only preflight

Run the two commented pre-execution queries in the SQL file. Stop unless:

- duplicate query returns zero rows;
- exactly one unique constraint is returned;
- its definition is exactly `UNIQUE (business_representation_id)`;
- its backing index is unique, valid, ready, non-partial and non-expression;
- no constraint already occupies `formation_session_representation_uniq` with
  a different definition.

Also confirm there is no long-running transaction writing Formation rows.

## Production-shaped preview result

The recovered preview `hdjojgvvlojbhgidirht` was shaped by renaming only its
Formation constraint from the target name to the exact production source name.
No constraint was dropped.

Results:

- shaped-preview duplicate groups: `0`;
- first bootstrap attempt: safely rolled back after exposing an `int2vector`
  comparison defect in the detector;
- detector corrected to compare the sole key attribute directly;
- exact bootstrap file execution: pass;
- postcondition: constraint and backing index both named
  `formation_session_representation_uniq`;
- definition: `UNIQUE (business_representation_id)`;
- index: unique, valid, ready, non-partial, non-expression;
- second exact bootstrap execution: pass/no-op;
- exact `20260726000000_rfa_controlled_purge_reconciliation.sql` execution
  afterward: pass.

This proves the bootstrap removes the named-constraint failure and that the
pending RF-A migration compiles and commits against the normalized structure.
It does not claim that production migration history is already coherent.

## Dry-run boundary

A real post-bootstrap production dry-run cannot be captured without first
executing the bootstrap in production, which is deliberately forbidden at this
review stage. The production-shaped preview execution of the exact pending
migration is the executable proof for the immediate constraint blocker.

The thirteen missing history rows remain a separate ordering blocker. A normal
production dry-run must not be used until the final-state corrections below are
applied selectively and each historical version is reconciled individually.
At that point the expected normal dry-run sequence is:

1. `20260726000000_rfa_controlled_purge_reconciliation.sql`
2. `20260726100000_proposal_link_tenant_integrity.sql`
3. `20260726110000_immutable_table_privilege_reconciliation.sql`

No `--include-all` is permitted.

## Thirteen-version reconciliation plan — do not execute

| Version | Current decision | Evidence required before individual repair |
|---|---|---|
| `20260528000000` | superseded; not safe now | full baseline table/column/FK/index/RLS/grant equivalence after later final-state contracts |
| `20260719110000` | separate correction required | approval/confidence columns, backfills, FKs, defaults and nullability |
| `20260721000000` | superseded | final `20260723180000` completion guard and grants proven |
| `20260723120000` | separate correction required | Public Experience test table, trigger, RLS and service-only ACL |
| `20260723130000` | separate correction required | evidence hash function, empty search path, trigger and postgres-only ACL |
| `20260723140000` | separate correction required | proposal expiry plus both array columns/defaults |
| `20260723150000` | superseded | relation tables/constraints plus final `20260726100000` tenant isolation |
| `20260723160000` | not safe now | exact final owner-update policy and privilege behavior |
| `20260723170000` | separate correction required | hash backfill, validated non-null contract, trigger/function and ACL |
| `20260723180000` | separate correction required | both PZ410 triggers, final RPC bodies/signatures/search paths and ACL |
| `20260726000000` | apply normally after bootstrap/history coherence | RF-A structural and behavioral verification |
| `20260726100000` | apply normally | cross-representation negative probes and policy catalog verification |
| `20260726110000` | apply normally | Version/Audit mutation denial and read grants |

No version is safe to mark applied today. Once a row is proven equivalent, the
only allowed CLI form is one command per reviewed version:

```sh
supabase migration repair VERSION --status applied --linked
```

Never combine versions, never use `--include-all`, and capture the before/after
history list for every command.

## Remaining selective corrective sequence

These are separate reviewed migrations, not part of this bootstrap:

1. Approval/Confidence final parity and safe backfills.
2. Public Experience test-record table, trigger, RLS and ACL.
3. Evidence statement-hash final trigger contract.
4. Proposal expiry/array defaults and final relation isolation.
5. Representation Version `content_hash` backfill, validated non-null
   enforcement, trigger and immutable privileges.
6. Public Experience derived-artifact `PZ410` triggers plus final RPC grants.
7. Formation direct-write revocation, `formation_completed_at` handling,
   hardened RPCs and empty-search-path final controlled purge.
8. Audit mutation privilege reconciliation.

Dependencies require the Formation constraint bootstrap before item 7 and
before normal execution of `20260726000000`.

## Exact manual production procedure — not executed

1. Freeze governed Formation writes and confirm the writer pause.
2. Confirm PITR health and capture schema, history, constraint, duplicate and
   active-lock evidence.
3. Run the SQL file's preflight queries read-only.
4. Stop if any condition below is met.
5. Execute exactly:

   ```sh
   supabase db query --linked \
     --file supabase/manual/20260726_formation_constraint_bootstrap.sql
   ```

6. Run the SQL file's post-execution query.
7. Re-run the duplicate query and inspect active locks/errors.
8. Do not run a normal push. Continue only through the separately approved
   selective corrective and per-version reconciliation runbook.

## Stop conditions and recovery

Stop before execution for duplicates, zero/multiple structural constraints,
unexpected target-name occupation, invalid/not-ready/partial/expression index,
unconfirmed production linkage, active Formation writers, unavailable PITR, or
uncaptured preflight evidence.

During execution, SQLSTATE `23505`, `42703`, `55000`, lock timeout, statement
timeout, or any unexpected error causes transaction rollback; investigate and
do not retry blindly.

After commit, do not rename back once `20260726000000` has been applied because
its RPC depends on the target name. If the bootstrap alone has committed and
the pending migration has not run, the reversible recovery is a separately
reviewed transaction that verifies the same structure and renames the
constraint back. Renaming back is not a data restore and must never be used as
migration rollback.
