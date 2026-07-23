BEGIN;

-- A session may accept operational diagnostics after expiry, but it may not
-- advance the visitor journey or receive new visitor-facing artifacts.
CREATE OR REPLACE FUNCTION public.zeya_enforce_public_experience_session_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user <> 'postgres'
     OR (
       current_setting('zeya.public_experience_session_write', true) <> 'on'
       AND current_setting('zeya.controlled_purge', true) <> 'on'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'public experience sessions are server controlled';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.expires_at <= transaction_timestamp()
     AND NEW.state IS DISTINCT FROM OLD.state
     AND NEW.state NOT IN (
       'expired',
       'call_failed',
       'call_unanswered',
       'call_rejected',
       'call_completed_without_transcript',
       'completion_processing_failed',
       'failed'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ410',
      MESSAGE = 'public experience session expired';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_enforce_public_experience_derived_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.public_experience_sessions session
    WHERE session.id = NEW.public_experience_session_id
      AND session.expires_at > transaction_timestamp()
      AND session.state = 'reflection_ready'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ410',
      MESSAGE = 'public experience session expired or unavailable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zeya_public_experience_brief_expiration
  ON public.public_experience_representation_briefs;
CREATE TRIGGER zeya_public_experience_brief_expiration
BEFORE INSERT ON public.public_experience_representation_briefs
FOR EACH ROW
EXECUTE FUNCTION public.zeya_enforce_public_experience_derived_artifact_insert();

DROP TRIGGER IF EXISTS zeya_public_experience_response_expiration
  ON public.public_experience_brief_responses;
CREATE TRIGGER zeya_public_experience_response_expiration
BEFORE INSERT ON public.public_experience_brief_responses
FOR EACH ROW
EXECUTE FUNCTION public.zeya_enforce_public_experience_derived_artifact_insert();

CREATE OR REPLACE FUNCTION public.zeya_complete_public_experience_call(
  p_veya_voice_context_id uuid,
  p_conversation_output_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session public.public_experience_sessions%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;
  IF p_veya_voice_context_id IS NULL OR p_conversation_output_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid completion identity';
  END IF;

  SELECT *
  INTO session
  FROM public.public_experience_sessions
  WHERE veya_voice_context_id = p_veya_voice_context_id
  FOR UPDATE;

  IF session.id IS NULL THEN RETURN 'untracked'; END IF;
  IF session.expires_at <= transaction_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ410',
      MESSAGE = 'public experience session expired';
  END IF;
  IF session.veya_conversation_output_id = p_conversation_output_id
     AND session.state = 'reflection_ready' THEN
    RETURN session.state;
  END IF;
  IF session.state NOT IN ('call_dispatched', 'call_active', 'completion_processing_failed')
     OR session.veya_conversation_output_id IS NOT NULL
     OR session.zeya_conversation_output_id IS NULL
     OR session.provider_conversation_id IS NULL
     OR session.provider_call_id IS NULL
     OR session.dispatch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'completion conflict';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.voice_conversation_outputs output
    JOIN public.voice_representation_lineage lineage
      ON lineage.voice_context_id = output.voice_context_id
    WHERE output.id = p_conversation_output_id
      AND output.voice_context_id = p_veya_voice_context_id
      AND output.conversation_id IS NOT DISTINCT FROM session.provider_conversation_id
      AND output.provider_call_id IS NOT DISTINCT FROM session.provider_call_id
      AND output.business_id = session.business_id
      AND output.business_representation_id = session.business_representation_id
      AND output.canonical_version_id = session.canonical_version_id
      AND output.provider_attested = true
      AND output.transcript_status = 'finalized'
      AND lineage.conversation_id IS NOT DISTINCT FROM session.provider_conversation_id
      AND lineage.provider_call_id IS NOT DISTINCT FROM session.provider_call_id
      AND lineage.business_id = session.business_id
      AND lineage.business_representation_id = session.business_representation_id
      AND lineage.canonical_version_id = session.canonical_version_id
      AND lineage.mission_id = session.dispatch_id
      AND lineage.created_at <= session.expires_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Veya output';
  END IF;

  PERFORM set_config('zeya.public_experience_session_write', 'on', true);
  UPDATE public.public_experience_sessions
  SET veya_conversation_output_id = p_conversation_output_id,
      state = 'reflection_ready',
      call_completed_at = transaction_timestamp(),
      updated_at = transaction_timestamp()
  WHERE id = session.id;
  RETURN 'reflection_ready';
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_persist_public_experience_representation_brief(
  p_session_id uuid,p_status text,p_structured_brief jsonb,p_spoken_brief text,
  p_confidence_level text,p_evidence_references jsonb,p_validation_outcome jsonb,
  p_generator_version text,p_provider text,p_model text,p_internal_failure_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session public.public_experience_sessions%rowtype;
  existing public.public_experience_representation_briefs%rowtype;
  artifact_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;
  SELECT * INTO session
  FROM public.public_experience_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF session.id IS NULL
     OR session.expires_at <= transaction_timestamp()
     OR session.state <> 'reflection_ready' THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ410', MESSAGE = 'public experience session expired or unavailable';
  END IF;

  SELECT * INTO existing
  FROM public.public_experience_representation_briefs
  WHERE public_experience_session_id = p_session_id;
  IF existing.id IS NOT NULL THEN
    IF existing.status = p_status
       AND existing.structured_brief IS NOT DISTINCT FROM p_structured_brief
       AND existing.spoken_brief IS NOT DISTINCT FROM p_spoken_brief
       AND existing.confidence_level = p_confidence_level
       AND existing.evidence_references = p_evidence_references
       AND existing.validation_outcome = p_validation_outcome
       AND existing.generator_version = p_generator_version
       AND existing.provider = p_provider
       AND existing.model = p_model
       AND existing.internal_failure_reason IS NOT DISTINCT FROM p_internal_failure_reason THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'representation brief identity conflict';
  END IF;

  INSERT INTO public.public_experience_representation_briefs(
    public_experience_session_id,status,structured_brief,spoken_brief,confidence_level,
    evidence_references,validation_outcome,generator_version,provider,model,internal_failure_reason
  ) VALUES (
    p_session_id,p_status,p_structured_brief,p_spoken_brief,p_confidence_level,
    p_evidence_references,p_validation_outcome,p_generator_version,p_provider,p_model,p_internal_failure_reason
  ) RETURNING id INTO artifact_id;
  RETURN artifact_id;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_enforce_public_experience_derived_artifact_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.zeya_complete_public_experience_call(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_complete_public_experience_call(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
