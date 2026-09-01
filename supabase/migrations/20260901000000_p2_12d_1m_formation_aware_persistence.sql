-- P2.12D.1m: historical Formation is not a conflict for a governed successor
-- preparation. The canonical Representation boundary remains authoritative.
CREATE OR REPLACE FUNCTION public.zeya_persist_first_working_session_website_research(
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
