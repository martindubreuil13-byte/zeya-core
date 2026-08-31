BEGIN;

-- P2.12D.1a — Preparation Contract Versioning Repair
--
-- Root Cause:
-- P2.12D.1 introduced materially new preparation behavior:
-- - Bounded intelligent sitemap discovery (40 URLs max)
-- - Common-path probing (24 deterministic paths)
-- - Richer page prioritization (category-first ranking)
-- - Broader website evidence acquisition
--
-- But the code still declared first-working-session-preparation-v4.
--
-- Result: The RPC zeya_claim_first_working_session_preparation() refused to
-- re-prepare a ready v4 session with "v4" code because its version-mismatch
-- trigger only fires when versions differ.
--
-- Fix: Introduce v5 as the successor contract identifier that represents
-- this materially changed preparation semantics.
--
-- Governance:
-- - Historical v4 artifacts remain unchanged and immutable
-- - v5 briefs are created as successors to v4, preserving append/version semantics
-- - RPC's version-mismatch trigger now fires: stored=v4, current=v5, differ=true

-- Update formation handoff table CHECK constraint to allow both v4 and v5.
-- This table is immutable audit/snapshot; new handoffs with v5 are legitimate.
ALTER TABLE public.direct_hire_first_working_session_formation_handoffs
DROP CONSTRAINT IF EXISTS direct_hire_first_working_session_formation_handoffs_preparation_contract_version_check;

ALTER TABLE public.direct_hire_first_working_session_formation_handoffs
ADD CONSTRAINT direct_hire_first_working_session_formation_handoffs_preparation_contract_version_check
CHECK (preparation_contract_version IN ('first-working-session-preparation-v4', 'first-working-session-preparation-v5'));

NOTIFY pgrst, 'reload schema';
COMMIT;
