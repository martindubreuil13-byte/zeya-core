-- P2.11C Actor Contract Repair
-- ============================
-- Fixes UUID-TEXT actor contract mismatch in evidence tables.
-- Live Production schema defines evidence.captured_by_actor as UUID,
-- but multiple functions attempt TEXT inserts causing 22P02 errors.
--
-- CANONICAL ACTOR MODEL:
-- - evidence.captured_by_actor: UUID of human actors (owner_id for owner-submitted evidence)
-- - evidence.captured_by_actor: NULL for system-generated evidence (website research, etc.)
-- - audit_events.actor_system: TEXT identifier for system actors (zeya_direct_hire_website_research, etc.)
-- - For owner-submitted corrections: captured_by_actor = owner UUID, actor_user_id recorded in audit_events
--
-- AFFECTED FUNCTIONS (6 total):
-- 1. zeya_finalize_direct_hire_preparation - writes TEXT to captured_by_actor + created_by_actor
-- 2. zeya_finalize_direct_hire_public_source - writes TEXT to captured_by_actor
-- 3. zeya_persist_first_working_session_website_research - writes TEXT to captured_by_actor + created_by_actor
-- 4. zeya_apply_hypothesis_owner_action - writes 'owner:' || uuid TEXT to captured_by_actor
-- 5. zeya_record_direct_hire_formation_answer - writes 'owner:' || uuid TEXT to captured_by_actor
-- 6. zeya_record_formation_owner_correction - writes 'owner:' || uuid TEXT to captured_by_actor
--
-- AFFECTED TRIGGER (1 total):
-- 1. zeya_enforce_direct_hire_website_evidence_authority - compares UUID to TEXT literal

BEGIN;

-- Fix 1: zeya_enforce_direct_hire_website_evidence_authority trigger
-- For system-generated website evidence, captured_by_actor should be NULL,
-- not compared to TEXT strings. System attribution goes to audit_events.actor_system.
DROP TRIGGER IF EXISTS direct_hire_website_evidence_authority ON public.evidence;

DROP FUNCTION IF EXISTS public.zeya_enforce_direct_hire_website_evidence_authority();

CREATE FUNCTION public.zeya_enforce_direct_hire_website_evidence_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_type = 'public_website' AND (
    current_user <> 'postgres'
    OR NEW.captured_by_actor IS NOT NULL
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

-- Fix 2: zeya_finalize_direct_hire_preparation
-- Website evidence (source_type='public_website') should have NULL captured_by_actor.
-- System attribution via audit_events.actor_system.
DROP FUNCTION IF EXISTS public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
);

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
      NULL, v_session.id, v_item->>'sourceKey',
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
      ARRAY[]::text[], NULL,
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

  IF p_final_status = 'failed' AND v_evidence_count > 0 THEN
    p_final_status := 'partial';
    p_failure_code := NULL;
  END IF;

  IF p_final_status IN ('ready', 'partial') AND v_evidence_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'preparation result inconsistent';
  END IF;

  UPDATE public.direct_hire_onboarding_sessions AS session
  SET preparation_status = p_final_status,
      preparation_completed_at = now(),
      preparation_failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE NULL END,
      preparation_failure_code = p_failure_code,
      preparation_progress = p_progress,
      preparation_successful_page_count = p_successful_page_count,
      preparation_failed_page_count = p_failed_page_count
  WHERE session.id = v_session.id
  RETURNING session.preparation_status, session.preparation_attempt_count,
    session.preparation_progress, session.preparation_successful_page_count,
    session.preparation_failed_page_count, session.preparation_failure_code,
    session.preparation_completed_at;
END;
$$;

ALTER FUNCTION public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_direct_hire_preparation(
  uuid, uuid, uuid, text, text, jsonb, smallint, smallint, jsonb, jsonb
) TO service_role;

-- Fix 3: zeya_finalize_direct_hire_public_source
DROP FUNCTION IF EXISTS public.zeya_finalize_direct_hire_public_source(
  uuid, uuid, text, timestamptz, text, text, jsonb
);

CREATE FUNCTION public.zeya_finalize_direct_hire_public_source(
  p_owner_id uuid,
  p_source_id uuid,
  p_canonical_url text,
  p_retrieved_at timestamptz,
  p_content_hash text,
  p_extraction_version text,
  p_evidence jsonb
)
RETURNS TABLE(source_id uuid, source_status text, evidence_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.direct_hire_public_sources%ROWTYPE;
  v_item jsonb;
  v_evidence_id uuid;
  v_count integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_id::text, 0));
  SELECT * INTO v_source
  FROM public.direct_hire_public_sources AS source
  WHERE source.id = p_source_id AND source.owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'public source not found';
  END IF;
  IF v_source.status = 'complete' THEN
    SELECT count(*)::integer INTO v_count FROM public.evidence AS evidence
    WHERE evidence.registered_public_source_id = v_source.id;
    RETURN QUERY SELECT v_source.id, v_source.status, v_count;
    RETURN;
  END IF;
  IF v_source.status <> 'acquiring' OR p_canonical_url IS NULL
    OR p_content_hash IS NULL OR p_extraction_version IS NULL
    OR jsonb_typeof(p_evidence) <> 'array' OR jsonb_array_length(p_evidence) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid public source result';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_evidence) LOOP
    v_evidence_id := NULL;
    IF v_item->>'sourceKey' IS NULL OR v_item->>'rawStatement' IS NULL
      OR v_item->>'kind' NOT IN (
        'title', 'meta_description', 'primary_heading', 'registered_page_excerpt'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid public source evidence';
    END IF;
    INSERT INTO public.evidence (
      business_representation_id, source_type, source_description, raw_statement,
      affected_domains, captured_by_actor, direct_hire_onboarding_session_id,
      website_source_key, requested_source_url, canonical_source_url,
      source_retrieved_at, source_content_hash, source_page_type,
      source_evidence_kind, source_selector, extraction_method_version,
      registered_public_source_id, source_authority_type, source_authority_key
    ) VALUES (
      v_source.business_representation_id, 'public_website',
      'Owner-registered public source review', v_item->>'rawStatement',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains', '[]'::jsonb))),
      NULL, v_source.direct_hire_onboarding_session_id,
      v_item->>'sourceKey', v_source.submitted_url, p_canonical_url,
      p_retrieved_at, p_content_hash, 'registered_public_page', v_item->>'kind',
      v_item->>'selector', p_extraction_version, v_source.id,
      v_source.authority_type, v_source.authority_key
    )
    ON CONFLICT (direct_hire_onboarding_session_id, website_source_key)
      WHERE direct_hire_onboarding_session_id IS NOT NULL AND website_source_key IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NOT NULL THEN
      INSERT INTO public.audit_events (
        business_representation_id, event_type, evidence_id, actor_system, details
      ) VALUES (
        v_source.business_representation_id, 'evidence_created', v_evidence_id,
        'zeya_direct_hire_website_research',
        jsonb_build_object(
          'onboardingSessionId', v_source.direct_hire_onboarding_session_id,
          'registeredPublicSourceId', v_source.id,
          'sourceKey', v_item->>'sourceKey'
        )
      );
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_count FROM public.evidence AS evidence
  WHERE evidence.registered_public_source_id = v_source.id;
  IF v_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'public source produced no Evidence';
  END IF;

  UPDATE public.direct_hire_public_sources AS source
  SET status = 'complete', canonical_url = p_canonical_url,
      content_hash = p_content_hash, retrieved_at = p_retrieved_at,
      extraction_method_version = p_extraction_version,
      failure_code = NULL, completed_at = now(), updated_at = now()
  WHERE source.id = v_source.id;
  RETURN QUERY SELECT v_source.id, 'complete'::text, v_count;
END;
$$;

ALTER FUNCTION public.zeya_finalize_direct_hire_public_source(
  uuid, uuid, text, timestamptz, text, text, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_finalize_direct_hire_public_source(
  uuid, uuid, text, timestamptz, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_direct_hire_public_source(
  uuid, uuid, text, timestamptz, text, text, jsonb
) TO service_role;

-- Fix 4: zeya_persist_first_working_session_website_research
DROP FUNCTION IF EXISTS public.zeya_persist_first_working_session_website_research(
  uuid, uuid, text, text, smallint, smallint, jsonb, jsonb
);

CREATE FUNCTION public.zeya_persist_first_working_session_website_research(
  p_working_session_id uuid, p_lease_id uuid,
  p_final_status text, p_failure_code text,
  p_successful_page_count smallint, p_failed_page_count smallint,
  p_evidence jsonb, p_observations jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.direct_hire_working_sessions%ROWTYPE;
  v_item jsonb;
  v_evidence_id uuid;
  v_evidence_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='worker authorization required';
  END IF;
  IF p_final_status NOT IN ('ready','partial','failed')
    OR jsonb_typeof(coalesce(p_evidence,'[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_observations,'[]'::jsonb)) <> 'array'
    OR jsonb_array_length(coalesce(p_observations,'[]'::jsonb)) > 3
    OR p_successful_page_count NOT BETWEEN 0 AND 10
    OR p_failed_page_count NOT BETWEEN 0 AND 10
    OR (p_final_status='ready' AND p_failed_page_count <> 0)
    OR (p_final_status='partial' AND p_failed_page_count = 0)
    OR (p_final_status='failed' AND p_failure_code IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid preparation result';
  END IF;

  SELECT * INTO v_session FROM public.direct_hire_working_sessions
  WHERE id=p_working_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='working session not found';
  END IF;
  IF v_session.status <> 'scheduled' OR v_session.preparation_status <> 'running'
    OR v_session.preparation_lease_id <> p_lease_id
    OR v_session.preparation_lease_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='preparation lease conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_hire_onboarding_sessions AS onboarding
    JOIN public.businesses AS business ON business.id=onboarding.business_id
    JOIN public.business_representations AS representation
      ON representation.id=onboarding.business_representation_id
    WHERE onboarding.id=v_session.direct_hire_onboarding_session_id
      AND onboarding.owner_id=v_session.owner_id
      AND onboarding.business_id=v_session.business_id
      AND onboarding.business_representation_id=v_session.business_representation_id
      AND onboarding.onboarding_state='employment_accepted'
      AND onboarding.induction_state='preparation_pending'
      AND business.user_id=v_session.owner_id
      AND representation.business_id=v_session.business_id
      AND representation.user_id=v_session.owner_id
      AND representation.current_version_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.representation_formation_sessions AS formation
    WHERE formation.business_representation_id=v_session.business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='owner journey conflict';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_evidence,'[]'::jsonb)) LOOP
    IF v_item->>'sourceKey' IS NULL OR v_item->>'rawStatement' IS NULL
      OR v_item->>'requestedUrl' IS NULL OR v_item->>'finalUrl' IS NULL
      OR v_item->>'retrievedAt' IS NULL OR v_item->>'documentContentHash' IS NULL
      OR v_item->>'pageType' NOT IN ('homepage','about','products_services','pricing','customers','case_studies','testimonials','industries','methodology','team','faq','contact','resources')
      OR v_item->>'kind' NOT IN ('title','meta_description','primary_heading','main_excerpt','about_excerpt','products_services_excerpt','explicit_absence','section_text','section_list','pricing_block','testimonial','quantitative_claim') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid website evidence';
    END IF;
    INSERT INTO public.evidence (
      business_representation_id,source_type,source_description,raw_statement,
      affected_domains,captured_by_actor,direct_hire_onboarding_session_id,
      website_source_key,requested_source_url,canonical_source_url,source_retrieved_at,
      source_content_hash,source_page_type,source_evidence_kind,source_selector,
      extraction_method_version
    ) VALUES (
      v_session.business_representation_id,'public_website',
      'Bounded Direct Hire public website review',v_item->>'rawStatement',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains','[]'::jsonb))),
      NULL,v_session.direct_hire_onboarding_session_id,
      v_item->>'sourceKey',v_item->>'requestedUrl',v_item->>'finalUrl',
      (v_item->>'retrievedAt')::timestamptz,v_item->>'documentContentHash',
      v_item->>'pageType',v_item->>'kind',v_item->>'selector',v_item->>'extractionVersion'
    ) ON CONFLICT (direct_hire_onboarding_session_id,website_source_key)
      WHERE direct_hire_onboarding_session_id IS NOT NULL AND website_source_key IS NOT NULL
      DO NOTHING RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NULL THEN
      SELECT evidence.id INTO v_evidence_id FROM public.evidence AS evidence
      WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
        AND evidence.business_representation_id=v_session.business_representation_id
        AND evidence.website_source_key=v_item->>'sourceKey';
    ELSE
      INSERT INTO public.audit_events (business_representation_id,event_type,evidence_id,actor_system,details)
      VALUES (v_session.business_representation_id,'evidence_created',v_evidence_id,
        'zeya_direct_hire_website_research',jsonb_build_object(
          'onboardingSessionId',v_session.direct_hire_onboarding_session_id,
          'workingSessionId',v_session.id,'sourceKey',v_item->>'sourceKey'));
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_observations,'[]'::jsonb)) LOOP
    IF v_item->>'observationKey' IS NULL OR v_item->>'evidenceSourceKey' IS NULL
      OR v_item->>'interpretedMeaning' IS NULL
      OR (v_item->>'confidence')::integer NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid website observation';
    END IF;
    SELECT evidence.id INTO v_evidence_id FROM public.evidence AS evidence
    WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
      AND evidence.business_representation_id=v_session.business_representation_id
      AND evidence.website_source_key=v_item->>'evidenceSourceKey';
    IF v_evidence_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='observation evidence missing';
    END IF;
    INSERT INTO public.observations (
      business_representation_id,evidence_id,interpreted_meaning,
      confidence_in_interpretation,affected_domains,affected_elements,
      created_by_actor,website_observation_key
    ) VALUES (
      v_session.business_representation_id,v_evidence_id,v_item->>'interpretedMeaning',
      (v_item->>'confidence')::smallint,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_item->'affectedDomains','[]'::jsonb))),
      ARRAY[]::text[],NULL,v_item->>'observationKey'
    ) ON CONFLICT (business_representation_id,website_observation_key)
      WHERE website_observation_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_evidence_id;
    IF v_evidence_id IS NOT NULL THEN
      INSERT INTO public.audit_events (business_representation_id,event_type,observation_id,actor_system,details)
      VALUES (v_session.business_representation_id,'observation_created',v_evidence_id,
        'zeya_direct_hire_website_research',jsonb_build_object(
          'onboardingSessionId',v_session.direct_hire_onboarding_session_id,
          'workingSessionId',v_session.id,'observationKey',v_item->>'observationKey'));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_evidence_count FROM public.evidence AS evidence
  WHERE evidence.direct_hire_onboarding_session_id=v_session.direct_hire_onboarding_session_id
    AND evidence.business_representation_id=v_session.business_representation_id
    AND evidence.source_type='public_website';
  IF p_final_status='failed' AND v_evidence_count > 0 THEN p_final_status := 'partial'; END IF;
  IF p_final_status IN ('ready','partial') AND v_evidence_count=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='preparation result inconsistent';
  END IF;
  UPDATE public.direct_hire_working_sessions
  SET preparation_website_persisted_at=now()
  WHERE id=v_session.id;
  RETURN p_final_status;
END;
$$;

ALTER FUNCTION public.zeya_persist_first_working_session_website_research(
  uuid, uuid, text, text, smallint, smallint, jsonb, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_persist_first_working_session_website_research(
  uuid, uuid, text, text, smallint, smallint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_first_working_session_website_research(
  uuid, uuid, text, text, smallint, smallint, jsonb, jsonb
) TO service_role;

-- Fix 5: zeya_apply_hypothesis_owner_action
-- Owner corrections create evidence with owner UUID in captured_by_actor
DROP FUNCTION IF EXISTS public.zeya_apply_hypothesis_owner_action(
  uuid, uuid, public.approval_decision_type, uuid, text
);

CREATE FUNCTION public.zeya_apply_hypothesis_owner_action(
  p_owner_id UUID,
  p_hypothesis_id UUID,
  p_decision public.approval_decision_type,
  p_operation_id UUID,
  p_correction_text TEXT DEFAULT NULL
)
RETURNS TABLE (
  operation_id UUID,
  hypothesis_id UUID,
  hypothesis_version BIGINT,
  decision public.approval_decision_type,
  verification_id UUID,
  verification_sequence BIGINT,
  correction_evidence_id UUID,
  successor_request_trace_id VARCHAR(64),
  operation_state TEXT,
  replayed BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_initial_hypothesis public.hypotheses%ROWTYPE;
  v_hypothesis public.hypotheses%ROWTYPE;
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_existing_operation public.hypothesis_owner_operations%ROWTYPE;
  v_existing_verification public.hypothesis_verifications%ROWTYPE;
  v_current_hypothesis_id UUID;
  v_normalized_correction TEXT;
  v_transient_payload JSONB;
  v_request_hash TEXT;
  v_successor_trace TEXT;
  v_verification_sequence BIGINT;
  v_verification_id UUID;
  v_correction_evidence_id UUID;
  v_operation_created_at TIMESTAMPTZ;
  v_operation_state TEXT;
  v_successor_count BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_owner_id IS NULL
     OR p_hypothesis_id IS NULL
     OR p_decision IS NULL
     OR p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner action';
  END IF;

  IF p_decision = 'rejected'::public.approval_decision_type THEN
    v_normalized_correction := pg_catalog.btrim(p_correction_text);
    IF v_normalized_correction IS NULL
       OR pg_catalog.char_length(v_normalized_correction) NOT BETWEEN 1 AND 4000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid correction';
    END IF;
  ELSE
    IF p_correction_text IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'correction is not allowed for this decision';
    END IF;
    v_normalized_correction := NULL;
  END IF;

  v_transient_payload := pg_catalog.jsonb_build_object(
    'hypothesisId', p_hypothesis_id,
    'decision', p_decision::TEXT,
    'correctionText', v_normalized_correction
  );
  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_transient_payload::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::TEXT, 0)
  );

  SELECT h.*
  INTO v_initial_hypothesis
  FROM public.hypotheses AS h
  WHERE h.id = p_hypothesis_id
    AND h.owner_id = p_owner_id;

  IF v_initial_hypothesis.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.direct_hire_onboarding_sessions AS s
  WHERE s.id = v_initial_hypothesis.direct_hire_onboarding_session_id
    AND s.owner_id = p_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT h.*
  INTO v_hypothesis
  FROM public.hypotheses AS h
  WHERE h.id = p_hypothesis_id
    AND h.owner_id = p_owner_id
    AND h.business_id = v_session.business_id
    AND h.business_representation_id = v_session.business_representation_id
    AND h.direct_hire_onboarding_session_id = v_session.id
  FOR UPDATE;

  IF v_hypothesis.id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.businesses AS b
       WHERE b.id = v_hypothesis.business_id
         AND b.user_id = p_owner_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.business_representations AS br
       WHERE br.id = v_hypothesis.business_representation_id
         AND br.business_id = v_hypothesis.business_id
         AND br.user_id = p_owner_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT op.*
  INTO v_existing_operation
  FROM public.hypothesis_owner_operations AS op
  WHERE op.operation_id = p_operation_id;

  IF v_existing_operation.operation_id IS NOT NULL THEN
    IF v_existing_operation.owner_id IS DISTINCT FROM p_owner_id
       OR v_existing_operation.hypothesis_id IS DISTINCT FROM p_hypothesis_id
       OR v_existing_operation.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'operation_conflict';
    END IF;

    SELECT hv.*
    INTO v_existing_verification
    FROM public.hypothesis_verifications AS hv
    WHERE hv.id = v_existing_operation.verification_id
      AND hv.hypothesis_id = v_existing_operation.hypothesis_id
      AND hv.verifier_user_id = v_existing_operation.owner_id;

    IF v_existing_verification.id IS NULL
       OR v_existing_verification.decision IS DISTINCT FROM v_existing_operation.decision THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'operation lineage invalid';
    END IF;

    IF v_existing_operation.decision = 'rejected'::public.approval_decision_type THEN
      SELECT pg_catalog.count(*)
      INTO v_successor_count
      FROM public.hypotheses AS replay_successor
      WHERE replay_successor.request_trace_id = v_existing_operation.successor_request_trace_id;

      IF v_successor_count > 1 OR EXISTS (
        SELECT 1
        FROM public.hypotheses AS invalid_successor
        WHERE invalid_successor.request_trace_id = v_existing_operation.successor_request_trace_id
          AND (
            invalid_successor.owner_id IS DISTINCT FROM v_existing_operation.owner_id
            OR invalid_successor.business_id IS DISTINCT FROM v_existing_operation.business_id
            OR invalid_successor.business_representation_id IS DISTINCT FROM v_existing_operation.business_representation_id
            OR invalid_successor.direct_hire_onboarding_session_id IS DISTINCT FROM v_existing_operation.direct_hire_onboarding_session_id
            OR invalid_successor.constitutional_domain IS DISTINCT FROM v_existing_operation.constitutional_domain
            OR invalid_successor.previous_hypothesis_id IS DISTINCT FROM v_existing_operation.hypothesis_id
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor lineage invalid';
      END IF;
      v_operation_state := CASE WHEN v_successor_count = 1 THEN 'complete' ELSE 'reasoning_pending' END;
    ELSE
      v_operation_state := 'accepted';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_operation.operation_id AS operation_id,
      v_existing_operation.hypothesis_id AS hypothesis_id,
      v_hypothesis.hypothesis_version AS hypothesis_version,
      v_existing_operation.decision AS decision,
      v_existing_operation.verification_id AS verification_id,
      v_existing_verification.verification_sequence AS verification_sequence,
      v_existing_operation.correction_evidence_id AS correction_evidence_id,
      v_existing_operation.successor_request_trace_id AS successor_request_trace_id,
      v_operation_state AS operation_state,
      TRUE AS replayed,
      v_existing_operation.created_at AS created_at;
    RETURN;
  END IF;

  SELECT current_h.id
  INTO v_current_hypothesis_id
  FROM public.hypotheses AS current_h
  WHERE current_h.direct_hire_onboarding_session_id = v_session.id
    AND current_h.constitutional_domain = v_hypothesis.constitutional_domain
  ORDER BY current_h.hypothesis_version DESC
  LIMIT 1;

  IF v_current_hypothesis_id IS DISTINCT FROM v_hypothesis.id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'stale_hypothesis';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hypothesis_owner_operations AS pending_op
    WHERE pending_op.hypothesis_id = v_hypothesis.id
      AND pending_op.decision = 'rejected'::public.approval_decision_type
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'correction_pending';
  END IF;

  IF p_decision = 'rejected'::public.approval_decision_type THEN
    INSERT INTO public.evidence AS correction_evidence (
      business_representation_id,
      direct_hire_onboarding_session_id,
      source_type,
      source_description,
      raw_statement,
      affected_domains,
      captured_by_actor
    ) VALUES (
      v_hypothesis.business_representation_id,
      v_hypothesis.direct_hire_onboarding_session_id,
      'manual'::public.evidence_source_type,
      'Owner correction to hypothesis',
      v_normalized_correction,
      ARRAY[v_hypothesis.constitutional_domain]::TEXT[],
      p_owner_id
    )
    RETURNING correction_evidence.id INTO v_correction_evidence_id;

    v_successor_trace := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'hypothesis-owner-correction-v1'
          || '|'
          || p_operation_id::TEXT
          || '|'
          || v_hypothesis.constitutional_domain,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  ELSE
    v_correction_evidence_id := NULL;
    v_successor_trace := NULL;
  END IF;

  SELECT pg_catalog.coalesce(pg_catalog.max(hv.verification_sequence), 0) + 1
  INTO v_verification_sequence
  FROM public.hypothesis_verifications AS hv
  WHERE hv.hypothesis_id = v_hypothesis.id;

  INSERT INTO public.hypothesis_verifications AS inserted_verification (
    hypothesis_id,
    verification_sequence,
    decision,
    verification_reasoning,
    verifier_user_id,
    created_at
  ) VALUES (
    v_hypothesis.id,
    v_verification_sequence,
    p_decision,
    NULL,
    p_owner_id,
    pg_catalog.now()
  )
  RETURNING inserted_verification.id INTO v_verification_id;

  INSERT INTO public.hypothesis_owner_operations AS inserted_operation (
    operation_id,
    owner_id,
    business_id,
    business_representation_id,
    direct_hire_onboarding_session_id,
    hypothesis_id,
    constitutional_domain,
    decision,
    request_hash,
    correction_evidence_id,
    verification_id,
    successor_request_trace_id
  ) VALUES (
    p_operation_id,
    p_owner_id,
    v_hypothesis.business_id,
    v_hypothesis.business_representation_id,
    v_hypothesis.direct_hire_onboarding_session_id,
    v_hypothesis.id,
    v_hypothesis.constitutional_domain,
    p_decision,
    v_request_hash,
    v_correction_evidence_id,
    v_verification_id,
    v_successor_trace
  )
  RETURNING inserted_operation.created_at INTO v_operation_created_at;

  IF p_decision = 'rejected'::public.approval_decision_type THEN
    v_operation_state := 'reasoning_pending';
  ELSE
    v_operation_state := 'accepted';
  END IF;

  RETURN QUERY
  SELECT
    p_operation_id AS operation_id,
    v_hypothesis.id AS hypothesis_id,
    v_hypothesis.hypothesis_version AS hypothesis_version,
    p_decision AS decision,
    v_verification_id AS verification_id,
    v_verification_sequence AS verification_sequence,
    v_correction_evidence_id AS correction_evidence_id,
    v_successor_trace AS successor_request_trace_id,
    v_operation_state AS operation_state,
    FALSE AS replayed,
    v_operation_created_at AS created_at;
END;
$$;

ALTER FUNCTION public.zeya_apply_hypothesis_owner_action(
  uuid, uuid, public.approval_decision_type, uuid, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  uuid, uuid, public.approval_decision_type, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  uuid, uuid, public.approval_decision_type, uuid, text
) TO service_role;

-- Fix 6: zeya_record_direct_hire_formation_answer
-- Owner formation decisions create evidence with owner UUID
DROP FUNCTION IF EXISTS public.zeya_record_direct_hire_formation_answer(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid
);

CREATE FUNCTION public.zeya_record_direct_hire_formation_answer(
  p_owner_id uuid,p_run_id uuid,p_agenda_item_id uuid,p_idempotency_key uuid,p_owner_text text,
  p_classification text,p_resolution_state text,p_decision_key text DEFAULT NULL,p_decision_value jsonb DEFAULT NULL,
  p_hypothesis_operation_id uuid DEFAULT NULL
) RETURNS TABLE(owner_turn_id uuid,resolution_event_id uuid,replayed boolean,complete boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE;
  v_existing public.direct_hire_formation_conversation_turns%ROWTYPE; v_turn_id uuid; v_event_id uuid; v_evidence_id uuid; v_decision_id uuid;
  v_sequence integer; v_followups integer; v_next public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE; v_complete boolean:=false; v_next_text text; v_required_scope text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_owner_id IS NULL OR p_run_id IS NULL OR p_agenda_item_id IS NULL OR p_idempotency_key IS NULL
    OR char_length(btrim(coalesce(p_owner_text,''))) NOT BETWEEN 1 AND 4000
    OR p_classification NOT IN ('confirm','correct','authority_grant','authority_restriction','commercial_decision','defer','unclear','nonresponsive')
    OR p_resolution_state NOT IN ('resolved','deferred','still_unresolved','superseded_by_prior_answer') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid conversation answer'; END IF;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status<>'active' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation is not active'; END IF;
  SELECT * INTO v_existing FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id AND idempotency_key=p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.agenda_item_id IS DISTINCT FROM p_agenda_item_id OR v_existing.owner_safe_text IS DISTINCT FROM btrim(p_owner_text) THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='answer idempotency conflict'; END IF;
    SELECT id INTO v_event_id FROM public.direct_hire_formation_agenda_resolution_events WHERE owner_turn_id=v_existing.id;
    RETURN QUERY SELECT v_existing.id,v_event_id,true,v_run.status='completed'; RETURN;
  END IF;
  SELECT * INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE id=p_agenda_item_id AND formation_session_id=v_run.formation_session_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='agenda item not found'; END IF;
  SELECT count(*) INTO v_followups FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=p_agenda_item_id AND e.resolution_state='still_unresolved';
  IF p_resolution_state='still_unresolved' AND v_followups>=1 THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded follow-up exhausted'; END IF;
  IF p_classification IN ('confirm','correct','defer') AND cardinality(v_item.source_hypothesis_ids)>0 THEN
    IF p_hypothesis_operation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.hypothesis_owner_operations op WHERE op.operation_id=p_hypothesis_operation_id AND op.owner_id=p_owner_id AND op.hypothesis_id=ANY(v_item.source_hypothesis_ids)
      AND op.decision=CASE p_classification WHEN 'confirm' THEN 'approved'::public.approval_decision_type WHEN 'correct' THEN 'rejected'::public.approval_decision_type ELSE 'deferred'::public.approval_decision_type END) THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed hypothesis operation required'; END IF;
  END IF;
  SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
  INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,idempotency_key)
    VALUES(p_run_id,v_sequence,p_agenda_item_id,'owner',btrim(p_owner_text),'owner_answer',p_idempotency_key) RETURNING id INTO v_turn_id;
  IF p_classification IN ('authority_grant','authority_restriction','commercial_decision') THEN
    INSERT INTO public.evidence(business_representation_id,direct_hire_onboarding_session_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)
    SELECT v_run.business_representation_id,h.direct_hire_onboarding_session_id,'manual'::public.evidence_source_type,'Owner answer in governed Formation text session',btrim(p_owner_text),
      ARRAY[coalesce(v_item.constitutional_domain,CASE WHEN v_item.category='authority' THEN 'authorityBoundaries' ELSE 'clarificationsNeeded' END)]::text[],p_owner_id
    FROM public.direct_hire_first_working_session_formation_handoffs h WHERE h.id=v_run.formation_handoff_id RETURNING id INTO v_evidence_id;
    IF p_decision_key IS NULL OR p_decision_value IS NULL OR jsonb_typeof(p_decision_value)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='structured Formation decision required'; END IF;
    INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
    VALUES(v_run.formation_session_id,p_run_id,p_agenda_item_id,v_turn_id,v_evidence_id,CASE WHEN p_classification LIKE 'authority_%' THEN 'authority' ELSE 'commercial' END,p_decision_key,
      CASE p_classification WHEN 'authority_grant' THEN 'granted' WHEN 'authority_restriction' THEN 'restricted' ELSE 'decided' END,p_decision_value,true) RETURNING id INTO v_decision_id;
  END IF;
  INSERT INTO public.direct_hire_formation_agenda_resolution_events(run_id,agenda_item_id,owner_turn_id,resolution_state,answer_classification,evidence_id,hypothesis_operation_id,formation_decision_id,actor_owner_id)
    VALUES(p_run_id,p_agenda_item_id,v_turn_id,p_resolution_state,p_classification,v_evidence_id,p_hypothesis_operation_id,v_decision_id,p_owner_id) RETURNING id INTO v_event_id;
  SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
  SELECT * INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items WHERE formation_session_id=v_run.formation_session_id ORDER BY sequence ASC LIMIT 1 OFFSET v_sequence-1;
  IF v_next.id IS NULL THEN v_complete:=true; END IF;
  UPDATE public.direct_hire_formation_conversation_runs SET status=CASE WHEN v_complete THEN 'completed' ELSE status END,completed_at=CASE WHEN v_complete THEN now() ELSE NULL END WHERE id=p_run_id;
  RETURN QUERY SELECT v_turn_id,v_event_id,false,v_complete;
END;
$$;

ALTER FUNCTION public.zeya_record_direct_hire_formation_answer(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_record_direct_hire_formation_answer(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_record_direct_hire_formation_answer(
  uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid
) TO service_role;

-- Fix 7: zeya_record_formation_owner_correction
-- Owner corrections create evidence with owner UUID in captured_by_actor
DROP FUNCTION IF EXISTS public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
);

CREATE FUNCTION public.zeya_record_formation_owner_correction(
  p_session_id uuid,
  p_proposal_id uuid,
  p_owner_id uuid,
  p_request_key uuid,
  p_raw_statement text
)
RETURNS TABLE (evidence_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.representation_formation_sessions%ROWTYPE;
  v_existing_id uuid;
  v_evidence_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_session_id IS NULL OR p_proposal_id IS NULL OR p_owner_id IS NULL
    OR p_request_key IS NULL OR p_raw_statement IS NULL
    OR char_length(btrim(p_raw_statement)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid correction parameters';
  END IF;

  SELECT formation.* INTO v_session
  FROM public.representation_formation_sessions AS formation
  WHERE formation.id = p_session_id
    AND formation.owner_id = p_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'formation session not found';
  END IF;

  SELECT evidence.id INTO v_existing_id
  FROM public.evidence AS evidence
  WHERE evidence.source_formation_session_id = p_session_id
    AND evidence.source_correction_request_key = p_request_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    WHERE proposal.id = p_proposal_id
      AND proposal.formation_session_id = p_session_id
      AND proposal.business_representation_id = v_session.business_representation_id
      AND proposal.status = 'draft'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'formation summary is not current';
  END IF;

  INSERT INTO public.evidence (
    business_representation_id,
    source_type,
    source_description,
    raw_statement,
    affected_domains,
    captured_by_actor,
    source_formation_session_id,
    source_formation_proposal_id,
    source_correction_request_key
  ) VALUES (
    v_session.business_representation_id,
    'conversation'::public.evidence_source_type,
    'Owner correction during Formation review',
    btrim(p_raw_statement),
    ARRAY[]::text[],
    p_owner_id,
    p_session_id,
    p_proposal_id,
    p_request_key
  )
  RETURNING id INTO v_evidence_id;

  UPDATE public.representation_proposals AS proposal
  SET status = 'superseded', status_updated_at = pg_catalog.now()
  WHERE proposal.id = p_proposal_id
    AND proposal.status = 'draft';

  INSERT INTO public.audit_events (
    business_representation_id,
    event_type,
    evidence_id,
    actor_user_id,
    details
  ) VALUES (
    v_session.business_representation_id,
    'evidence_created',
    v_evidence_id,
    p_owner_id,
    pg_catalog.jsonb_build_object(
      'source', 'formation_owner_correction',
      'formationSessionId', p_session_id,
      'proposalId', p_proposal_id
    )
  );

  RETURN QUERY SELECT v_evidence_id, false;
END;
$$;

ALTER FUNCTION public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_record_formation_owner_correction(
  uuid, uuid, uuid, uuid, text
) TO service_role;

COMMIT;
