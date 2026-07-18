-- Phase 5A rollback. Run manually only before Phase 5A interaction Evidence exists.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.evidence
    WHERE source_public_experience_session_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.voice_conversation_candidates
    WHERE source_evidence_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rollback refused: Phase 5A governed-learning records exist';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS zeya_interaction_evidence_authority ON public.evidence;
DROP FUNCTION IF EXISTS public.zeya_enforce_interaction_evidence_authority();

ALTER TABLE public.voice_conversation_candidates
  DROP CONSTRAINT IF EXISTS voice_candidate_source_evidence_identity_fk,
  DROP COLUMN IF EXISTS source_evidence_id;

ALTER TABLE public.evidence
  DROP CONSTRAINT IF EXISTS evidence_interaction_session_identity_fk,
  DROP CONSTRAINT IF EXISTS evidence_interaction_output_identity_fk,
  DROP CONSTRAINT IF EXISTS evidence_interaction_provenance_complete;

DROP INDEX IF EXISTS public.evidence_governed_learning_identity_idx;
DROP INDEX IF EXISTS public.evidence_interaction_output_unique_idx;
DROP INDEX IF EXISTS public.public_experience_governed_learning_identity_idx;
DROP INDEX IF EXISTS public.voice_outputs_governed_learning_identity_idx;

ALTER TABLE public.evidence
  DROP COLUMN IF EXISTS source_provider_call_id,
  DROP COLUMN IF EXISTS source_provider_conversation_id,
  DROP COLUMN IF EXISTS source_mission_id,
  DROP COLUMN IF EXISTS source_canonical_version_id,
  DROP COLUMN IF EXISTS source_business_id,
  DROP COLUMN IF EXISTS source_tenant_user_id,
  DROP COLUMN IF EXISTS source_voice_context_id,
  DROP COLUMN IF EXISTS source_voice_conversation_output_id,
  DROP COLUMN IF EXISTS source_public_experience_session_id;

CREATE OR REPLACE FUNCTION public.zeya_store_voice_conversation_candidates(
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

REVOKE ALL ON FUNCTION public.zeya_store_voice_conversation_candidates(UUID,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_store_voice_conversation_candidates(UUID,TEXT,JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
