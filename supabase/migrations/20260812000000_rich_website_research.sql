-- P1 Rich Website Research widens the bounded acquisition vocabulary and page
-- count only. Evidence governance, source semantics, and hypothesis behavior
-- remain unchanged.
BEGIN;

ALTER TABLE public.direct_hire_onboarding_sessions
  DROP CONSTRAINT direct_hire_onboarding_sessi_preparation_successful_page__check,
  DROP CONSTRAINT direct_hire_onboarding_sessi_preparation_failed_page_coun_check;

ALTER TABLE public.direct_hire_onboarding_sessions
  ADD CONSTRAINT direct_hire_preparation_successful_page_count_check CHECK (
    preparation_successful_page_count BETWEEN 0 AND 10
  ),
  ADD CONSTRAINT direct_hire_preparation_failed_page_count_check CHECK (
    preparation_failed_page_count BETWEEN 0 AND 10
  );

ALTER TABLE public.evidence
  DROP CONSTRAINT evidence_source_page_type_check,
  DROP CONSTRAINT evidence_source_evidence_kind_check;

ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_source_page_type_check CHECK (
    source_page_type IS NULL OR source_page_type IN (
      'homepage', 'about', 'products_services', 'pricing', 'customers',
      'case_studies', 'testimonials', 'industries', 'methodology', 'team',
      'faq', 'contact', 'resources', 'registered_public_page'
    )
  ),
  ADD CONSTRAINT evidence_source_evidence_kind_check CHECK (
    source_evidence_kind IS NULL OR source_evidence_kind IN (
      'title', 'meta_description', 'primary_heading', 'main_excerpt',
      'about_excerpt', 'products_services_excerpt', 'registered_page_excerpt',
      'explicit_absence', 'section_text', 'section_list',
      'pricing_block', 'testimonial', 'quantitative_claim'
    )
  );

CREATE OR REPLACE FUNCTION public.zeya_claim_direct_hire_preparation()
RETURNS TABLE (
  onboarding_session_id uuid, owner_id uuid, business_id uuid,
  business_representation_id uuid, website_url text, preparation_status text,
  preparation_lease_id uuid, preparation_attempt_count smallint,
  preparation_progress jsonb, claimed boolean
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
  PERFORM 1 FROM auth.users AS owner_user WHERE owner_user.id = v_owner_id FOR UPDATE;
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
    WHERE business.id = v_session.business_id AND business.user_id = v_owner_id
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
      preparation_started_at = now(), preparation_completed_at = NULL,
      preparation_failed_at = NULL, preparation_lease_id = v_lease_id,
      preparation_lease_expires_at = now() + interval '45 seconds',
      preparation_failure_code = NULL,
      preparation_progress = jsonb_build_object(
        'validating_destination', 'running', 'homepage', 'pending',
        'about', 'pending', 'products_services', 'pending',
        'evidence', 'pending', 'observations', 'pending'
      ),
      preparation_successful_page_count = 0,
      preparation_failed_page_count = 0,
      preparation_extraction_version = 'direct-hire-web-v2',
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

CREATE OR REPLACE FUNCTION public.zeya_finalize_direct_hire_preparation(
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
    OR p_successful_page_count NOT BETWEEN 0 AND 10
    OR p_failed_page_count NOT BETWEEN 0 AND 10 THEN
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
      OR v_item->>'pageType' NOT IN (
        'homepage', 'about', 'products_services', 'pricing', 'customers',
        'case_studies', 'testimonials', 'industries', 'methodology', 'team',
        'faq', 'contact', 'resources'
      )
      OR v_item->>'kind' NOT IN (
        'title', 'meta_description', 'primary_heading', 'main_excerpt',
        'about_excerpt', 'products_services_excerpt', 'explicit_absence',
        'section_text', 'section_list', 'pricing_block',
        'testimonial', 'quantitative_claim'
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
      preparation_extraction_version = 'direct-hire-web-v2'
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
