BEGIN;

-- The original ledger admitted only contract transitions and keyed recovery by
-- destination contract. Generalize it narrowly for one audited v3 -> v3
-- application-defect requeue while preserving the historical v2 -> v3 rule.
DO $$
DECLARE
  v_reason_constraint text;
  v_transition_constraint text;
  v_unique_constraint text;
BEGIN
  SELECT constraint_row.conname INTO STRICT v_reason_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovery_reason_code%corrected_application_defect%';

  SELECT constraint_row.conname INTO STRICT v_transition_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovery_contract_version%exhausted_contract_version%';

  SELECT constraint_row.conname INTO STRICT v_unique_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
    AND constraint_row.contype = 'u'
    AND constraint_row.conkey = ARRAY[
      (SELECT attribute.attnum FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = constraint_row.conrelid
         AND attribute.attname = 'direct_hire_working_session_id'),
      (SELECT attribute.attnum FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = constraint_row.conrelid
         AND attribute.attname = 'recovery_contract_version')
    ]::smallint[];

  EXECUTE format(
    'ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries DROP CONSTRAINT %I',
    v_reason_constraint
  );
  EXECUTE format(
    'ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries DROP CONSTRAINT %I',
    v_transition_constraint
  );
  EXECUTE format(
    'ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries DROP CONSTRAINT %I',
    v_unique_constraint
  );
END;
$$;

ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries
  ADD CONSTRAINT direct_hire_first_working_session_recovery_reason_check
  CHECK (recovery_reason_code IN (
    'corrected_application_defect',
    'corrected_application_defect_requeue'
  )),
  ADD CONSTRAINT direct_hire_first_working_session_recovery_transition_check
  CHECK (
    (recovery_reason_code = 'corrected_application_defect'
      AND recovery_contract_version <> exhausted_contract_version)
    OR
    (recovery_reason_code = 'corrected_application_defect_requeue'
      AND exhausted_contract_version = 'first-working-session-preparation-v3'
      AND recovery_contract_version = exhausted_contract_version)
  ),
  ADD CONSTRAINT direct_hire_first_working_session_recovery_event_key
  UNIQUE (
    direct_hire_working_session_id,
    exhausted_contract_version,
    recovery_contract_version,
    recovery_reason_code
  );

CREATE FUNCTION public.zeya_requeue_first_working_session_preparation_v3(
  p_working_session_id uuid,
  p_expected_failure_code text,
  p_requeue_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_jwt_role text := auth.role();
  v_database_role text := session_user::text;
  v_requeue_actor text;
BEGIN
  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND v_database_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'requeue authorization required';
  END IF;
  v_requeue_actor := CASE
    WHEN v_jwt_role = 'service_role' THEN 'service_role'
    ELSE v_database_role
  END;

  IF p_working_session_id IS NULL
     OR p_expected_failure_code IS NULL OR btrim(p_expected_failure_code) = ''
     OR p_requeue_reason_code <> 'corrected_application_defect_requeue' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation requeue';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = p_working_session_id
  FOR UPDATE;

  -- A serialized replay of this exact audited event succeeds without granting
  -- another budget or changing a subsequently pending/running/ready row.
  IF EXISTS (
    SELECT 1
    FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
    WHERE recovery.direct_hire_working_session_id = p_working_session_id
      AND recovery.exhausted_contract_version = 'first-working-session-preparation-v3'
      AND recovery.recovery_contract_version = 'first-working-session-preparation-v3'
      AND recovery.recovery_reason_code = p_requeue_reason_code
      AND recovery.previous_failure_code = p_expected_failure_code
  ) THEN
    RETURN true;
  END IF;

  IF v_session.id IS NULL
     OR v_session.status <> 'scheduled'
     OR v_session.preparation_status <> 'failed'
     OR v_session.preparation_attempt_count <> 3
     OR v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v3'
     OR v_session.preparation_failure_code IS DISTINCT FROM p_expected_failure_code
     OR v_session.preparation_lease_id IS NOT NULL
     OR v_session.preparation_lease_expires_at IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.direct_hire_onboarding_sessions AS onboarding
       WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
         AND onboarding.owner_id = v_session.owner_id
         AND onboarding.business_id = v_session.business_id
         AND onboarding.business_representation_id = v_session.business_representation_id
         AND onboarding.onboarding_state = 'employment_accepted'
         AND onboarding.induction_state = 'preparation_pending'
         AND EXISTS (
           SELECT 1
           FROM public.business_representations AS representation
           WHERE representation.id = v_session.business_representation_id
             AND representation.business_id = v_session.business_id
             AND representation.user_id = v_session.owner_id
             AND representation.current_version_id IS NULL
         )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'exhausted v3 preparation is not requeueable';
  END IF;

  INSERT INTO public.direct_hire_first_working_session_preparation_recoveries (
    direct_hire_working_session_id, owner_id, business_id,
    business_representation_id, direct_hire_onboarding_session_id,
    exhausted_contract_version, recovery_contract_version,
    recovery_reason_code, previous_attempt_count, previous_failure_code,
    recovered_by_role
  ) VALUES (
    v_session.id, v_session.owner_id, v_session.business_id,
    v_session.business_representation_id, v_session.direct_hire_onboarding_session_id,
    'first-working-session-preparation-v3', 'first-working-session-preparation-v3',
    p_requeue_reason_code, v_session.preparation_attempt_count,
    v_session.preparation_failure_code, v_requeue_actor
  );

  UPDATE public.direct_hire_working_sessions AS working_session
  SET preparation_status = 'pending',
      preparation_started_at = NULL,
      preparation_completed_at = NULL,
      preparation_failure_code = NULL,
      preparation_lease_id = NULL,
      preparation_lease_expires_at = NULL,
      preparation_attempt_count = 0,
      preparation_snapshot_fingerprint = NULL,
      preparation_contract_version = 'first-working-session-preparation-v3'
  WHERE working_session.id = v_session.id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.zeya_requeue_first_working_session_preparation_v3(uuid,text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_requeue_first_working_session_preparation_v3(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_requeue_first_working_session_preparation_v3(uuid,text,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
