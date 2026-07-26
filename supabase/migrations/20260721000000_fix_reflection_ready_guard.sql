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

-- Representation-brief storage and persistence are intentionally owned by
-- 20260721100000_public_experience_representation_brief.sql. Defining a
-- preliminary, incompatible table here made clean migration-chain rebuilds
-- fail when the canonical migration attempted to create its stricter schema.

COMMIT;
