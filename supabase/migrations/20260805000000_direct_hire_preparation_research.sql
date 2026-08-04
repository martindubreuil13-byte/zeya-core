-- Direct Hire Vertical Slice 2. This artifact is applied manually by the owner.
-- PostgreSQL does not permit a newly added enum value to be used before the
-- transaction that adds it commits, so the single migration file contains two
-- explicit transactions. All schema/function work remains transactional.
BEGIN;

ALTER TYPE public.evidence_source_type ADD VALUE IF NOT EXISTS 'public_website';

COMMIT;

-- Recovery if execution stops here: rerun this entire file. The enum addition
-- is idempotent and, by itself, enables no research or persistence path.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum AS enum_value
    JOIN pg_catalog.pg_type AS enum_type ON enum_type.oid = enum_value.enumtypid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    WHERE namespace.nspname = 'public'
      AND enum_type.typname = 'evidence_source_type'
      AND enum_value.enumlabel = 'public_website'
  ) THEN
    RAISE EXCEPTION 'required evidence source public_website is unavailable';
  END IF;
END;
$$;

ALTER TABLE public.direct_hire_onboarding_sessions
  DROP CONSTRAINT direct_hire_onboarding_sessions_preparation_status_check;

ALTER TABLE public.direct_hire_onboarding_sessions
  ADD CONSTRAINT direct_hire_onboarding_sessions_preparation_status_check CHECK (
    preparation_status IN ('queued', 'running', 'ready', 'partial', 'failed')
  ),
  ADD COLUMN research_authorized_at timestamptz,
  ADD COLUMN profile_business_name text;

UPDATE public.direct_hire_onboarding_sessions AS session
SET profile_business_name = business.business_name
FROM public.businesses AS business
WHERE business.id = session.business_id;

ALTER TABLE public.direct_hire_onboarding_sessions
  ALTER COLUMN profile_business_name SET NOT NULL,
  ADD COLUMN preparation_attempt_count smallint NOT NULL DEFAULT 0 CHECK (
    preparation_attempt_count BETWEEN 0 AND 3
  ),
  ADD COLUMN preparation_started_at timestamptz,
  ADD COLUMN preparation_completed_at timestamptz,
  ADD COLUMN preparation_failed_at timestamptz,
  ADD COLUMN preparation_lease_id uuid,
  ADD COLUMN preparation_lease_expires_at timestamptz,
  ADD COLUMN preparation_failure_code text CHECK (
    preparation_failure_code IS NULL OR preparation_failure_code IN (
      'unsupported_site', 'unsafe_destination', 'dns_failed',
      'redirect_blocked', 'too_many_redirects', 'response_too_large',
      'response_compressed', 'unsupported_content_type', 'request_timeout',
      'request_failed', 'robots_disallowed', 'no_usable_evidence',
      'persistence_failed'
    )
  ),
  ADD COLUMN preparation_progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(preparation_progress) = 'object'
  ),
  ADD COLUMN preparation_successful_page_count smallint NOT NULL DEFAULT 0 CHECK (
    preparation_successful_page_count BETWEEN 0 AND 3
  ),
  ADD COLUMN preparation_failed_page_count smallint NOT NULL DEFAULT 0 CHECK (
    preparation_failed_page_count BETWEEN 0 AND 3
  ),
  ADD COLUMN preparation_extraction_version text,
  ADD COLUMN preparation_last_retry_at timestamptz;

ALTER TABLE public.evidence
  ADD COLUMN direct_hire_onboarding_session_id uuid
    REFERENCES public.direct_hire_onboarding_sessions(id),
  ADD COLUMN website_source_key text,
  ADD COLUMN requested_source_url text,
  ADD COLUMN canonical_source_url text,
  ADD COLUMN source_retrieved_at timestamptz,
  ADD COLUMN source_content_hash text,
  ADD COLUMN source_page_type text CHECK (
    source_page_type IS NULL OR source_page_type IN (
      'homepage', 'about', 'products_services'
    )
  ),
  ADD COLUMN source_evidence_kind text CHECK (
    source_evidence_kind IS NULL OR source_evidence_kind IN (
      'title', 'meta_description', 'primary_heading', 'main_excerpt',
      'about_excerpt', 'products_services_excerpt', 'explicit_absence'
    )
  ),
  ADD COLUMN source_selector text,
  ADD COLUMN extraction_method_version text;

CREATE UNIQUE INDEX evidence_website_source_key_unique
  ON public.evidence (direct_hire_onboarding_session_id, website_source_key)
  WHERE direct_hire_onboarding_session_id IS NOT NULL
    AND website_source_key IS NOT NULL;

ALTER TABLE public.observations
  ADD COLUMN website_observation_key text;

CREATE UNIQUE INDEX observations_website_key_unique
  ON public.observations (business_representation_id, website_observation_key)
  WHERE website_observation_key IS NOT NULL;

CREATE FUNCTION public.zeya_enforce_direct_hire_website_evidence_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_type = 'public_website' AND (
    current_user <> 'postgres'
    OR NEW.captured_by_actor IS DISTINCT FROM 'zeya_direct_hire_website_research'
    OR NEW.direct_hire_onboarding_session_id IS NULL
    OR NEW.website_source_key IS NULL
    OR NEW.requested_source_url IS NULL
    OR NEW.canonical_source_url IS NULL
    OR NEW.source_retrieved_at IS NULL
    OR NEW.source_content_hash IS NULL
    OR NEW.source_page_type IS NULL
    OR NEW.source_evidence_kind IS NULL
    OR NEW.extraction_method_version IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'website evidence insert not authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_website_evidence_authority
  BEFORE INSERT ON public.evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_enforce_direct_hire_website_evidence_authority();

REVOKE ALL ON FUNCTION public.zeya_enforce_direct_hire_website_evidence_authority()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.zeya_enforce_direct_hire_website_observation_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.website_observation_key IS NOT NULL AND current_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'website observation insert not authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_website_observation_authority
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_enforce_direct_hire_website_observation_authority();

REVOKE ALL ON FUNCTION public.zeya_enforce_direct_hire_website_observation_authority()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.zeya_direct_hire_profile_replay_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT business.business_name INTO NEW.profile_business_name
    FROM public.businesses AS business
    WHERE business.id = NEW.business_id;
    RETURN NEW;
  END IF;
  IF OLD.research_authorized_at IS NULL THEN
    SELECT business.business_name INTO NEW.profile_business_name
    FROM public.businesses AS business
    WHERE business.id = NEW.business_id;
    RETURN NEW;
  END IF;
  IF NEW.owner_relationship_name IS DISTINCT FROM OLD.owner_relationship_name
    OR NEW.website_url IS DISTINCT FROM OLD.website_url
    OR NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164
    OR NEW.growth_priority IS DISTINCT FROM OLD.growth_priority
    OR EXISTS (
      SELECT 1 FROM public.businesses AS business
      WHERE business.id = NEW.business_id
        AND business.business_name IS DISTINCT FROM OLD.profile_business_name
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'profile editing unavailable after preparation authorization';
  END IF;
  NEW.preparation_status := OLD.preparation_status;
  NEW.research_authorized_at := OLD.research_authorized_at;
  NEW.preparation_attempt_count := OLD.preparation_attempt_count;
  NEW.preparation_started_at := OLD.preparation_started_at;
  NEW.preparation_completed_at := OLD.preparation_completed_at;
  NEW.preparation_failed_at := OLD.preparation_failed_at;
  NEW.preparation_lease_id := OLD.preparation_lease_id;
  NEW.preparation_lease_expires_at := OLD.preparation_lease_expires_at;
  NEW.preparation_failure_code := OLD.preparation_failure_code;
  NEW.preparation_progress := OLD.preparation_progress;
  NEW.preparation_successful_page_count := OLD.preparation_successful_page_count;
  NEW.preparation_failed_page_count := OLD.preparation_failed_page_count;
  NEW.preparation_extraction_version := OLD.preparation_extraction_version;
  NEW.preparation_last_retry_at := OLD.preparation_last_retry_at;
  NEW.profile_business_name := OLD.profile_business_name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_profile_insert_guard
  BEFORE INSERT
  ON public.direct_hire_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_direct_hire_profile_replay_guard();

CREATE TRIGGER direct_hire_profile_update_guard
  BEFORE UPDATE OF owner_relationship_name, website_url, phone_e164,
    growth_priority
  ON public.direct_hire_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_direct_hire_profile_replay_guard();

REVOKE ALL ON FUNCTION public.zeya_direct_hire_profile_replay_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.zeya_claim_direct_hire_preparation()
RETURNS TABLE (
  onboarding_session_id uuid,
  owner_id uuid,
  business_id uuid,
  business_representation_id uuid,
  website_url text,
  preparation_status text,
  preparation_lease_id uuid,
  preparation_attempt_count smallint,
  preparation_progress jsonb,
  claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_session_count integer;
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_lease_id uuid;
BEGIN
  IF v_owner_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  PERFORM 1 FROM auth.users AS owner_user
  WHERE owner_user.id = v_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  SELECT count(*) INTO v_session_count
  FROM public.direct_hire_onboarding_sessions AS session
  WHERE session.owner_id = v_owner_id;
  IF v_session_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'onboarding not found';
  ELSIF v_session_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'onboarding state conflict';
  END IF;

  SELECT session.* INTO v_session
  FROM public.direct_hire_onboarding_sessions AS session
  WHERE session.owner_id = v_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'onboarding not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses AS business
    WHERE business.id = v_session.business_id
      AND business.user_id = v_owner_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.business_representations AS representation
    WHERE representation.id = v_session.business_representation_id
      AND representation.business_id = v_session.business_id
      AND representation.user_id = v_owner_id
      AND representation.current_version_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.representation_formation_sessions AS formation
    WHERE formation.business_representation_id = v_session.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'owner journey conflict';
  END IF;

  IF v_session.preparation_status = 'ready' THEN
    RETURN QUERY SELECT v_session.id, v_session.owner_id, v_session.business_id,
      v_session.business_representation_id, v_session.website_url,
      v_session.preparation_status, v_session.preparation_lease_id,
      v_session.preparation_attempt_count, v_session.preparation_progress, false;
    RETURN;
  END IF;

  IF v_session.preparation_status = 'running'
    AND v_session.preparation_lease_expires_at > now() THEN
    RETURN QUERY SELECT v_session.id, v_session.owner_id, v_session.business_id,
      v_session.business_representation_id, v_session.website_url,
      v_session.preparation_status, v_session.preparation_lease_id,
      v_session.preparation_attempt_count, v_session.preparation_progress, false;
    RETURN;
  END IF;

  IF v_session.preparation_status NOT IN ('queued', 'failed', 'partial', 'running')
    OR v_session.preparation_attempt_count >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'preparation not retryable';
  END IF;

  v_lease_id := gen_random_uuid();
  UPDATE public.direct_hire_onboarding_sessions AS session
  SET research_authorized_at = coalesce(session.research_authorized_at, now()),
      preparation_status = 'running',
      preparation_attempt_count = session.preparation_attempt_count + 1,
      preparation_started_at = now(),
      preparation_completed_at = NULL,
      preparation_failed_at = NULL,
      preparation_lease_id = v_lease_id,
      preparation_lease_expires_at = now() + interval '45 seconds',
      preparation_failure_code = NULL,
      preparation_progress = jsonb_build_object(
        'validating_destination', 'running',
        'homepage', 'pending',
        'about', 'pending',
        'products_services', 'pending',
        'evidence', 'pending',
        'observations', 'pending'
      ),
      preparation_successful_page_count = 0,
      preparation_failed_page_count = 0,
      preparation_extraction_version = 'direct-hire-web-v1',
      preparation_last_retry_at = CASE
        WHEN session.preparation_attempt_count > 0 THEN now()
        ELSE session.preparation_last_retry_at
      END
  WHERE session.id = v_session.id
  RETURNING * INTO v_session;

  RETURN QUERY SELECT v_session.id, v_session.owner_id, v_session.business_id,
    v_session.business_representation_id, v_session.website_url,
    v_session.preparation_status, v_session.preparation_lease_id,
    v_session.preparation_attempt_count, v_session.preparation_progress, true;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_claim_direct_hire_preparation()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_claim_direct_hire_preparation()
  TO authenticated;

CREATE FUNCTION public.zeya_finalize_direct_hire_preparation(
  p_onboarding_session_id uuid,
  p_expected_owner_id uuid,
  p_lease_id uuid,
  p_final_status text,
  p_failure_code text,
  p_progress jsonb,
  p_successful_page_count smallint,
  p_failed_page_count smallint,
  p_evidence jsonb,
  p_observations jsonb
)
RETURNS TABLE (
  preparation_status text,
  preparation_attempt_count smallint,
  preparation_progress jsonb,
  preparation_successful_page_count smallint,
  preparation_failed_page_count smallint,
  preparation_failure_code text,
  preparation_completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_item jsonb;
  v_evidence_id uuid;
  v_evidence_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_final_status NOT IN ('ready', 'partial', 'failed')
    OR jsonb_typeof(coalesce(p_progress, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(coalesce(p_observations, '[]'::jsonb)) > 3
    OR p_successful_page_count NOT BETWEEN 0 AND 3
    OR p_failed_page_count NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid preparation result';
  END IF;
  IF (p_final_status = 'ready' AND p_failed_page_count <> 0)
    OR (p_final_status = 'partial' AND p_failed_page_count = 0)
    OR (p_final_status = 'failed' AND p_failure_code IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'inconsistent preparation status';
  END IF;

  SELECT session.* INTO v_session
  FROM public.direct_hire_onboarding_sessions AS session
  WHERE session.id = p_onboarding_session_id
    AND session.owner_id = p_expected_owner_id
  FOR UPDATE;
  IF v_session.id IS NULL
    OR v_session.preparation_status <> 'running'
    OR v_session.preparation_lease_id <> p_lease_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'preparation lease conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses AS business
    WHERE business.id = v_session.business_id
      AND business.user_id = p_expected_owner_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.business_representations AS representation
    WHERE representation.id = v_session.business_representation_id
      AND representation.business_id = v_session.business_id
      AND representation.user_id = p_expected_owner_id
      AND representation.current_version_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.representation_formation_sessions AS formation
    WHERE formation.business_representation_id = v_session.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'owner journey conflict';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) LOOP
    IF v_item->>'sourceKey' IS NULL
      OR v_item->>'rawStatement' IS NULL
      OR v_item->>'requestedUrl' IS NULL
      OR v_item->>'finalUrl' IS NULL
      OR v_item->>'retrievedAt' IS NULL
      OR v_item->>'documentContentHash' IS NULL
      OR v_item->>'pageType' NOT IN ('homepage', 'about', 'products_services')
      OR v_item->>'kind' NOT IN (
        'title', 'meta_description', 'primary_heading', 'main_excerpt',
        'about_excerpt', 'products_services_excerpt', 'explicit_absence'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid website evidence';
    END IF;

    INSERT INTO public.evidence (
      business_representation_id, source_type, source_description,
      raw_statement, affected_domains, captured_by_actor,
      direct_hire_onboarding_session_id, website_source_key,
      requested_source_url, canonical_source_url, source_retrieved_at,
      source_content_hash, source_page_type, source_evidence_kind,
      source_selector, extraction_method_version
    ) VALUES (
      v_session.business_representation_id, 'public_website',
      'Bounded Direct Hire public website review', v_item->>'rawStatement',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains', '[]'::jsonb))),
      'zeya_direct_hire_website_research', v_session.id, v_item->>'sourceKey',
      v_item->>'requestedUrl', v_item->>'finalUrl',
      (v_item->>'retrievedAt')::timestamptz, v_item->>'documentContentHash',
      v_item->>'pageType', v_item->>'kind', v_item->>'selector',
      v_item->>'extractionVersion'
    )
    ON CONFLICT (direct_hire_onboarding_session_id, website_source_key)
      WHERE direct_hire_onboarding_session_id IS NOT NULL
        AND website_source_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_evidence_id;

    IF v_evidence_id IS NULL THEN
      SELECT evidence.id INTO v_evidence_id
      FROM public.evidence AS evidence
      WHERE evidence.direct_hire_onboarding_session_id = v_session.id
        AND evidence.business_representation_id = v_session.business_representation_id
        AND evidence.website_source_key = v_item->>'sourceKey';
    ELSE
      INSERT INTO public.audit_events (
        business_representation_id, event_type, evidence_id, actor_system, details
      ) VALUES (
        v_session.business_representation_id, 'evidence_created', v_evidence_id,
        'zeya_direct_hire_website_research',
        jsonb_build_object('onboardingSessionId', v_session.id, 'sourceKey', v_item->>'sourceKey')
      );
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_observations, '[]'::jsonb)) LOOP
    IF v_item->>'observationKey' IS NULL
      OR v_item->>'evidenceSourceKey' IS NULL
      OR v_item->>'interpretedMeaning' IS NULL
      OR (v_item->>'confidence')::integer NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid website observation';
    END IF;
    SELECT evidence.id INTO v_evidence_id
    FROM public.evidence AS evidence
    WHERE evidence.direct_hire_onboarding_session_id = v_session.id
      AND evidence.business_representation_id = v_session.business_representation_id
      AND evidence.website_source_key = v_item->>'evidenceSourceKey';
    IF v_evidence_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'observation evidence missing';
    END IF;

    INSERT INTO public.observations (
      business_representation_id, evidence_id, interpreted_meaning,
      confidence_in_interpretation, affected_domains, affected_elements,
      created_by_actor, website_observation_key
    ) VALUES (
      v_session.business_representation_id, v_evidence_id,
      v_item->>'interpretedMeaning', (v_item->>'confidence')::smallint,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains', '[]'::jsonb))),
      ARRAY[]::text[], 'zeya_direct_hire_website_research',
      v_item->>'observationKey'
    )
    ON CONFLICT (business_representation_id, website_observation_key)
      WHERE website_observation_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NOT NULL THEN
      INSERT INTO public.audit_events (
        business_representation_id, event_type, observation_id, actor_system, details
      ) VALUES (
        v_session.business_representation_id, 'observation_created', v_evidence_id,
        'zeya_direct_hire_website_research',
        jsonb_build_object('onboardingSessionId', v_session.id, 'observationKey', v_item->>'observationKey')
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_evidence_count
  FROM public.evidence AS evidence
  WHERE evidence.direct_hire_onboarding_session_id = v_session.id
    AND evidence.source_type = 'public_website';

  -- A failed retry must not erase the truthful durable result of an earlier
  -- partial attempt. Existing sourced Evidence keeps the session partial.
  IF p_final_status = 'failed' AND v_evidence_count > 0 THEN
    p_final_status := 'partial';
    p_failure_code := NULL;
  END IF;

  IF p_final_status IN ('ready', 'partial') AND v_evidence_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'preparation result inconsistent';
  END IF;

  UPDATE public.direct_hire_onboarding_sessions AS session
  SET preparation_status = p_final_status,
      preparation_completed_at = CASE WHEN p_final_status IN ('ready', 'partial') THEN now() ELSE NULL END,
      preparation_failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE NULL END,
      preparation_lease_id = NULL,
      preparation_lease_expires_at = NULL,
      preparation_failure_code = CASE WHEN p_final_status = 'failed' THEN p_failure_code ELSE NULL END,
      preparation_progress = p_progress,
      preparation_successful_page_count = p_successful_page_count,
      preparation_failed_page_count = p_failed_page_count,
      preparation_extraction_version = 'direct-hire-web-v1'
  WHERE session.id = v_session.id
  RETURNING * INTO v_session;

  RETURN QUERY SELECT v_session.preparation_status,
    v_session.preparation_attempt_count, v_session.preparation_progress,
    v_session.preparation_successful_page_count,
    v_session.preparation_failed_page_count,
    v_session.preparation_failure_code,
    v_session.preparation_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
) TO service_role;

COMMIT;
