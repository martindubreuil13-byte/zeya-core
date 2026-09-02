BEGIN;

-- P2.12D.2c: the original PostgreSQL-generated, truncated constraint name
-- survived the v5/v6 successor migrations. Its v4-only predicate would reject
-- an otherwise valid successor handoff. Drop only that obsolete predicate;
-- the explicit v4/v5/v6 constraint remains authoritative.
ALTER TABLE public.direct_hire_first_working_session_formation_handoffs
  DROP CONSTRAINT IF EXISTS direct_hire_first_working_se_preparation_contract_version_check;

COMMIT;
