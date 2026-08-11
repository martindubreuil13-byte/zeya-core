-- M0/M1: governed registered public sources and source-aware Evidence provenance.

CREATE TABLE public.direct_hire_public_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id),
  direct_hire_onboarding_session_id uuid NOT NULL REFERENCES public.direct_hire_onboarding_sessions(id),
  submitted_url text NOT NULL,
  normalized_url text NOT NULL,
  canonical_url text,
  source_kind text NOT NULL DEFAULT 'owner_supplied_public_url' CHECK (
    source_kind IN ('owner_supplied_public_url')
  ),
  authority_type text NOT NULL CHECK (
    authority_type IN ('first_party_company', 'customer', 'partner', 'independent_third_party', 'unknown')
  ),
  authority_key text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (
    status IN (
      'registered', 'validating', 'ready_to_acquire', 'acquiring', 'acquired',
      'extracted', 'complete', 'unsupported', 'permission_required',
      'robots_disallowed', 'authentication_required', 'temporarily_unavailable',
      'invalid', 'failed_retryable', 'failed_permanent'
    )
  ),
  failure_code text,
  content_hash text,
  retrieved_at timestamptz,
  extraction_method_version text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (direct_hire_onboarding_session_id, normalized_url)
);

CREATE INDEX direct_hire_public_sources_scope_idx
  ON public.direct_hire_public_sources (
    owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id
  );

-- Preserve existing Direct Hire journeys without treating legacy URL strings as
-- acquired content. Safe ordinary HTTPS locations are queued; restricted
-- platforms remain registered but explicitly unacquired.
INSERT INTO public.direct_hire_public_sources (
  owner_id, business_id, business_representation_id,
  direct_hire_onboarding_session_id, submitted_url, normalized_url,
  authority_type, authority_key, status, failure_code
)
SELECT
  session.owner_id,
  session.business_id,
  session.business_representation_id,
  session.id,
  evidence.induction_material_url,
  evidence.induction_material_url,
  'unknown',
  'legacy-unclassified-source:' || evidence.id::text,
  CASE
    WHEN lower(evidence.induction_material_url) ~ '^https://([^/]+\.)?(linkedin|facebook|instagram|youtube|x|twitter|tiktok)\.com(/|$)'
      THEN 'authentication_required'
    ELSE 'registered'
  END,
  CASE
    WHEN lower(evidence.induction_material_url) ~ '^https://([^/]+\.)?(linkedin|facebook|instagram|youtube|x|twitter|tiktok)\.com(/|$)'
      THEN 'restricted_platform_not_acquired'
    ELSE NULL
  END
FROM public.evidence AS evidence
JOIN public.direct_hire_onboarding_sessions AS session
  ON session.id = evidence.direct_hire_onboarding_session_id
WHERE evidence.source_type = 'direct_hire_induction'
  AND evidence.induction_material_type = 'link'
  AND evidence.induction_material_url ~ '^https://'
ON CONFLICT (direct_hire_onboarding_session_id, normalized_url) DO NOTHING;

ALTER TABLE public.direct_hire_public_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY direct_hire_public_sources_owner_read
  ON public.direct_hire_public_sources
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

REVOKE ALL ON TABLE public.direct_hire_public_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.direct_hire_public_sources TO authenticated;
GRANT ALL ON TABLE public.direct_hire_public_sources TO service_role;

ALTER TABLE public.evidence
  ADD COLUMN registered_public_source_id uuid
    REFERENCES public.direct_hire_public_sources(id),
  ADD COLUMN source_authority_type text CHECK (
    source_authority_type IS NULL OR source_authority_type IN (
      'owner', 'first_party_company', 'customer', 'partner',
      'independent_third_party', 'unknown'
    )
  ),
  ADD COLUMN source_authority_key text;

ALTER TABLE public.evidence
  DROP CONSTRAINT IF EXISTS evidence_source_page_type_check;

ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_source_page_type_check CHECK (
    source_page_type IS NULL OR source_page_type IN (
      'homepage', 'about', 'products_services', 'registered_public_page'
    )
  );

ALTER TABLE public.evidence
  DROP CONSTRAINT IF EXISTS evidence_source_evidence_kind_check;

ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_source_evidence_kind_check CHECK (
    source_evidence_kind IS NULL OR source_evidence_kind IN (
      'title', 'meta_description', 'primary_heading', 'main_excerpt',
      'about_excerpt', 'products_services_excerpt', 'registered_page_excerpt',
      'explicit_absence'
    )
  );

CREATE INDEX evidence_registered_public_source_idx
  ON public.evidence (registered_public_source_id)
  WHERE registered_public_source_id IS NOT NULL;

CREATE FUNCTION public.zeya_register_direct_hire_public_source(
  p_owner_id uuid,
  p_onboarding_session_id uuid,
  p_submitted_url text,
  p_normalized_url text,
  p_authority_type text,
  p_authority_key text
)
RETURNS TABLE(source_id uuid, source_status text, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_source public.direct_hire_public_sources%ROWTYPE;
BEGIN
  IF p_submitted_url IS NULL OR p_normalized_url IS NULL
    OR p_authority_type NOT IN (
      'first_party_company', 'customer', 'partner', 'independent_third_party', 'unknown'
    ) OR p_authority_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid public source registration';
  END IF;

  SELECT * INTO v_session
  FROM public.direct_hire_onboarding_sessions AS session
  WHERE session.id = p_onboarding_session_id
    AND session.owner_id = p_owner_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'direct hire session not found';
  END IF;

  INSERT INTO public.direct_hire_public_sources (
    owner_id, business_id, business_representation_id,
    direct_hire_onboarding_session_id, submitted_url, normalized_url,
    authority_type, authority_key, status
  ) VALUES (
    v_session.owner_id, v_session.business_id, v_session.business_representation_id,
    v_session.id, p_submitted_url, p_normalized_url,
    p_authority_type, p_authority_key, 'registered'
  )
  ON CONFLICT (direct_hire_onboarding_session_id, normalized_url) DO NOTHING
  RETURNING * INTO v_source;

  IF FOUND THEN
    RETURN QUERY SELECT v_source.id, v_source.status, true;
    RETURN;
  END IF;

  SELECT * INTO STRICT v_source
  FROM public.direct_hire_public_sources AS source
  WHERE source.direct_hire_onboarding_session_id = v_session.id
    AND source.normalized_url = p_normalized_url;
  RETURN QUERY SELECT v_source.id, v_source.status, false;
END;
$$;

CREATE FUNCTION public.zeya_claim_direct_hire_public_source(
  p_owner_id uuid,
  p_source_id uuid,
  p_refresh_complete boolean DEFAULT false
)
RETURNS TABLE(
  source_id uuid,
  submitted_url text,
  source_status text,
  authority_type text,
  authority_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.direct_hire_public_sources%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_id::text, 0));
  SELECT * INTO v_source
  FROM public.direct_hire_public_sources AS source
  WHERE source.id = p_source_id AND source.owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'public source not found';
  END IF;
  IF v_source.status = 'complete' AND NOT p_refresh_complete THEN
    RETURN QUERY SELECT v_source.id, v_source.submitted_url, v_source.status,
      v_source.authority_type, v_source.authority_key;
    RETURN;
  END IF;
  IF v_source.status NOT IN (
    'registered', 'ready_to_acquire', 'temporarily_unavailable', 'failed_retryable'
  ) AND NOT (v_source.status = 'complete' AND p_refresh_complete) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'public source not acquirable';
  END IF;
  UPDATE public.direct_hire_public_sources AS source
  SET status = 'acquiring', attempt_count = source.attempt_count + 1,
      failure_code = NULL, updated_at = now()
  WHERE source.id = v_source.id
  RETURNING * INTO v_source;
  RETURN QUERY SELECT v_source.id, v_source.submitted_url, v_source.status,
    v_source.authority_type, v_source.authority_key;
END;
$$;

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
      'zeya_direct_hire_website_research', v_source.direct_hire_onboarding_session_id,
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

CREATE FUNCTION public.zeya_fail_direct_hire_public_source(
  p_owner_id uuid,
  p_source_id uuid,
  p_status text,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN (
    'unsupported', 'permission_required', 'robots_disallowed',
    'authentication_required', 'temporarily_unavailable', 'invalid',
    'failed_retryable', 'failed_permanent'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid public source failure status';
  END IF;
  UPDATE public.direct_hire_public_sources AS source
  SET status = p_status, failure_code = p_failure_code, updated_at = now()
  WHERE source.id = p_source_id AND source.owner_id = p_owner_id
    AND source.status IN ('registered', 'ready_to_acquire', 'acquiring', 'temporarily_unavailable', 'failed_retryable');
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'public source failure transition rejected';
  END IF;
END;
$$;

ALTER FUNCTION public.zeya_register_direct_hire_public_source(uuid,uuid,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_claim_direct_hire_public_source(uuid,uuid,boolean) OWNER TO postgres;
ALTER FUNCTION public.zeya_finalize_direct_hire_public_source(uuid,uuid,text,timestamptz,text,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.zeya_fail_direct_hire_public_source(uuid,uuid,text,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.zeya_register_direct_hire_public_source(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_claim_direct_hire_public_source(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_finalize_direct_hire_public_source(uuid,uuid,text,timestamptz,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_fail_direct_hire_public_source(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.zeya_register_direct_hire_public_source(uuid,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_claim_direct_hire_public_source(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_direct_hire_public_source(uuid,uuid,text,timestamptz,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_fail_direct_hire_public_source(uuid,uuid,text,text) TO service_role;
