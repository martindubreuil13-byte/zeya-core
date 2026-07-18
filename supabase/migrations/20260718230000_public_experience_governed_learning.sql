BEGIN;

ALTER TABLE public.evidence
  ADD COLUMN source_public_experience_session_id uuid,
  ADD COLUMN source_voice_conversation_output_id uuid,
  ADD COLUMN source_voice_context_id uuid,
  ADD COLUMN source_tenant_user_id uuid,
  ADD COLUMN source_business_id uuid,
  ADD COLUMN source_canonical_version_id uuid,
  ADD COLUMN source_mission_id text,
  ADD COLUMN source_provider_conversation_id text,
  ADD COLUMN source_provider_call_id text;

ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_interaction_provenance_complete CHECK (
    (source_public_experience_session_id IS NULL
      AND source_voice_conversation_output_id IS NULL
      AND source_voice_context_id IS NULL
      AND source_tenant_user_id IS NULL
      AND source_business_id IS NULL
      AND source_canonical_version_id IS NULL
      AND source_mission_id IS NULL
      AND source_provider_conversation_id IS NULL
      AND source_provider_call_id IS NULL)
    OR
    (source_public_experience_session_id IS NOT NULL
      AND source_voice_conversation_output_id IS NOT NULL
      AND source_voice_context_id IS NOT NULL
      AND source_tenant_user_id IS NOT NULL
      AND source_business_id IS NOT NULL
      AND source_canonical_version_id IS NOT NULL
      AND source_mission_id IS NOT NULL
      AND source_provider_conversation_id IS NOT NULL
      AND source_provider_call_id IS NOT NULL)
  );

CREATE UNIQUE INDEX voice_outputs_governed_learning_identity_idx
  ON public.voice_conversation_outputs(
    id, voice_context_id, tenant_user_id, business_id,
    business_representation_id, canonical_version_id
  );

CREATE UNIQUE INDEX public_experience_governed_learning_identity_idx
  ON public.public_experience_sessions(
    id, tenant_user_id, business_id, business_representation_id,
    canonical_version_id, veya_voice_context_id, dispatch_id,
    provider_conversation_id, provider_call_id
  );

CREATE UNIQUE INDEX evidence_interaction_output_unique_idx
  ON public.evidence(source_voice_conversation_output_id)
  WHERE source_voice_conversation_output_id IS NOT NULL;

CREATE UNIQUE INDEX evidence_governed_learning_identity_idx
  ON public.evidence(
    id, business_representation_id, source_canonical_version_id,
    source_voice_conversation_output_id
  );

ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_interaction_output_identity_fk
    FOREIGN KEY (
      source_voice_conversation_output_id, source_voice_context_id,
      source_tenant_user_id, source_business_id,
      business_representation_id, source_canonical_version_id
    ) REFERENCES public.voice_conversation_outputs(
      id, voice_context_id, tenant_user_id, business_id,
      business_representation_id, canonical_version_id
    ) ON DELETE CASCADE,
  ADD CONSTRAINT evidence_interaction_session_identity_fk
    FOREIGN KEY (
      source_public_experience_session_id, source_tenant_user_id,
      source_business_id, business_representation_id,
      source_canonical_version_id, source_voice_context_id,
      source_mission_id, source_provider_conversation_id,
      source_provider_call_id
    ) REFERENCES public.public_experience_sessions(
      id, tenant_user_id, business_id, business_representation_id,
      canonical_version_id, veya_voice_context_id, dispatch_id,
      provider_conversation_id, provider_call_id
    ) ON DELETE CASCADE;

ALTER TABLE public.voice_conversation_candidates
  ADD COLUMN source_evidence_id uuid;

ALTER TABLE public.voice_conversation_candidates
  ADD CONSTRAINT voice_candidate_source_evidence_identity_fk
    FOREIGN KEY (
      source_evidence_id, business_representation_id,
      canonical_version_id, conversation_output_id
    ) REFERENCES public.evidence(
      id, business_representation_id,
      source_canonical_version_id, source_voice_conversation_output_id
    ) ON DELETE RESTRICT;

CREATE FUNCTION public.zeya_enforce_interaction_evidence_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_public_experience_session_id IS NOT NULL
     AND (
       current_user <> 'postgres'
       OR current_setting('zeya.governed_learning_write', true) <> 'on'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'interaction Evidence creation is not authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zeya_interaction_evidence_authority
  BEFORE INSERT ON public.evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_enforce_interaction_evidence_authority();

REVOKE ALL ON FUNCTION public.zeya_enforce_interaction_evidence_authority()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.zeya_store_voice_conversation_candidates(
  p_conversation_output_id uuid,
  p_extraction_schema_version text,
  p_candidates jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_output public.voice_conversation_outputs%ROWTYPE;
  v_lineage public.voice_representation_lineage%ROWTYPE;
  v_session public.public_experience_sessions%ROWTYPE;
  v_result_hash text;
  v_count integer;
  v_evidence_id uuid;
  v_evidence_statement text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate extraction not authorized';
  END IF;
  IF jsonb_typeof(p_candidates) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate array is required';
  END IF;

  SELECT * INTO v_output
  FROM public.voice_conversation_outputs
  WHERE id = p_conversation_output_id
  FOR UPDATE;
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

  SELECT * INTO v_lineage
  FROM public.voice_representation_lineage
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
    OR btrim(COALESCE(item->'content'->>'summary', '')) = ''
    OR char_length(item->'content'->>'summary') > 500
    OR COALESCE(item->>'speakerRole', '') NOT IN ('customer', 'founder', 'staff', 'zeya', 'veya', 'unknown')
    OR COALESCE(item->>'statementKind', '') NOT IN ('question', 'assertion', 'objection', 'inference', 'request', 'commitment', 'classification')
    OR jsonb_typeof(item->'sourceReference') IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'sourceReference'->'turnIndexes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(item->'sourceReference'->'turnIndexes') = 0
    OR jsonb_typeof(item->'relevantElementKeys') IS DISTINCT FROM 'array'
    OR CASE
         WHEN jsonb_typeof(item->'confidence') = 'number'
         THEN NOT ((item->>'confidence')::numeric BETWEEN 0 AND 1)
         ELSE true
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
    WHERE NOT (element_key.key = ANY(COALESCE(v_lineage.authorized_element_keys, ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate references unauthorized Representation Element';
  END IF;

  IF v_output.channel = 'veya_outbound'
     AND v_output.capture_source = 'provider_callback'
     AND v_output.transcript_trust_level = 'provider_attested'
     AND v_output.provider_attested THEN
    SELECT * INTO v_session
    FROM public.public_experience_sessions
    WHERE veya_voice_context_id = v_output.voice_context_id
    FOR UPDATE;

    IF v_session.id IS NOT NULL THEN
      IF v_session.tenant_user_id IS DISTINCT FROM v_output.tenant_user_id
         OR v_session.business_id IS DISTINCT FROM v_output.business_id
         OR v_session.business_representation_id IS DISTINCT FROM v_output.business_representation_id
         OR v_session.canonical_version_id IS DISTINCT FROM v_output.canonical_version_id
         OR v_session.dispatch_id IS DISTINCT FROM v_lineage.mission_id
         OR v_session.provider_conversation_id IS DISTINCT FROM v_output.conversation_id
         OR v_session.provider_call_id IS DISTINCT FROM v_output.provider_call_id
         OR v_session.state NOT IN ('call_dispatched', 'call_active', 'reflection_ready') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'public experience governed-learning lineage mismatch';
      END IF;

      SELECT left(
        COALESCE(
          string_agg(item->'content'->>'summary', ' | ' ORDER BY ordinality),
          'Provider-attested Public Experience interaction completed with no structured Representation change candidates.'
        ),
        2000
      ) INTO v_evidence_statement
      FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS candidate(item, ordinality);

      v_evidence_statement := regexp_replace(v_evidence_statement, 'https?://[^[:space:]]+', '[link]', 'gi');
      v_evidence_statement := regexp_replace(v_evidence_statement, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', '[contact detail]', 'gi');
      v_evidence_statement := regexp_replace(v_evidence_statement, '(\+?[0-9][0-9[:space:]().\-]{6,}[0-9])', '[contact detail]', 'g');

      PERFORM pg_catalog.set_config('zeya.governed_learning_write', 'on', true);
      INSERT INTO public.evidence(
        business_representation_id, source_type, source_description,
        raw_statement, affected_domains, captured_by_actor,
        source_public_experience_session_id, source_voice_conversation_output_id,
        source_voice_context_id, source_tenant_user_id, source_business_id,
        source_canonical_version_id, source_mission_id,
        source_provider_conversation_id, source_provider_call_id
      ) VALUES (
        v_output.business_representation_id, 'call_result',
        'Sanitized provider-attested Public Experience interaction',
        v_evidence_statement, ARRAY[]::text[], v_output.tenant_user_id,
        v_session.id, v_output.id, v_output.voice_context_id,
        v_output.tenant_user_id, v_output.business_id,
        v_output.canonical_version_id, v_lineage.mission_id,
        v_output.conversation_id, v_output.provider_call_id
      )
      RETURNING id INTO v_evidence_id;

      INSERT INTO public.audit_events(
        business_representation_id, event_type, evidence_id,
        actor_system, details
      ) VALUES (
        v_output.business_representation_id, 'evidence_created', v_evidence_id,
        'public_experience_governed_learning',
        jsonb_build_object(
          'publicExperienceSessionId', v_session.id,
          'conversationOutputId', v_output.id,
          'voiceContextId', v_output.voice_context_id,
          'baselineCanonicalVersionId', v_output.canonical_version_id,
          'candidateCount', v_count,
          'status', 'pending_review'
        )
      );
    END IF;
  END IF;

  INSERT INTO public.voice_conversation_candidates(
    conversation_output_id, tenant_user_id, business_id,
    business_representation_id, canonical_version_id, source_evidence_id,
    candidate_type, content, speaker_role, statement_kind, source_reference,
    relevant_element_keys, confidence, extraction_rationale,
    transcript_trust_level, extraction_schema_version, extraction_ordinal
  )
  SELECT v_output.id, v_output.tenant_user_id, v_output.business_id,
    v_output.business_representation_id, v_output.canonical_version_id,
    v_evidence_id, item->>'candidateType', item->'content', item->>'speakerRole',
    item->>'statementKind', item->'sourceReference',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'relevantElementKeys', '[]'::jsonb))),
    (item->>'confidence')::numeric, item->>'rationale',
    v_output.transcript_trust_level, p_extraction_schema_version, ordinality - 1
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

REVOKE ALL ON FUNCTION public.zeya_store_voice_conversation_candidates(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_store_voice_conversation_candidates(uuid,text,jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
