BEGIN;

-- Canonical Versions are created only by governed server-side workflows.
REVOKE INSERT, UPDATE, DELETE
ON TABLE public.representation_versions
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.representation_versions TO authenticated;

-- Audit history remains owner-readable and append-only. Explicit privilege
-- denial makes mutation attempts fail rather than silently matching zero rows.
REVOKE UPDATE, DELETE
ON TABLE public.audit_events
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_events TO authenticated;

COMMIT;
