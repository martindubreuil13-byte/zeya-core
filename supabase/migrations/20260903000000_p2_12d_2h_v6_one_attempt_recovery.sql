BEGIN;

-- P2.12D.2h: one audited authorization for one additional governed v6 claim.
-- This is intentionally a dedicated, non-generic recovery mechanism.
CREATE TABLE public.direct_hire_first_working_session_v6_one_attempt_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL UNIQUE,
  direct_hire_working_session_id uuid NOT NULL UNIQUE
    REFERENCES public.direct_hire_working_sessions(id) ON DELETE RESTRICT,
  direct_hire_onboarding_session_id uuid NOT NULL
    REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL
    REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  recovery_type text NOT NULL
    CHECK (recovery_type = 'p2_12d_2h_v6_one_attempt'),
  recovery_reason text NOT NULL
    CHECK (recovery_reason = 'p2.12d.2h governed verification'),
  preparation_contract_version text NOT NULL
    CHECK (preparation_contract_version = 'first-working-session-preparation-v6'),
  reasoning_contract_version text NOT NULL
    CHECK (reasoning_contract_version = '1.1-source-semantics'),
  prior_attempt_count smallint NOT NULL CHECK (prior_attempt_count = 10),
  resulting_attempt_count smallint NOT NULL CHECK (resulting_attempt_count = 9),
  prior_failure_code text NOT NULL
    CHECK (prior_failure_code = 'preparation_reasoning_output_validation_failed'),
  recovered_by_role text NOT NULL CHECK (recovered_by_role = 'service_role'),
  recovered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.direct_hire_first_working_session_v6_one_attempt_recoveries
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_first_working_session_v6_one_attempt_recoveries
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.direct_hire_first_working_session_v6_one_attempt_recoveries
  TO service_role;

CREATE TRIGGER direct_hire_first_working_session_v6_one_attempt_recoveries_immutable
  BEFORE UPDATE OR DELETE
  ON public.direct_hire_first_working_session_v6_one_attempt_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_first_working_session_preparation_recovery_modification();

CREATE FUNCTION public.zeya_recover_first_working_session_preparation_v6_one_attempt(
  p_working_session_id uuid,
  p_onboarding_session_id uuid,
  p_owner_id uuid,
  p_business_id uuid,
  p_business_representation_id uuid,
  p_correlation_id uuid
)
RETURNS TABLE (
  recovery_id uuid,
  correlation_id uuid,
  prior_attempt_count smallint,
  resulting_attempt_count smallint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_recovery_id uuid;
  v_rows_updated integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'recovery authorization required';
  END IF;
  IF p_working_session_id IS NULL OR p_onboarding_session_id IS NULL
     OR p_owner_id IS NULL OR p_business_id IS NULL
     OR p_business_representation_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid v6 one-attempt recovery';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = p_working_session_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.direct_hire_first_working_session_v6_one_attempt_recoveries AS recovery
    WHERE recovery.direct_hire_working_session_id = p_working_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'v6 one-attempt recovery already granted';
  END IF;

  IF v_session.id IS NULL
     OR v_session.direct_hire_onboarding_session_id <> p_onboarding_session_id
     OR v_session.owner_id <> p_owner_id
     OR v_session.business_id <> p_business_id
     OR v_session.business_representation_id <> p_business_representation_id
     OR v_session.status <> 'scheduled'
     OR v_session.preparation_status <> 'failed'
     OR v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v6'
     OR v_session.preparation_failure_code IS DISTINCT FROM 'preparation_reasoning_output_validation_failed'
     OR v_session.preparation_attempt_count <> 10
     OR v_session.preparation_lease_id IS NOT NULL
     OR v_session.preparation_lease_expires_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.direct_hire_first_working_session_briefs AS brief
       WHERE brief.direct_hire_working_session_id = v_session.id AND brief.current
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.direct_hire_onboarding_sessions AS onboarding
       JOIN public.business_representations AS representation
         ON representation.id = onboarding.business_representation_id
        AND representation.business_id = onboarding.business_id
        AND representation.user_id = onboarding.owner_id
       WHERE onboarding.id = p_onboarding_session_id
         AND onboarding.owner_id = p_owner_id
         AND onboarding.business_id = p_business_id
         AND onboarding.business_representation_id = p_business_representation_id
         AND onboarding.onboarding_state = 'employment_accepted'
         AND onboarding.induction_state = 'preparation_pending'
         AND representation.current_version_id IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'exhausted v6 preparation is not recoverable';
  END IF;

  UPDATE public.direct_hire_working_sessions AS working_session
  SET preparation_attempt_count = 9
  WHERE working_session.id = p_working_session_id
    AND working_session.direct_hire_onboarding_session_id = p_onboarding_session_id
    AND working_session.owner_id = p_owner_id
    AND working_session.business_id = p_business_id
    AND working_session.business_representation_id = p_business_representation_id
    AND working_session.status = 'scheduled'
    AND working_session.preparation_status = 'failed'
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v6'
    AND working_session.preparation_failure_code = 'preparation_reasoning_output_validation_failed'
    AND working_session.preparation_attempt_count = 10
    AND working_session.preparation_lease_id IS NULL
    AND working_session.preparation_lease_expires_at IS NULL;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'v6 recovery state changed concurrently';
  END IF;

  INSERT INTO public.direct_hire_first_working_session_v6_one_attempt_recoveries (
    correlation_id, direct_hire_working_session_id, direct_hire_onboarding_session_id,
    owner_id, business_id, business_representation_id, recovery_type, recovery_reason,
    preparation_contract_version, reasoning_contract_version, prior_attempt_count,
    resulting_attempt_count, prior_failure_code, recovered_by_role
  ) VALUES (
    p_correlation_id, p_working_session_id, p_onboarding_session_id,
    p_owner_id, p_business_id, p_business_representation_id,
    'p2_12d_2h_v6_one_attempt', 'p2.12d.2h governed verification',
    'first-working-session-preparation-v6', '1.1-source-semantics', 10, 9,
    'preparation_reasoning_output_validation_failed', auth.role()
  ) RETURNING id INTO v_recovery_id;

  RETURN QUERY SELECT v_recovery_id, p_correlation_id, 10::smallint, 9::smallint;
END;
$$;

ALTER TABLE public.direct_hire_first_working_session_v6_one_attempt_recoveries OWNER TO postgres;
ALTER FUNCTION public.zeya_recover_first_working_session_preparation_v6_one_attempt(uuid,uuid,uuid,uuid,uuid,uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_recover_first_working_session_preparation_v6_one_attempt(uuid,uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_recover_first_working_session_preparation_v6_one_attempt(uuid,uuid,uuid,uuid,uuid,uuid)
  TO service_role;

-- Replace the current claim function only to consume the dedicated v6
-- authorization at claim time. All ordinary claim behavior is unchanged.
CREATE OR REPLACE FUNCTION public.zeya_claim_first_working_session_preparation(
  p_contract_version text,
  p_lease_seconds integer DEFAULT 300,
  p_working_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  working_session_id uuid, onboarding_session_id uuid, owner_id uuid,
  business_id uuid, business_representation_id uuid, website_url text,
  lease_id uuid, attempt_count smallint, website_persisted boolean, claimed boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_onboarding public.direct_hire_onboarding_sessions%ROWTYPE;
  v_lease_id uuid;
  v_consumes_v6_recovery boolean := false;
  v_claim_attempt_count smallint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_contract_version IS NULL OR btrim(p_contract_version) = ''
     OR p_lease_seconds NOT BETWEEN 60 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation claim';
  END IF;

  SELECT candidate.* INTO v_session
  FROM public.direct_hire_working_sessions AS candidate
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = candidate.direct_hire_onboarding_session_id
   AND onboarding.owner_id = candidate.owner_id
   AND onboarding.business_id = candidate.business_id
   AND onboarding.business_representation_id = candidate.business_representation_id
  WHERE candidate.status = 'scheduled'
    AND onboarding.onboarding_state = 'employment_accepted'
    AND onboarding.induction_state = 'preparation_pending'
    AND candidate.preparation_attempt_count < 10
    AND (
      candidate.preparation_status IN ('pending', 'failed')
      OR (candidate.preparation_status = 'running' AND candidate.preparation_lease_expires_at <= now())
      OR (candidate.preparation_status = 'ready' AND candidate.preparation_contract_version IS DISTINCT FROM p_contract_version)
    )
    AND (p_working_session_id IS NULL OR candidate.id = p_working_session_id)
  ORDER BY candidate.scheduled_at, candidate.created_at
  LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED;

  IF v_session.id IS NULL THEN RETURN; END IF;

  SELECT onboarding.* INTO v_onboarding
  FROM public.direct_hire_onboarding_sessions AS onboarding
  WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
  FOR UPDATE;

  v_consumes_v6_recovery := v_session.preparation_attempt_count = 9
    AND v_session.preparation_status = 'failed'
    AND v_session.preparation_contract_version = 'first-working-session-preparation-v6'
    AND v_session.preparation_failure_code = 'preparation_reasoning_output_validation_failed'
    AND p_contract_version = 'first-working-session-preparation-v6'
    AND EXISTS (
      SELECT 1
      FROM public.direct_hire_first_working_session_v6_one_attempt_recoveries AS recovery
      WHERE recovery.direct_hire_working_session_id = v_session.id
        AND recovery.resulting_attempt_count = 9
    );
  v_claim_attempt_count := CASE WHEN v_consumes_v6_recovery THEN 10 ELSE v_session.preparation_attempt_count END;

  v_lease_id := gen_random_uuid();
  IF v_session.preparation_status='ready'
    AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version THEN
    UPDATE public.direct_hire_first_working_session_briefs AS brief
    SET current=false
    WHERE brief.direct_hire_working_session_id=v_session.id AND brief.current;
  END IF;
  UPDATE public.direct_hire_working_sessions AS working_session
  SET preparation_status = 'running',
      preparation_started_at = now(), preparation_completed_at = NULL,
      preparation_failure_code = NULL, preparation_lease_id = v_lease_id,
      preparation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      preparation_contract_version = p_contract_version,
      preparation_attempt_count = v_claim_attempt_count,
      preparation_website_persisted_at = CASE
        WHEN v_session.preparation_status='ready'
          AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version
        THEN NULL ELSE v_session.preparation_website_persisted_at END
  WHERE working_session.id = v_session.id;

  RETURN QUERY SELECT v_session.id, v_onboarding.id, v_session.owner_id,
    v_session.business_id, v_session.business_representation_id, v_onboarding.website_url,
    v_lease_id, v_claim_attempt_count,
    v_session.preparation_website_persisted_at IS NOT NULL
      AND NOT (v_session.preparation_status='ready'
        AND v_session.preparation_contract_version IS DISTINCT FROM p_contract_version),
    true;
END;
$$;

ALTER FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_claim_first_working_session_preparation(text, integer, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
