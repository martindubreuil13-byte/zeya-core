BEGIN;

ALTER TABLE public.voice_representation_lineage
  ADD COLUMN representation_context_mode TEXT NOT NULL DEFAULT 'canonical';

ALTER TABLE public.voice_conversation_outputs
  ADD COLUMN representation_context_mode TEXT NOT NULL DEFAULT 'canonical';

-- Historical rows must still be canonical before nullable Version identity is
-- enabled. Fail closed rather than silently reclassifying inconsistent data.
DO $precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.voice_representation_lineage
    WHERE representation_context_mode <> 'canonical'
       OR canonical_version_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'existing voice lineage does not satisfy the canonical baseline';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voice_conversation_outputs
    WHERE representation_context_mode <> 'canonical'
       OR canonical_version_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'existing voice output does not satisfy the canonical baseline';
  END IF;
END;
$precondition$;

ALTER TABLE public.voice_representation_lineage
  ALTER COLUMN canonical_version_id DROP NOT NULL;

ALTER TABLE public.voice_conversation_outputs
  ALTER COLUMN canonical_version_id DROP NOT NULL;

-- Existing composite Version/lineage foreign keys use PostgreSQL's default
-- MATCH SIMPLE semantics and therefore do not validate rows when the Version
-- component is NULL. Pre-canonical identity is instead closed by the mode
-- checks below, the simple voice_context_id foreign key, service-only writes,
-- and the exact locked owner/Business/Representation validation in the RPC.
ALTER TABLE public.voice_representation_lineage
  ADD CONSTRAINT voice_lineage_context_mode_check
  CHECK (
    representation_context_mode = 'canonical' AND canonical_version_id IS NOT NULL
    OR representation_context_mode = 'pre_canonical'
      AND canonical_version_id IS NULL
      AND provisional_mode
  );

ALTER TABLE public.voice_conversation_outputs
  ADD CONSTRAINT voice_output_context_mode_check
  CHECK (
    representation_context_mode = 'canonical' AND canonical_version_id IS NOT NULL
    OR representation_context_mode = 'pre_canonical' AND canonical_version_id IS NULL
  );

-- Preserve the existing capture contract while carrying the governed
-- Representation context mode from immutable lineage into the output row.
CREATE OR REPLACE FUNCTION public.zeya_capture_voice_conversation_output(
  p_voice_context_id UUID,
  p_conversation_id TEXT,
  p_provider_call_id TEXT,
  p_provider TEXT,
  p_channel TEXT,
  p_capture_source TEXT,
  p_transcript_trust_level TEXT,
  p_provider_attested BOOLEAN,
  p_submitted_by UUID,
  p_started_at TIMESTAMPTZ,
  p_completed_at TIMESTAMPTZ,
  p_transcript JSONB,
  p_transcript_status TEXT,
  p_transcript_schema_version TEXT,
  p_conversation_status TEXT,
  p_completion_reason TEXT,
  p_extraction_schema_version TEXT,
  p_safe_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lineage public.voice_representation_lineage%ROWTYPE;
  v_existing public.voice_conversation_outputs%ROWTYPE;
  v_effective_provider_call_id TEXT;
  v_output_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'conversation capture not authorized';
  END IF;
  IF jsonb_typeof(p_transcript) <> 'array'
     OR (p_transcript_status = 'finalized' AND jsonb_array_length(p_transcript) = 0)
     OR (p_transcript_status <> 'finalized' AND jsonb_array_length(p_transcript) <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valid transcript is required';
  END IF;

  SELECT * INTO v_lineage FROM public.voice_representation_lineage
  WHERE voice_context_id = p_voice_context_id FOR UPDATE;
  IF v_lineage.voice_context_id IS NULL
     OR v_lineage.conversation_id IS DISTINCT FROM p_conversation_id
     OR (p_provider_call_id IS NOT NULL AND v_lineage.provider_call_id IS DISTINCT FROM p_provider_call_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'voice conversation lineage not found';
  END IF;
  IF NOT (
    (
      v_lineage.representation_context_mode='canonical'
      AND v_lineage.canonical_version_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.representation_versions version
        WHERE version.id=v_lineage.canonical_version_id
          AND version.business_representation_id=v_lineage.business_representation_id
      )
    )
    OR
    (
      v_lineage.representation_context_mode='pre_canonical'
      AND v_lineage.canonical_version_id IS NULL
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid voice lineage Representation context';
  END IF;
  v_effective_provider_call_id := v_lineage.provider_call_id;
  IF p_capture_source = 'authenticated_client_relay' THEN
    IF p_transcript_trust_level <> 'authenticated_client_relay'
       OR p_provider_attested
       OR p_submitted_by IS DISTINCT FROM v_lineage.tenant_user_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid client-relay trust classification';
    END IF;
  ELSIF p_capture_source = 'provider_callback' THEN
    IF p_transcript_trust_level <> 'provider_attested' OR NOT p_provider_attested OR p_submitted_by IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid provider trust classification';
    END IF;
  ELSIF p_capture_source = 'trusted_server' THEN
    IF p_transcript_trust_level <> 'provider_attested' OR NOT p_provider_attested OR p_submitted_by IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid trusted-server classification';
    END IF;
  ELSIF p_capture_source = 'status_only' THEN
    IF p_transcript_trust_level <> 'status_only' OR p_provider_attested OR jsonb_array_length(p_transcript) <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid status-only capture';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid capture source';
  END IF;

  SELECT * INTO v_existing FROM public.voice_conversation_outputs
  WHERE voice_context_id = p_voice_context_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.tenant_user_id = v_lineage.tenant_user_id
       AND v_existing.business_id = v_lineage.business_id
       AND v_existing.business_representation_id = v_lineage.business_representation_id
       AND v_existing.canonical_version_id IS NOT DISTINCT FROM v_lineage.canonical_version_id
       AND v_existing.representation_context_mode = v_lineage.representation_context_mode
       AND v_existing.conversation_id = p_conversation_id
       AND v_existing.provider_call_id IS NOT DISTINCT FROM v_effective_provider_call_id
       AND v_existing.provider = p_provider
       AND v_existing.channel = p_channel
       AND v_existing.capture_source = p_capture_source
       AND v_existing.transcript_trust_level = p_transcript_trust_level
       AND v_existing.provider_attested = p_provider_attested
       AND v_existing.submitted_by IS NOT DISTINCT FROM p_submitted_by
       AND v_existing.started_at IS NOT DISTINCT FROM p_started_at
       AND v_existing.completed_at IS NOT DISTINCT FROM p_completed_at
       AND v_existing.transcript = p_transcript
       AND v_existing.transcript_status = p_transcript_status
       AND v_existing.transcript_schema_version = p_transcript_schema_version
       AND v_existing.conversation_status = p_conversation_status
       AND v_existing.completion_reason IS NOT DISTINCT FROM p_completion_reason THEN
      IF v_existing.extraction_schema_version = p_extraction_schema_version
         AND v_existing.safe_metadata = COALESCE(p_safe_metadata, '{}'::jsonb) THEN
        RETURN v_existing.id;
      END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'conversation output already finalized';
  END IF;

  INSERT INTO public.voice_conversation_outputs (
    voice_context_id, tenant_user_id, business_id, business_representation_id,
    canonical_version_id, representation_context_mode,
    agent_id, agent_type, provider, conversation_id,
    provider_call_id, channel, capture_source, transcript_trust_level,
    provider_attested, submitted_by, started_at, completed_at, transcript, transcript_status,
    transcript_schema_version, conversation_status, completion_reason,
    extraction_schema_version, worker_brief_id, mission_id, safe_metadata
  ) VALUES (
    v_lineage.voice_context_id, v_lineage.tenant_user_id, v_lineage.business_id,
    v_lineage.business_representation_id, v_lineage.canonical_version_id,
    v_lineage.representation_context_mode,
    v_lineage.agent_id, v_lineage.agent_type, p_provider, p_conversation_id,
    v_effective_provider_call_id, p_channel, p_capture_source, p_transcript_trust_level,
    p_provider_attested, p_submitted_by, p_started_at, p_completed_at, p_transcript, p_transcript_status,
    p_transcript_schema_version, p_conversation_status, p_completion_reason,
    p_extraction_schema_version, v_lineage.worker_brief_id, v_lineage.mission_id,
    COALESCE(p_safe_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_output_id;
  RETURN v_output_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_create_pre_canonical_voice_representation_lineage(
  p_voice_context_id uuid,
  p_worker_brief_id text,
  p_mission_id text,
  p_conversation_id text,
  p_tenant_user_id uuid,
  p_business_id uuid,
  p_business_representation_id uuid,
  p_canonical_version_id uuid,
  p_context_generated_at timestamp with time zone,
  p_authorized_element_keys text[],
  p_provisional_mode boolean,
  p_agent_id text,
  p_agent_type text,
  p_agent_role text,
  p_context_schema_version text,
  p_prompt_assembly_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  locked_representation_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'lineage write not authorized';
  END IF;

  IF p_voice_context_id IS NULL
     OR p_worker_brief_id IS NULL
     OR btrim(p_worker_brief_id) = ''
     OR p_mission_id IS NULL
     OR btrim(p_mission_id) = ''
     OR p_conversation_id IS NULL
     OR btrim(p_conversation_id) = ''
     OR p_tenant_user_id IS NULL
     OR p_business_id IS NULL
     OR p_business_representation_id IS NULL
     OR p_context_generated_at IS NULL
     OR p_agent_id IS NULL
     OR btrim(p_agent_id) = ''
     OR p_agent_type IS NULL
     OR btrim(p_agent_type) = ''
     OR p_agent_role IS NULL
     OR btrim(p_agent_role) = ''
     OR p_context_schema_version IS NULL
     OR btrim(p_context_schema_version) = ''
     OR p_prompt_assembly_version IS NULL
     OR btrim(p_prompt_assembly_version) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid pre-canonical lineage identity';
  END IF;

  IF p_canonical_version_id IS NOT NULL
     OR p_provisional_mode IS DISTINCT FROM true
     OR COALESCE(
       cardinality(p_authorized_element_keys),
       0
     ) <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid pre-canonical lineage';
  END IF;

  -- Lock the exact Representation before checking Version absence.
  -- This prevents a concurrent foreign-key-backed Version insertion from
  -- crossing this clean-owner validation boundary.
  SELECT representation.id
  INTO locked_representation_id
  FROM public.business_representations AS representation
  WHERE representation.id =
      p_business_representation_id
    AND representation.business_id =
      p_business_id
    AND representation.user_id =
      p_tenant_user_id
  FOR UPDATE;

  IF locked_representation_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'pre-canonical context not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id = p_business_id
      AND business.user_id = p_tenant_user_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'pre-canonical context not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_representations AS representation
    WHERE representation.id =
        locked_representation_id
      AND representation.current_version_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'pre-canonical context unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.representation_versions AS version
    WHERE version.business_representation_id =
      locked_representation_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'pre-canonical context unavailable';
  END IF;

  INSERT INTO public.voice_representation_lineage (
    voice_context_id,
    worker_brief_id,
    mission_id,
    conversation_id,
    tenant_user_id,
    business_id,
    business_representation_id,
    canonical_version_id,
    representation_context_mode,
    context_generated_at,
    authorized_element_keys,
    provisional_mode,
    agent_id,
    agent_type,
    agent_role,
    context_schema_version,
    prompt_assembly_version
  )
  VALUES (
    p_voice_context_id,
    p_worker_brief_id,
    p_mission_id,
    p_conversation_id,
    p_tenant_user_id,
    p_business_id,
    locked_representation_id,
    NULL,
    'pre_canonical',
    p_context_generated_at,
    ARRAY[]::text[],
    true,
    p_agent_id,
    p_agent_type,
    p_agent_role,
    p_context_schema_version,
    p_prompt_assembly_version
  );
END
$function$;

REVOKE ALL ON FUNCTION public.zeya_create_pre_canonical_voice_representation_lineage(
  uuid,text,text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text[],boolean,text,text,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_create_pre_canonical_voice_representation_lineage(
  uuid,text,text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text[],boolean,text,text,text,text,text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
