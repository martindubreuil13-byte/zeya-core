BEGIN;

-- Direct Hire is an authenticated, pre-Formation lifecycle. It deliberately
-- does not reuse Public Experience records and does not create Evidence,
-- Formation sessions, proposals, approvals, or Representation Versions.
CREATE TABLE public.direct_hire_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_representation_id uuid NOT NULL
    REFERENCES public.business_representations(id) ON DELETE CASCADE,
  owner_relationship_name text NOT NULL CHECK (
    char_length(owner_relationship_name) BETWEEN 1 AND 120
  ),
  website_url text NOT NULL CHECK (
    char_length(website_url) BETWEEN 1 AND 2048
    AND website_url ~* '^https?://'
  ),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  growth_priority text NOT NULL CHECK (
    char_length(growth_priority) BETWEEN 1 AND 500
  ),
  onboarding_state text NOT NULL DEFAULT 'preparation' CHECK (
    onboarding_state = 'preparation'
  ),
  preparation_status text NOT NULL DEFAULT 'queued' CHECK (
    preparation_status = 'queued'
  ),
  profile_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_hire_one_session_per_representation
    UNIQUE (business_representation_id)
);

CREATE INDEX direct_hire_onboarding_owner_idx
  ON public.direct_hire_onboarding_sessions(owner_id);
CREATE INDEX direct_hire_onboarding_business_idx
  ON public.direct_hire_onboarding_sessions(business_id);

CREATE FUNCTION public.zeya_direct_hire_onboarding_validate_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = NEW.business_id
      AND business.user_id = NEW.owner_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.business_representations AS representation
    WHERE representation.id = NEW.business_representation_id
      AND representation.business_id = NEW.business_id
      AND representation.user_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'direct hire onboarding lineage mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_onboarding_validate_lineage
  BEFORE INSERT OR UPDATE OF owner_id, business_id, business_representation_id
  ON public.direct_hire_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_direct_hire_onboarding_validate_lineage();

CREATE FUNCTION public.zeya_direct_hire_onboarding_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER direct_hire_onboarding_updated_at
  BEFORE UPDATE ON public.direct_hire_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_direct_hire_onboarding_updated_at();

ALTER TABLE public.direct_hire_onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY direct_hire_owner_select
  ON public.direct_hire_onboarding_sessions
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

REVOKE ALL ON TABLE public.direct_hire_onboarding_sessions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.direct_hire_onboarding_sessions TO authenticated;

REVOKE ALL ON FUNCTION public.zeya_direct_hire_onboarding_validate_lineage()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_direct_hire_onboarding_updated_at()
  FROM PUBLIC, anon, authenticated;

-- Atomic profile persistence and clean-owner provisioning. The caller cannot
-- supply an owner, Business, or Representation identifier; all lineage is
-- derived from auth.uid() while the auth user row serializes concurrent calls.
CREATE FUNCTION public.zeya_upsert_direct_hire_profile(
  p_owner_relationship_name text,
  p_business_name text,
  p_website_url text,
  p_phone_e164 text,
  p_growth_priority text
)
RETURNS TABLE (
  onboarding_session_id uuid,
  onboarding_state text,
  preparation_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_business_ids uuid[];
  v_business_id uuid;
  v_representation_id uuid;
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  IF p_owner_relationship_name IS NULL
    OR char_length(btrim(p_owner_relationship_name)) NOT BETWEEN 1 AND 120
    OR p_business_name IS NULL
    OR char_length(btrim(p_business_name)) NOT BETWEEN 1 AND 160
    OR p_website_url IS NULL
    OR char_length(p_website_url) NOT BETWEEN 1 AND 2048
    OR p_website_url !~* '^https?://'
    OR p_website_url ~ '@'
    OR p_website_url ~* '^https?://(?:localhost|[^/]*\.(?:localhost|local|internal))(?:[/:]|$)'
    OR p_website_url ~* '^https?://(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:[/:]|$)'
    OR p_website_url ~* '^https?://\['
    OR p_phone_e164 IS NULL
    OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
    OR p_growth_priority IS NULL
    OR char_length(btrim(p_growth_priority)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid direct hire profile';
  END IF;

  -- One lock per authenticated owner makes clean-owner creation and replay
  -- deterministic without accepting a tenant identifier from the request.
  PERFORM 1 FROM auth.users WHERE id = v_owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  SELECT array_agg(business.id ORDER BY business.created_at, business.id)
  INTO v_business_ids
  FROM public.businesses AS business
  WHERE business.user_id = v_owner_id;

  IF coalesce(array_length(v_business_ids, 1), 0) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'business selection required';
  END IF;

  IF coalesce(array_length(v_business_ids, 1), 0) = 0 THEN
    INSERT INTO public.businesses (user_id, business_name)
    VALUES (v_owner_id, btrim(p_business_name))
    RETURNING id INTO v_business_id;
  ELSE
    v_business_id := v_business_ids[1];

    UPDATE public.businesses
    SET business_name = btrim(p_business_name), updated_at = now()
    WHERE id = v_business_id AND user_id = v_owner_id;

  END IF;

  SELECT representation.id
  INTO v_representation_id
  FROM public.business_representations AS representation
  WHERE representation.business_id = v_business_id
    AND representation.user_id = v_owner_id;

  IF v_representation_id IS NULL THEN
    INSERT INTO public.business_representations (
      business_id,
      user_id,
      current_phase
    ) VALUES (
      v_business_id,
      v_owner_id,
      'surface'
    )
    RETURNING id INTO v_representation_id;

    INSERT INTO public.representation_domains (
      business_representation_id,
      domain_name,
      current_phase,
      confidence_score
    )
    SELECT
      v_representation_id,
      domain_name,
      'surface'::public.representation_phase,
      0
    FROM unnest(ARRAY[
      'business_identity', 'offer', 'customer', 'market', 'positioning',
      'differentiation', 'objections', 'trust', 'qualification',
      'commercial_objectives', 'operational_constraints', 'channel_expression'
    ]::text[]) AS domains(domain_name);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_representations AS representation
    WHERE representation.id = v_representation_id
      AND representation.current_version_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.representation_formation_sessions AS formation
    WHERE formation.business_representation_id = v_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'owner journey already advanced';
  END IF;

  INSERT INTO public.direct_hire_onboarding_sessions (
    owner_id,
    business_id,
    business_representation_id,
    owner_relationship_name,
    website_url,
    phone_e164,
    growth_priority,
    onboarding_state,
    preparation_status,
    profile_completed_at
  ) VALUES (
    v_owner_id,
    v_business_id,
    v_representation_id,
    btrim(p_owner_relationship_name),
    p_website_url,
    p_phone_e164,
    btrim(p_growth_priority),
    'preparation',
    'queued',
    now()
  )
  ON CONFLICT (business_representation_id) DO UPDATE
  SET owner_relationship_name = EXCLUDED.owner_relationship_name,
      website_url = EXCLUDED.website_url,
      phone_e164 = EXCLUDED.phone_e164,
      growth_priority = EXCLUDED.growth_priority,
      onboarding_state = 'preparation',
      preparation_status = 'queued',
      profile_completed_at = coalesce(
        public.direct_hire_onboarding_sessions.profile_completed_at,
        now()
      )
  WHERE public.direct_hire_onboarding_sessions.owner_id = v_owner_id
    AND public.direct_hire_onboarding_sessions.business_id = v_business_id
  RETURNING * INTO v_session;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'onboarding lineage conflict';
  END IF;

  RETURN QUERY SELECT
    v_session.id,
    v_session.onboarding_state,
    v_session.preparation_status;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_upsert_direct_hire_profile(
  text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zeya_upsert_direct_hire_profile(
  text, text, text, text, text
) TO authenticated;

COMMIT;
