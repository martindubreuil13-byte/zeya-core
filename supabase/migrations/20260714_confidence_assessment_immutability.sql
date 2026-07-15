-- Confidence Assessments are immutable historical calculations.
-- Controlled service-role fixture purge remains available through its
-- transaction-local bypass and does not weaken ordinary authenticated access.

BEGIN;

DROP POLICY IF EXISTS "users_can_update_own_confidence"
  ON public.confidence_assessments;
DROP POLICY IF EXISTS "users_can_delete_own_confidence"
  ON public.confidence_assessments;

CREATE OR REPLACE FUNCTION public.confidence_assessments_prevent_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Confidence assessments are immutable. Cannot % assessment %.',
    TG_OP,
    OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS confidence_assessments_prevent_modification_trigger
  ON public.confidence_assessments;

CREATE TRIGGER confidence_assessments_prevent_modification_trigger
  BEFORE UPDATE OR DELETE ON public.confidence_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.confidence_assessments_prevent_modification();

REVOKE ALL ON FUNCTION public.confidence_assessments_prevent_modification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confidence_assessments_prevent_modification() FROM anon;
REVOKE ALL ON FUNCTION public.confidence_assessments_prevent_modification() FROM authenticated;
REVOKE ALL ON FUNCTION public.confidence_assessments_prevent_modification() FROM service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
