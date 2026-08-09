BEGIN;

ALTER TABLE public.direct_hire_onboarding_sessions
  DROP CONSTRAINT IF EXISTS direct_hire_onboarding_sessions_onboarding_state_check;

ALTER TABLE public.direct_hire_onboarding_sessions
  ADD CONSTRAINT direct_hire_onboarding_sessions_onboarding_state_check
  CHECK (onboarding_state IN ('preparation', 'employment_accepted'));

COMMIT;
