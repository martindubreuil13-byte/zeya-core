BEGIN;

CREATE TABLE public.public_experience_test_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_experience_session_id uuid NOT NULL UNIQUE REFERENCES public.public_experience_sessions(id) ON DELETE CASCADE,
  tenant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_version text NOT NULL DEFAULT '2.1',
  environment text,
  deployment_identifier text,
  browser_detected_completion_at timestamptz,
  first_visible_acknowledgement_at timestamptz,
  reflection_started_at timestamptz,
  brief_displayed_at timestamptz,
  first_post_call_voice_started_at timestamptz,
  errors_and_retries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors_and_retries)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_experience_test_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_experience_test_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.public_experience_test_records TO service_role;

CREATE FUNCTION public.zeya_create_public_experience_test_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.public_experience_test_records(public_experience_session_id,tenant_user_id,environment,deployment_identifier)
  VALUES(NEW.id,NEW.tenant_user_id,current_setting('zeya.environment',true),current_setting('zeya.deployment_identifier',true))
  ON CONFLICT(public_experience_session_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER zeya_create_public_experience_test_record
AFTER INSERT ON public.public_experience_sessions
FOR EACH ROW EXECUTE FUNCTION public.zeya_create_public_experience_test_record();

INSERT INTO public.public_experience_test_records(public_experience_session_id,tenant_user_id)
SELECT id,tenant_user_id FROM public.public_experience_sessions
ON CONFLICT(public_experience_session_id) DO NOTHING;

REVOKE ALL ON FUNCTION public.zeya_create_public_experience_test_record() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_create_public_experience_test_record() TO postgres;

COMMIT;
