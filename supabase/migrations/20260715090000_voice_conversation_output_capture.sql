BEGIN;

CREATE UNIQUE INDEX voice_lineage_identity_idx
  ON public.voice_representation_lineage(
    voice_context_id, tenant_user_id, business_id,
    business_representation_id, canonical_version_id
  );

CREATE TABLE public.voice_conversation_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_context_id UUID NOT NULL UNIQUE,
  tenant_user_id UUID NOT NULL,
  business_id UUID NOT NULL,
  business_representation_id UUID NOT NULL,
  canonical_version_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE,
  provider_call_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('zeya_realtime', 'veya_outbound')),
  capture_source TEXT NOT NULL CHECK (capture_source IN ('trusted_server', 'authenticated_client_relay', 'provider_callback', 'status_only')),
  transcript_trust_level TEXT NOT NULL CHECK (transcript_trust_level IN ('provider_attested', 'authenticated_client_relay', 'status_only')),
  provider_attested BOOLEAN NOT NULL,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcript JSONB NOT NULL CHECK (jsonb_typeof(transcript) = 'array'),
  transcript_status TEXT NOT NULL CHECK (transcript_status IN ('missing', 'pending', 'unavailable', 'finalized')),
  transcript_schema_version TEXT NOT NULL DEFAULT '1.0',
  conversation_status TEXT NOT NULL,
  completion_reason TEXT,
  processing_status TEXT NOT NULL DEFAULT 'captured'
    CHECK (processing_status IN ('captured', 'extracting', 'completed', 'failed')),
  extraction_schema_version TEXT NOT NULL DEFAULT '1.0',
  completed_extraction_schema_version TEXT,
  extraction_result_hash TEXT,
  extracted_candidate_count INTEGER CHECK (extracted_candidate_count >= 0),
  worker_brief_id TEXT,
  mission_id TEXT,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_output_extraction_result_complete CHECK (
    (completed_extraction_schema_version IS NULL
      AND extraction_result_hash IS NULL
      AND extracted_candidate_count IS NULL)
    OR
    (completed_extraction_schema_version IS NOT NULL
      AND extraction_result_hash IS NOT NULL
      AND extracted_candidate_count IS NOT NULL
      AND completed_extraction_schema_version = extraction_schema_version
      AND processing_status = 'completed')
  ),
  UNIQUE (id, tenant_user_id, business_id, business_representation_id, canonical_version_id),
  CONSTRAINT voice_output_lineage_fk
    FOREIGN KEY (voice_context_id)
    REFERENCES public.voice_representation_lineage(voice_context_id) ON DELETE RESTRICT,
  CONSTRAINT voice_output_lineage_identity_fk
    FOREIGN KEY (
      voice_context_id, tenant_user_id, business_id,
      business_representation_id, canonical_version_id
    ) REFERENCES public.voice_representation_lineage(
      voice_context_id, tenant_user_id, business_id,
      business_representation_id, canonical_version_id
    ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX voice_outputs_provider_call_idx
  ON public.voice_conversation_outputs(provider_call_id)
  WHERE provider_call_id IS NOT NULL;
CREATE INDEX voice_outputs_tenant_idx ON public.voice_conversation_outputs(tenant_user_id);
CREATE INDEX voice_outputs_business_idx ON public.voice_conversation_outputs(business_id);
CREATE INDEX voice_outputs_representation_idx ON public.voice_conversation_outputs(business_representation_id);

CREATE TABLE public.voice_conversation_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_output_id UUID NOT NULL,
  tenant_user_id UUID NOT NULL,
  business_id UUID NOT NULL,
  business_representation_id UUID NOT NULL,
  canonical_version_id UUID NOT NULL,
  candidate_type TEXT NOT NULL CHECK (candidate_type IN (
    'customer_question', 'objection', 'commitment_made', 'promised_follow_up',
    'unanswered_question', 'qualification_signal', 'customer_need',
    'customer_aspiration', 'customer_language', 'possible_representation_gap',
    'candidate_evidence', 'candidate_observation', 'possible_contradiction',
    'suggested_follow_up', 'outcome_classification', 'next_action_recommendation'
  )),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  speaker_role TEXT NOT NULL CHECK (speaker_role IN ('customer', 'founder', 'staff', 'zeya', 'veya', 'unknown')),
  statement_kind TEXT NOT NULL CHECK (statement_kind IN ('question', 'assertion', 'objection', 'inference', 'request', 'commitment', 'classification')),
  source_reference JSONB NOT NULL CHECK (jsonb_typeof(source_reference) = 'object'),
  relevant_element_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  extraction_rationale TEXT NOT NULL,
  transcript_trust_level TEXT NOT NULL CHECK (transcript_trust_level IN ('provider_attested', 'authenticated_client_relay', 'status_only')),
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status = 'pending_review'),
  extraction_schema_version TEXT NOT NULL,
  extraction_ordinal INTEGER NOT NULL CHECK (extraction_ordinal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_output_id, extraction_schema_version, extraction_ordinal),
  CONSTRAINT voice_candidate_output_identity_fk
    FOREIGN KEY (
      conversation_output_id, tenant_user_id, business_id,
      business_representation_id, canonical_version_id
    ) REFERENCES public.voice_conversation_outputs(
      id, tenant_user_id, business_id,
      business_representation_id, canonical_version_id
    ) ON DELETE RESTRICT
);

CREATE INDEX voice_candidates_output_idx ON public.voice_conversation_candidates(conversation_output_id);
CREATE INDEX voice_candidates_tenant_idx ON public.voice_conversation_candidates(tenant_user_id);
CREATE INDEX voice_candidates_business_idx ON public.voice_conversation_candidates(business_id);

ALTER TABLE public.voice_conversation_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_conversation_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_outputs_tenant_select ON public.voice_conversation_outputs
  FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid());
CREATE POLICY voice_candidates_tenant_select ON public.voice_conversation_candidates
  FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid());

REVOKE ALL ON public.voice_conversation_outputs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.voice_conversation_candidates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.voice_conversation_outputs TO authenticated, service_role;
GRANT SELECT ON public.voice_conversation_candidates TO authenticated, service_role;

CREATE FUNCTION public.zeya_enforce_voice_output_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_delayed_finalization BOOLEAN;
  v_extraction_completion BOOLEAN;
BEGIN
  v_delayed_finalization :=
    OLD.capture_source = 'status_only'
    AND OLD.transcript_status IN ('missing', 'pending', 'unavailable')
    AND OLD.transcript = '[]'::jsonb
    AND OLD.transcript_trust_level = 'status_only'
    AND NOT OLD.provider_attested
    AND NEW.capture_source = OLD.capture_source
    AND NEW.transcript_status = 'finalized'
    AND jsonb_array_length(NEW.transcript) > 0
    AND NEW.transcript_trust_level = 'provider_attested'
    AND NEW.provider_attested;

  v_extraction_completion :=
    OLD.completed_extraction_schema_version IS NULL
    AND OLD.extraction_result_hash IS NULL
    AND OLD.extracted_candidate_count IS NULL
    AND NEW.completed_extraction_schema_version IS NOT NULL
    AND NEW.extraction_result_hash IS NOT NULL
    AND NEW.extracted_candidate_count IS NOT NULL
    AND NEW.extracted_candidate_count >= 0
    AND NEW.completed_extraction_schema_version = NEW.extraction_schema_version
    AND NEW.processing_status = 'completed';

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.voice_context_id IS DISTINCT FROM OLD.voice_context_id
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.business_representation_id IS DISTINCT FROM OLD.business_representation_id
     OR NEW.canonical_version_id IS DISTINCT FROM OLD.canonical_version_id
     OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.agent_type IS DISTINCT FROM OLD.agent_type
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.capture_source IS DISTINCT FROM OLD.capture_source
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.transcript_schema_version IS DISTINCT FROM OLD.transcript_schema_version
     OR NEW.extraction_schema_version IS DISTINCT FROM OLD.extraction_schema_version
     OR NEW.worker_brief_id IS DISTINCT FROM OLD.worker_brief_id
     OR NEW.mission_id IS DISTINCT FROM OLD.mission_id
     OR NEW.safe_metadata IS DISTINCT FROM OLD.safe_metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'conversation output provenance is immutable';
  END IF;
  IF (NEW.transcript IS DISTINCT FROM OLD.transcript
      OR NEW.transcript_status IS DISTINCT FROM OLD.transcript_status
      OR NEW.transcript_trust_level IS DISTINCT FROM OLD.transcript_trust_level
      OR NEW.provider_attested IS DISTINCT FROM OLD.provider_attested)
     AND NOT v_delayed_finalization THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'transcript state is immutable';
  END IF;
  IF (NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.conversation_status IS DISTINCT FROM OLD.conversation_status
      OR NEW.completion_reason IS DISTINCT FROM OLD.completion_reason)
     AND NOT v_delayed_finalization THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'conversation completion is immutable';
  END IF;
  IF (NEW.completed_extraction_schema_version IS DISTINCT FROM OLD.completed_extraction_schema_version
      OR NEW.extraction_result_hash IS DISTINCT FROM OLD.extraction_result_hash
      OR NEW.extracted_candidate_count IS DISTINCT FROM OLD.extracted_candidate_count)
     AND NOT v_extraction_completion THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'extraction result identity is immutable';
  END IF;
  IF NEW.processing_status IS DISTINCT FROM OLD.processing_status
     AND NOT v_extraction_completion
     AND NOT (v_delayed_finalization AND NEW.processing_status = 'captured')
     AND NOT (
       (OLD.processing_status = 'captured' AND NEW.processing_status IN ('extracting', 'failed'))
       OR (OLD.processing_status = 'extracting' AND NEW.processing_status = 'failed')
       OR (OLD.processing_status = 'failed' AND NEW.processing_status = 'extracting')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid conversation processing transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zeya_voice_output_immutability
  BEFORE UPDATE ON public.voice_conversation_outputs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_voice_output_immutability();

REVOKE ALL ON FUNCTION public.zeya_enforce_voice_output_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.zeya_capture_voice_conversation_output(
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
    IF v_existing.conversation_id = p_conversation_id
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
    canonical_version_id, agent_id, agent_type, provider, conversation_id,
    provider_call_id, channel, capture_source, transcript_trust_level,
    provider_attested, submitted_by, started_at, completed_at, transcript, transcript_status,
    transcript_schema_version, conversation_status, completion_reason,
    extraction_schema_version, worker_brief_id, mission_id, safe_metadata
  ) VALUES (
    v_lineage.voice_context_id, v_lineage.tenant_user_id, v_lineage.business_id,
    v_lineage.business_representation_id, v_lineage.canonical_version_id,
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

CREATE FUNCTION public.zeya_finalize_voice_conversation_transcript(
  p_voice_context_id UUID,
  p_transcript JSONB,
  p_completed_at TIMESTAMPTZ,
  p_conversation_status TEXT,
  p_completion_reason TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_output public.voice_conversation_outputs%ROWTYPE;
  v_effective_completed_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'transcript finalization not authorized';
  END IF;
  IF jsonb_typeof(p_transcript) <> 'array' OR jsonb_array_length(p_transcript) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valid transcript is required';
  END IF;
  SELECT * INTO v_output FROM public.voice_conversation_outputs
  WHERE voice_context_id = p_voice_context_id FOR UPDATE;
  IF v_output.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'conversation output not found';
  END IF;
  v_effective_completed_at := COALESCE(p_completed_at, v_output.completed_at);
  IF v_output.transcript_status = 'finalized' THEN
    IF v_output.transcript = p_transcript
       AND v_output.completed_at IS NOT DISTINCT FROM v_effective_completed_at
       AND v_output.conversation_status = p_conversation_status
       AND v_output.completion_reason IS NOT DISTINCT FROM p_completion_reason THEN
      RETURN v_output.id;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'conversation transcript already finalized';
  END IF;
  IF v_output.capture_source <> 'status_only'
     OR v_output.transcript_trust_level <> 'status_only'
     OR v_output.provider_attested THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'conversation output cannot accept delayed transcript';
  END IF;
  UPDATE public.voice_conversation_outputs
  SET transcript = p_transcript,
      transcript_status = 'finalized',
      transcript_trust_level = 'provider_attested',
      provider_attested = TRUE,
      completed_at = v_effective_completed_at,
      conversation_status = p_conversation_status,
      completion_reason = p_completion_reason,
      processing_status = 'captured',
      updated_at = now()
  WHERE id = v_output.id;
  RETURN v_output.id;
END;
$$;

CREATE FUNCTION public.zeya_set_voice_conversation_processing_status(
  p_conversation_output_id UUID,
  p_processing_status TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'processing update not authorized';
  END IF;
  IF p_processing_status NOT IN ('extracting', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid processing status';
  END IF;
  UPDATE public.voice_conversation_outputs
  SET processing_status = p_processing_status, updated_at = now()
  WHERE id = p_conversation_output_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'conversation output not found';
  END IF;
END;
$$;

CREATE FUNCTION public.zeya_store_voice_conversation_candidates(
  p_conversation_output_id UUID,
  p_extraction_schema_version TEXT,
  p_candidates JSONB
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_output public.voice_conversation_outputs%ROWTYPE;
  v_lineage public.voice_representation_lineage%ROWTYPE;
  v_result_hash TEXT;
  v_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate extraction not authorized';
  END IF;
  IF jsonb_typeof(p_candidates) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate array is required';
  END IF;
  SELECT * INTO v_output FROM public.voice_conversation_outputs
  WHERE id = p_conversation_output_id FOR UPDATE;
  IF v_output.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'conversation output not found';
  END IF;
  IF v_output.transcript_status <> 'finalized' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'conversation transcript is not finalized';
  END IF;
  IF p_extraction_schema_version IS NULL
     OR btrim(p_extraction_schema_version) = ''
     OR p_extraction_schema_version <> v_output.extraction_schema_version THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid extraction schema version';
  END IF;

  SELECT * INTO v_lineage FROM public.voice_representation_lineage
  WHERE voice_context_id = v_output.voice_context_id;
  IF v_lineage.voice_context_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'voice conversation lineage not found';
  END IF;

  v_result_hash := md5(p_candidates::text);
  v_count := jsonb_array_length(p_candidates);

  IF v_output.completed_extraction_schema_version IS NOT NULL
     OR v_output.extraction_result_hash IS NOT NULL
     OR v_output.extracted_candidate_count IS NOT NULL THEN
    IF v_output.completed_extraction_schema_version = p_extraction_schema_version
       AND v_output.extraction_result_hash = v_result_hash
       AND v_output.extracted_candidate_count = v_count THEN
      RETURN v_output.extracted_candidate_count;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'conversation extraction already completed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) candidate(item)
    WHERE COALESCE(item->>'candidateType', '') NOT IN (
      'customer_question', 'objection', 'commitment_made', 'promised_follow_up',
      'unanswered_question', 'qualification_signal', 'customer_need',
      'customer_aspiration', 'customer_language', 'possible_representation_gap',
      'candidate_evidence', 'candidate_observation', 'possible_contradiction',
      'suggested_follow_up', 'outcome_classification', 'next_action_recommendation'
    )
    OR jsonb_typeof(item->'content') IS DISTINCT FROM 'object'
    OR COALESCE(item->>'speakerRole', '') NOT IN ('customer', 'founder', 'staff', 'zeya', 'veya', 'unknown')
    OR COALESCE(item->>'statementKind', '') NOT IN ('question', 'assertion', 'objection', 'inference', 'request', 'commitment', 'classification')
    OR jsonb_typeof(item->'sourceReference') IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'relevantElementKeys') IS DISTINCT FROM 'array'
    OR CASE
         WHEN jsonb_typeof(item->'confidence') = 'number'
         THEN NOT ((item->>'confidence')::numeric BETWEEN 0 AND 1)
         ELSE TRUE
       END
    OR btrim(COALESCE(item->>'rationale', '')) = ''
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid conversation candidate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) candidate(item)
    CROSS JOIN LATERAL jsonb_array_elements(item->'relevantElementKeys') element_key(value)
    WHERE jsonb_typeof(element_key.value) IS DISTINCT FROM 'string'
       OR btrim(element_key.value #>> '{}') = ''
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid candidate Representation Element key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) candidate(item)
    WHERE item->>'candidateType' = 'candidate_evidence'
      AND item->>'speakerRole' IN ('zeya', 'veya')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'agent statement cannot create candidate Evidence';
  END IF;
  IF v_output.transcript_trust_level <> 'provider_attested'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_candidates) candidate(item)
       WHERE item->>'candidateType' = 'candidate_evidence'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'client-relayed transcript cannot create candidate Evidence';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) candidate(item)
    CROSS JOIN LATERAL jsonb_array_elements_text(item->'relevantElementKeys') element_key(key)
    WHERE NOT (element_key.key = ANY(COALESCE(v_lineage.authorized_element_keys, ARRAY[]::TEXT[])))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate references unauthorized Representation Element';
  END IF;

  INSERT INTO public.voice_conversation_candidates (
    conversation_output_id, tenant_user_id, business_id,
    business_representation_id, canonical_version_id, candidate_type,
    content, speaker_role, statement_kind, source_reference,
    relevant_element_keys, confidence, extraction_rationale,
    transcript_trust_level, extraction_schema_version, extraction_ordinal
  )
  SELECT v_output.id, v_output.tenant_user_id, v_output.business_id,
    v_output.business_representation_id, v_output.canonical_version_id,
    item->>'candidateType', item->'content', item->>'speakerRole',
    item->>'statementKind', item->'sourceReference',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'relevantElementKeys', '[]'::jsonb))),
    (item->>'confidence')::numeric, item->>'rationale', v_output.transcript_trust_level,
    p_extraction_schema_version, ordinality - 1
  FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS candidate(item, ordinality);

  UPDATE public.voice_conversation_outputs
  SET completed_extraction_schema_version = p_extraction_schema_version,
      extraction_result_hash = v_result_hash,
      extracted_candidate_count = v_count,
      processing_status = 'completed',
      updated_at = now()
  WHERE id = p_conversation_output_id;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_capture_voice_conversation_output(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,UUID,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_finalize_voice_conversation_transcript(UUID,JSONB,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_set_voice_conversation_processing_status(UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_store_voice_conversation_candidates(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_capture_voice_conversation_output(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,UUID,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_finalize_voice_conversation_transcript(UUID,JSONB,TIMESTAMPTZ,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_set_voice_conversation_processing_status(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_store_voice_conversation_candidates(UUID,TEXT,JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
