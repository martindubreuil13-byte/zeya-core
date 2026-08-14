BEGIN;

ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries
  DROP CONSTRAINT direct_hire_first_working_session_prepa_recovered_by_role_check;

ALTER TABLE public.direct_hire_first_working_session_preparation_recoveries
  ADD CONSTRAINT direct_hire_first_working_session_recovery_actor_check
  CHECK (recovered_by_role IN ('service_role', 'postgres'));

CREATE OR REPLACE FUNCTION public.zeya_recover_first_working_session_preparation(
  p_working_session_id uuid,
  p_exhausted_contract_version text,
  p_recovery_contract_version text,
  p_recovery_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_jwt_role text := auth.role();
  v_database_role text := session_user::text;
  v_recovery_actor text;
BEGIN
  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND v_database_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'recovery authorization required';
  END IF;
  v_recovery_actor := CASE
    WHEN v_jwt_role = 'service_role' THEN 'service_role'
    ELSE v_database_role
  END;

  IF p_working_session_id IS NULL
     OR p_exhausted_contract_version IS NULL OR btrim(p_exhausted_contract_version) = ''
     OR p_recovery_contract_version IS NULL OR btrim(p_recovery_contract_version) = ''
     OR p_exhausted_contract_version <> 'first-working-session-preparation-v2'
     OR p_recovery_contract_version <> 'first-working-session-preparation-v3'
     OR p_recovery_reason_code <> 'corrected_application_defect' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation recovery';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = p_working_session_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
    WHERE recovery.direct_hire_working_session_id = p_working_session_id
      AND recovery.exhausted_contract_version = p_exhausted_contract_version
      AND recovery.recovery_contract_version = p_recovery_contract_version
      AND recovery.recovery_reason_code = p_recovery_reason_code
  ) THEN
    RETURN true;
  END IF;

  IF v_session.id IS NULL
     OR v_session.status <> 'scheduled'
     OR v_session.preparation_status <> 'failed'
     OR v_session.preparation_attempt_count <> 3
     OR v_session.preparation_contract_version IS DISTINCT FROM p_exhausted_contract_version
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
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'exhausted preparation is not recoverable';
  END IF;
  IF v_session.preparation_failure_code IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'exhausted preparation failure is missing';
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
    p_exhausted_contract_version, p_recovery_contract_version,
    p_recovery_reason_code, v_session.preparation_attempt_count,
    v_session.preparation_failure_code, v_recovery_actor
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
      preparation_contract_version = p_recovery_contract_version
  WHERE working_session.id = v_session.id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
