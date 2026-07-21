BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_persist_public_experience_representation_brief(
  p_session_id uuid,p_status text,p_structured_brief jsonb,p_spoken_brief text,
  p_confidence_level text,p_evidence_references jsonb,p_validation_outcome jsonb,
  p_generator_version text,p_provider text,p_model text,p_internal_failure_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_session public.public_experience_sessions%rowtype;
  v_existing public.public_experience_representation_briefs%rowtype;
  v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;

  SELECT * INTO v_session
  FROM public.public_experience_sessions
  WHERE id=p_session_id
  FOR UPDATE;
  IF v_session.id IS NULL OR v_session.expires_at<=now() OR v_session.state<>'reflection_ready' THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='session unavailable';
  END IF;

  SELECT * INTO v_existing
  FROM public.public_experience_representation_briefs
  WHERE public_experience_session_id=p_session_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status=p_status
       AND v_existing.structured_brief IS NOT DISTINCT FROM p_structured_brief
       AND v_existing.spoken_brief IS NOT DISTINCT FROM p_spoken_brief
       AND v_existing.confidence_level=p_confidence_level
       AND v_existing.evidence_references=p_evidence_references
       AND v_existing.validation_outcome=p_validation_outcome
       AND v_existing.generator_version=p_generator_version
       AND v_existing.provider=p_provider
       AND v_existing.model=p_model
       AND v_existing.internal_failure_reason IS NOT DISTINCT FROM p_internal_failure_reason THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='representation brief identity conflict';
  END IF;

  INSERT INTO public.public_experience_representation_briefs(
    public_experience_session_id,status,structured_brief,spoken_brief,confidence_level,
    evidence_references,validation_outcome,generator_version,provider,model,internal_failure_reason
  ) VALUES(
    p_session_id,p_status,p_structured_brief,p_spoken_brief,p_confidence_level,
    p_evidence_references,p_validation_outcome,p_generator_version,p_provider,p_model,p_internal_failure_reason
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text) TO service_role;

COMMIT;
