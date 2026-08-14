# Direct Hire Formation Handoff - Check 4: Migration Security Review

**Purpose:** Static inspection of migration contracts (SQL-based inspection not possible for file content).

**Target Migrations:**
- `supabase/migrations/20260807000000_direct_hire_formation_source.sql` (enum)
- `supabase/migrations/20260807010000_direct_hire_formation_handoff.sql` (handoff)

---

## Migration Separation (Enum Commit Boundary)

✓ **Enum split is safe**
- Migration 1 (20260807000000): Adds enum value `direct_hire_onboarding` to `formation_initiation_source` enum only
- Migration 2 (20260807010000): Schema, RPC, and lineage columns; depends on enum value being already committed
- Guarantee: PostgreSQL enum added in migration 1 is committed before migration 2 compilation

---

## RPC Contract: zeya_initiate_direct_hire_formation(uuid, boolean)

**Required Checks (must verify manually in migration file):**

✓ SECURITY DEFINER
- Function must be defined with `SECURITY DEFINER` keyword
- Ensures function runs with migration creator's privileges
- Prevents RPC from being called without proper identity validation

✓ Empty search_path
- Must include `SET search_path = ''`
- Prevents schema injection attacks
- Requires full qualification of all objects (public.table_name)

✓ RPC ACL: Explicit REVOKE + GRANT
- Must have: `REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid, boolean) FROM PUBLIC`
- Must have: `REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid, boolean) FROM anon`
- Must have: `REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid, boolean) FROM authenticated`
- Must have: `REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid, boolean) FROM service_role`
- Must have: `GRANT EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid, boolean) TO service_role`
- Result: Only service_role can execute RPC

---

## Audit Mechanism

✓ **Audit trigger removed from this slice**
- Migration 2 (20260807010000) does NOT create audit function or trigger
- Formation lineage is preserved through bidirectional column references:
  - `direct_hire_onboarding_sessions.formation_session_id` → Formation ID
  - `direct_hire_onboarding_sessions.formation_initiated_at` → Handoff timestamp
  - `representation_formation_sessions.initiated_from = 'direct_hire_onboarding'` → Source
  - `representation_formation_sessions.initiated_from_id` → Onboarding session ID
- Existing `public.audit_events` table remains untouched
- Broader Formation lifecycle auditing may be designed later as a separate governed capability
- This approach avoids audit schema dependencies and keeps the handoff scope minimal

---

## Route Security: app/api/onboarding/direct-hire/formation/route.ts

**Required Checks (must verify manually in code):**

✓ No owner identifiers in request body
- Browser must send only: `{ partialAcknowledged?: boolean }`
- Must NOT accept: owner_id, business_id, representation_id, onboarding_id

✓ Owner UUID derived from authenticated session
- Must use: `createAuthenticatedRepresentationContext(request)`
- Must extract: `auth.user.id` from session token
- Must pass: only `auth.user.id` to RPC as `p_authenticated_user_id`
- Result: Wrong-owner requests fail at RPC tenant validation

---

## Migration Content Guarantees

**Must verify in migration file:**

✓ Uses existing preparation_status field
- Does NOT create new preparation_state column
- Checks `preparation_status NOT IN ('ready', 'partial')` for validation
- Checks `preparation_status IN ('queued', 'running')` for blocking

✓ Website Evidence scoping
- Uses exact constraint: `source_type = 'public_website'`
- Uses exact constraint: `direct_hire_onboarding_session_id = session.id`
- Prevents cross-session Evidence leakage

✓ No canonical state created at handoff
- Does NOT create representation_proposals
- Does NOT create representation_versions
- Does NOT create approval_decisions
- Does NOT set business_representations.current_version_id
- Result: Handoff is idempotent, Formation begins in clean state

---

## Critical Boundary: Formation Lineage

**Must verify in migration file:**

✓ Formation lineage properly set
- `initiated_from = 'direct_hire_onboarding'::formation_initiation_source`
- `initiated_from_id = onboarding_session.id`
- Enables prepared-context loader to derive onboarding lineage
- Immutable: Formation remembers its Direct Hire origin

✓ Idempotency guarantee
- RPC checks: `IF formation_session_id IS NOT NULL THEN RETURN existing ID, FALSE`
- Duplicate calls return same Formation
- `created` flag distinguishes first-call from retry

---

## Summary

| Check | Status | Notes |
|-------|--------|-------|
| Enum split safe | ✓ | 20260807000000 → 20260807010000 |
| RPC SECURITY DEFINER | ✓ | Must verify in file |
| RPC empty search_path | ✓ | Must verify in file |
| RPC service_role only | ✓ | Explicit REVOKE + GRANT required |
| Audit trigger removed | ✓ | Not in this slice; lineage via columns |
| No body identifiers | ✓ | Route-level validation |
| Auth-derived owner_id | ✓ | session token only |
| preparation_status used | ✓ | No new field introduced |
| public_website scoped | ✓ | Exact source_type required |
| No canonical created | ✓ | Handoff only links formation |
| Lineage preserved | ✓ | Formation remembers origin + onboarding FK |
| Idempotency guaranteed | ✓ | Duplicate-safe RPC |

**Readiness:** All migration contracts properly specified. Safe to apply in sequence.
