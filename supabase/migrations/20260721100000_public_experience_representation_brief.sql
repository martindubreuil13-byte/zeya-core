BEGIN;

CREATE TABLE public.public_experience_representation_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_experience_session_id uuid NOT NULL UNIQUE REFERENCES public.public_experience_sessions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('valid','requires_clarification','failed')),
  structured_brief jsonb,
  spoken_brief text,
  confidence_level text NOT NULL CHECK (confidence_level IN ('high','medium','requires_clarification')),
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_outcome jsonb NOT NULL,
  generator_version text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  internal_failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='valid')=(structured_brief IS NOT NULL AND spoken_brief IS NOT NULL)),
  CHECK (internal_failure_reason IS NULL OR status<>'valid')
);

CREATE TABLE public.public_experience_brief_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_experience_session_id uuid NOT NULL REFERENCES public.public_experience_sessions(id) ON DELETE CASCADE,
  representation_brief_id uuid NOT NULL REFERENCES public.public_experience_representation_briefs(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  response_type text NOT NULL CHECK (response_type IN ('confirm','refine','redirect','continue')),
  response_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(public_experience_session_id,request_key),
  CHECK (
    (response_type IN ('refine','redirect') AND response_text IS NOT NULL AND length(btrim(response_text))>0)
    OR (response_type IN ('confirm','continue') AND response_text IS NULL)
  )
);

ALTER TABLE public.public_experience_representation_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_experience_brief_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_experience_representation_briefs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.public_experience_brief_responses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_experience_representation_briefs TO service_role;
GRANT SELECT ON public.public_experience_brief_responses TO service_role;

CREATE FUNCTION public.zeya_persist_public_experience_representation_brief(
  p_session_id uuid,p_status text,p_structured_brief jsonb,p_spoken_brief text,
  p_confidence_level text,p_evidence_references jsonb,p_validation_outcome jsonb,
  p_generator_version text,p_provider text,p_model text,p_internal_failure_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_experience_sessions s WHERE s.id=p_session_id AND s.state='reflection_ready') THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='session unavailable';
  END IF;
  INSERT INTO public.public_experience_representation_briefs(
    public_experience_session_id,status,structured_brief,spoken_brief,confidence_level,
    evidence_references,validation_outcome,generator_version,provider,model,internal_failure_reason
  ) VALUES(p_session_id,p_status,p_structured_brief,p_spoken_brief,p_confidence_level,
    p_evidence_references,p_validation_outcome,p_generator_version,p_provider,p_model,p_internal_failure_reason)
  ON CONFLICT(public_experience_session_id) DO NOTHING;
  SELECT id INTO v_id FROM public.public_experience_representation_briefs WHERE public_experience_session_id=p_session_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.zeya_record_public_experience_brief_response(
  p_token_hash text,p_brief_id uuid,p_request_key uuid,p_response_type text,p_response_text text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_session public.public_experience_sessions%rowtype; v_response public.public_experience_brief_responses%rowtype;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_session FROM public.public_experience_sessions WHERE token_hash=p_token_hash;
  IF v_session.id IS NULL OR v_session.expires_at<=now() OR v_session.state<>'reflection_ready' THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='session unavailable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_experience_representation_briefs b WHERE b.id=p_brief_id AND b.public_experience_session_id=v_session.id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='brief unavailable';
  END IF;
  INSERT INTO public.public_experience_brief_responses(public_experience_session_id,representation_brief_id,request_key,response_type,response_text)
  VALUES(v_session.id,p_brief_id,p_request_key,p_response_type,NULLIF(btrim(p_response_text),''))
  ON CONFLICT(public_experience_session_id,request_key) DO NOTHING;
  SELECT * INTO v_response FROM public.public_experience_brief_responses WHERE public_experience_session_id=v_session.id AND request_key=p_request_key;
  IF v_response.response_type IS DISTINCT FROM p_response_type OR v_response.response_text IS DISTINCT FROM NULLIF(btrim(p_response_text),'') THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='response identity conflict';
  END IF;
  RETURN v_response.id;
END; $$;

CREATE FUNCTION public.zeya_prevent_public_experience_brief_update() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Experience brief records are immutable'; END; $$;
CREATE TRIGGER zeya_public_experience_brief_immutable BEFORE UPDATE ON public.public_experience_representation_briefs FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_public_experience_brief_update();
CREATE TRIGGER zeya_public_experience_response_immutable BEFORE UPDATE ON public.public_experience_brief_responses FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_public_experience_brief_update();

REVOKE ALL ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_record_public_experience_brief_response(text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_public_experience_representation_brief(uuid,text,jsonb,text,text,jsonb,jsonb,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_public_experience_brief_response(text,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.zeya_prevent_public_experience_brief_update() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
