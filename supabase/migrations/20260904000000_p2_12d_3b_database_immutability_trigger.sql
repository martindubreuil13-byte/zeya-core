-- P2.12D.3B: Database-level immutability for Formation prepared-context
-- BEFORE UPDATE/DELETE trigger ensures immutability regardless of RLS bypass
-- Blocks all mutations at database level, not just RLS policy level

BEGIN;

-- BEFORE UPDATE trigger: always raise exception
CREATE FUNCTION public.zeya_prevent_formation_prepared_context_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'formation_prepared_context_immutable: direct UPDATE not permitted';
END; $$;

CREATE TRIGGER formation_prepared_context_prevent_update
BEFORE UPDATE ON public.direct_hire_formation_prepared_context
FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_formation_prepared_context_update();

-- BEFORE DELETE trigger: always raise exception
CREATE FUNCTION public.zeya_prevent_formation_prepared_context_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'formation_prepared_context_immutable: direct DELETE not permitted';
END; $$;

CREATE TRIGGER formation_prepared_context_prevent_delete
BEFORE DELETE ON public.direct_hire_formation_prepared_context
FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_formation_prepared_context_delete();

NOTIFY pgrst, 'reload schema';
COMMIT;
