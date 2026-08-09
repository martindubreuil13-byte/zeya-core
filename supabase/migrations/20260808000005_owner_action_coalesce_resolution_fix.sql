BEGIN;

-- PostgreSQL resolves COALESCE as SQL syntax, not as a function in pg_catalog.
-- Patch only the deployed owner-action definition so its identity, locking,
-- SECURITY DEFINER setting, empty search_path, and transaction remain unchanged.
DO $$
DECLARE
  v_identity REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.zeya_apply_hypothesis_owner_action(uuid,uuid,public.approval_decision_type,uuid,text)'
  );
  v_definition TEXT;
  v_broken_expression CONSTANT TEXT :=
    'pg_catalog.coalesce(pg_catalog.max(hv.verification_sequence), 0) + 1';
  v_corrected_expression CONSTANT TEXT :=
    'COALESCE(pg_catalog.max(hv.verification_sequence), 0::BIGINT) + 1';
BEGIN
  IF v_identity IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42883',
      MESSAGE = 'required owner-action function does not exist';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_identity)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_broken_expression) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'owner-action function does not contain the expected COALESCE defect';
  END IF;

  IF pg_catalog.strpos(
    pg_catalog.replace(v_definition, v_broken_expression, ''),
    v_broken_expression
  ) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'owner-action function contains multiple COALESCE defects';
  END IF;

  EXECUTE pg_catalog.replace(
    v_definition,
    v_broken_expression,
    v_corrected_expression
  );
END;
$$;

ALTER FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
