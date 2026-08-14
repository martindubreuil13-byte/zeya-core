BEGIN;

CREATE TABLE public.direct_hire_first_working_session_preparation_regenerations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_hire_working_session_id uuid NOT NULL
    REFERENCES public.direct_hire_working_sessions(id),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  business_representation_id uuid NOT NULL
    REFERENCES public.business_representations(id),
  direct_hire_onboarding_session_id uuid NOT NULL
    REFERENCES public.direct_hire_onboarding_sessions(id),
  prior_contract_version text NOT NULL CHECK (
    prior_contract_version = 'first-working-session-preparation-v3'
  ),
  new_contract_version text NOT NULL CHECK (
    new_contract_version = 'first-working-session-preparation-v4'
  ),
  prior_preparation_status text NOT NULL CHECK (prior_preparation_status = 'ready'),
  prior_attempt_count smallint NOT NULL CHECK (prior_attempt_count BETWEEN 0 AND 3),
  prior_snapshot_fingerprint text NOT NULL,
  prior_current_brief_id uuid NOT NULL
    REFERENCES public.direct_hire_first_working_session_briefs(id),
  website_checkpoint_at timestamptz NOT NULL,
  regeneration_reason_code text NOT NULL CHECK (
    regeneration_reason_code = 'persisted_alias_invariant_upgrade'
  ),
  regenerated_by_role text NOT NULL CHECK (
    regenerated_by_role IN ('service_role', 'postgres')
  ),
  regenerated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    direct_hire_working_session_id,
    prior_contract_version,
    new_contract_version,
    regeneration_reason_code
  )
);

ALTER TABLE public.direct_hire_first_working_session_preparation_regenerations
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_first_working_session_preparation_regenerations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.direct_hire_first_working_session_preparation_regenerations
  TO service_role;

CREATE FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'preparation regeneration records are immutable';
END;
$$;

CREATE TRIGGER direct_hire_first_working_session_preparation_regenerations_immutable
  BEFORE UPDATE OR DELETE
  ON public.direct_hire_first_working_session_preparation_regenerations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification();

CREATE FUNCTION public.zeya_reject_v4_first_working_session_brief_aliases()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_statement jsonb;
BEGIN
  IF NEW.preparation_contract_version <> 'first-working-session-preparation-v4' THEN
    RETURN NEW;
  END IF;

  FOR v_statement IN
    SELECT statement_value
    FROM jsonb_path_query(NEW.brief, 'strict $.**.statement') AS statement_row(statement_value)
  LOOP
    IF jsonb_typeof(v_statement) <> 'string'
       OR (v_statement #>> '{}') ~ '(^|[^[:alnum:]_])[EH][1-9][0-9]*([^[:alnum:]_]|$)' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'v4 preparation brief statement contains a provider citation alias';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_first_working_session_briefs_v4_alias_guard
  BEFORE INSERT OR UPDATE OF brief, preparation_contract_version
  ON public.direct_hire_first_working_session_briefs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_reject_v4_first_working_session_brief_aliases();

CREATE FUNCTION public.zeya_transition_first_working_session_preparation_v3_to_v4(
  p_working_session_id uuid,
  p_expected_current_v3_brief_id uuid,
  p_regeneration_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_jwt_role text := auth.role();
  v_database_role text := session_user::text;
  v_actor text;
  v_current_brief public.direct_hire_first_working_session_briefs%ROWTYPE;
BEGIN
  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND v_database_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'preparation transition authorization required';
  END IF;
  v_actor := CASE WHEN v_jwt_role = 'service_role' THEN 'service_role' ELSE v_database_role END;

  IF p_working_session_id IS NULL
     OR p_expected_current_v3_brief_id IS NULL
     OR p_regeneration_reason_code <> 'persisted_alias_invariant_upgrade' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation transition';
  END IF;

  SELECT working_session.* INTO v_session
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = p_working_session_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.direct_hire_first_working_session_preparation_regenerations AS regeneration
    WHERE regeneration.direct_hire_working_session_id = p_working_session_id
      AND regeneration.prior_current_brief_id = p_expected_current_v3_brief_id
      AND regeneration.prior_contract_version = 'first-working-session-preparation-v3'
      AND regeneration.new_contract_version = 'first-working-session-preparation-v4'
      AND regeneration.regeneration_reason_code = p_regeneration_reason_code
  ) THEN
    RETURN true;
  END IF;

  SELECT brief.* INTO v_current_brief
  FROM public.direct_hire_first_working_session_briefs AS brief
  WHERE brief.direct_hire_working_session_id = p_working_session_id
    AND brief.current
  FOR UPDATE;

  IF v_session.id IS NULL
     OR v_session.status <> 'scheduled'
     OR v_session.preparation_status <> 'ready'
     OR v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v3'
     OR v_session.preparation_lease_id IS NOT NULL
     OR v_session.preparation_lease_expires_at IS NOT NULL
     OR v_session.preparation_snapshot_fingerprint IS NULL
     OR v_session.preparation_website_persisted_at IS NULL
     OR v_current_brief.id IS DISTINCT FROM p_expected_current_v3_brief_id
     OR v_current_brief.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v3'
     OR v_current_brief.source_snapshot_fingerprint IS DISTINCT FROM v_session.preparation_snapshot_fingerprint
     OR (SELECT count(*) FROM public.direct_hire_first_working_session_briefs AS brief
         WHERE brief.direct_hire_working_session_id = p_working_session_id AND brief.current) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.direct_hire_onboarding_sessions AS onboarding
       JOIN public.businesses AS business
         ON business.id = onboarding.business_id
        AND business.user_id = onboarding.owner_id
       JOIN public.business_representations AS representation
         ON representation.id = onboarding.business_representation_id
        AND representation.business_id = onboarding.business_id
        AND representation.user_id = onboarding.owner_id
       WHERE onboarding.id = v_session.direct_hire_onboarding_session_id
         AND onboarding.owner_id = v_session.owner_id
         AND onboarding.business_id = v_session.business_id
         AND onboarding.business_representation_id = v_session.business_representation_id
         AND onboarding.onboarding_state = 'employment_accepted'
         AND onboarding.induction_state = 'preparation_pending'
         AND representation.current_version_id IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM public.representation_formation_sessions AS formation
       WHERE formation.business_representation_id = v_session.business_representation_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'v3 preparation is not eligible for v4 transition';
  END IF;

  INSERT INTO public.direct_hire_first_working_session_preparation_regenerations (
    direct_hire_working_session_id, owner_id, business_id,
    business_representation_id, direct_hire_onboarding_session_id,
    prior_contract_version, new_contract_version, prior_preparation_status,
    prior_attempt_count, prior_snapshot_fingerprint, prior_current_brief_id,
    website_checkpoint_at, regeneration_reason_code, regenerated_by_role
  ) VALUES (
    v_session.id, v_session.owner_id, v_session.business_id,
    v_session.business_representation_id, v_session.direct_hire_onboarding_session_id,
    'first-working-session-preparation-v3', 'first-working-session-preparation-v4',
    v_session.preparation_status, v_session.preparation_attempt_count,
    v_session.preparation_snapshot_fingerprint, v_current_brief.id,
    v_session.preparation_website_persisted_at, p_regeneration_reason_code, v_actor
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
      preparation_contract_version = 'first-working-session-preparation-v4'
  WHERE working_session.id = v_session.id;

  RETURN true;
END;
$$;

ALTER TABLE public.direct_hire_first_working_session_preparation_regenerations OWNER TO postgres;
ALTER FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification() OWNER TO postgres;
ALTER FUNCTION public.zeya_reject_v4_first_working_session_brief_aliases() OWNER TO postgres;
ALTER FUNCTION public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_prevent_first_working_session_preparation_regeneration_modification()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_reject_v4_first_working_session_brief_aliases()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
