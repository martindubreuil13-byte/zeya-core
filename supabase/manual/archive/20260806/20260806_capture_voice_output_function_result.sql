CREATE OR REPLACE FUNCTION public.zeya_capture_voice_conversation_output(p_voice_context_id uuid, p_conversation_id text, p_provider_call_id text, p_provider text, p_channel text, p_capture_source text, p_transcript_trust_level text, p_provider_attested boolean, p_submitted_by uuid, p_started_at timestamp with time zone, p_completed_at timestamp with time zone, p_transcript jsonb, p_transcript_status text, p_transcript_schema_version text, p_conversation_status text, p_completion_reason text, p_extraction_schema_version text, p_safe_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
