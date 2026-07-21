BEGIN;

-- Fix: zeya_complete_public_experience_call must verify zeya_conversation_output_id is set
-- This prevents reflection_ready from being set when Zeya finalization failed

DROP FUNCTION IF EXISTS public.zeya_complete_public_experience_call(UUID, UUID);

CREATE FUNCTION public.zeya_complete_public_experience_call(p_veya_voice_context_id UUID, p_conversation_output_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v public.public_experience_sessions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;

  SELECT * INTO v FROM public.public_experience_sessions WHERE veya_voice_context_id=p_veya_voice_context_id FOR UPDATE;

  IF v.id IS NULL THEN RETURN 'untracked'; END IF;

  -- Idempotent: if already in reflection_ready with this output, return it
  IF v.veya_conversation_output_id=p_conversation_output_id AND v.state='reflection_ready' THEN RETURN v.state; END IF;

  -- Can only complete call if currently in call_dispatched or call_active
  IF v.state NOT IN ('call_dispatched','call_active') OR v.veya_conversation_output_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='completion conflict';
  END IF;

  -- CRITICAL: zeya_conversation_output_id must be set before transitioning to reflection_ready
  -- If Zeya finalization failed, this check will prevent incomplete reflection processing
  IF v.zeya_conversation_output_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='zeya conversation not finalized; cannot transition to reflection_ready';
  END IF;

  -- Verify Veya output is valid and finalized
  IF NOT EXISTS (
    SELECT 1 FROM public.voice_conversation_outputs o
    WHERE o.id=p_conversation_output_id
      AND o.voice_context_id=p_veya_voice_context_id
      AND o.provider_attested=true
      AND o.transcript_status='finalized'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid Veya output';
  END IF;

  PERFORM set_config('zeya.public_experience_session_write','on',true);
  UPDATE public.public_experience_sessions
    SET veya_conversation_output_id=p_conversation_output_id,
        state='reflection_ready',
        call_completed_at=now(),
        updated_at=now()
    WHERE id=v.id;

  RETURN 'reflection_ready';
END;
$$;

GRANT EXECUTE ON FUNCTION public.zeya_complete_public_experience_call(UUID, UUID) TO service_role;

-- Add database table for storing representation briefs (idempotent storage)
CREATE TABLE IF NOT EXISTS public.public_experience_representation_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_experience_session_id UUID NOT NULL UNIQUE REFERENCES public.public_experience_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('valid', 'requires_clarification', 'failed')),
  structured_brief JSONB,
  spoken_brief TEXT,
  confidence_level TEXT,
  evidence_references JSONB,
  validation_outcome JSONB,
  generator_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  internal_failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT public_experience_brief_session_fk
    FOREIGN KEY (public_experience_session_id)
    REFERENCES public.public_experience_sessions(id)
);

CREATE INDEX IF NOT EXISTS public_experience_briefs_session_idx
  ON public.public_experience_representation_briefs(public_experience_session_id);

-- RPC to persist representation brief (idempotent)
DROP FUNCTION IF EXISTS public.zeya_persist_public_experience_representation_brief(UUID, TEXT, JSONB, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.zeya_persist_public_experience_representation_brief(
  p_session_id UUID,
  p_status TEXT,
  p_structured_brief JSONB,
  p_spoken_brief TEXT,
  p_confidence_level TEXT,
  p_evidence_references JSONB,
  p_validation_outcome JSONB,
  p_generator_version TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_internal_failure_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_brief_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;

  -- Idempotent: check if brief already exists for this session
  SELECT id INTO v_brief_id FROM public.public_experience_representation_briefs
    WHERE public_experience_session_id=p_session_id;

  IF v_brief_id IS NOT NULL THEN
    RETURN v_brief_id;
  END IF;

  -- Insert new brief
  INSERT INTO public.public_experience_representation_briefs (
    public_experience_session_id, status, structured_brief, spoken_brief,
    confidence_level, evidence_references, validation_outcome,
    generator_version, provider, model, internal_failure_reason
  ) VALUES (
    p_session_id, p_status, p_structured_brief, p_spoken_brief,
    p_confidence_level, p_evidence_references, p_validation_outcome,
    p_generator_version, p_provider, p_model, p_internal_failure_reason
  )
  RETURNING id INTO v_brief_id;

  RETURN v_brief_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.zeya_persist_public_experience_representation_brief(UUID, TEXT, JSONB, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Enable RLS on briefs table
ALTER TABLE public.public_experience_representation_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_experience_representation_briefs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_experience_representation_briefs TO service_role;

COMMIT;
