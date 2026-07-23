BEGIN;

ALTER TABLE public.representation_proposals
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.representation_proposals
  ALTER COLUMN affected_element_ids SET DEFAULT ARRAY[]::uuid[],
  ALTER COLUMN supporting_observation_ids SET DEFAULT ARRAY[]::uuid[];

COMMIT;
