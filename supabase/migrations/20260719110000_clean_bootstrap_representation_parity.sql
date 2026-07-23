BEGIN;

-- Clean branches historically missed columns that existing environments had
-- acquired before the repository migration history was normalized.
ALTER TABLE public.approval_decisions
  ADD COLUMN IF NOT EXISTS business_representation_id uuid
    REFERENCES public.business_representations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS approver_user_id uuid
    REFERENCES auth.users(id) ON DELETE RESTRICT;

UPDATE public.approval_decisions a
SET business_representation_id=p.business_representation_id
FROM public.representation_proposals p
WHERE a.representation_proposal_id=p.id
  AND a.business_representation_id IS NULL;

ALTER TABLE public.approval_decisions
  ALTER COLUMN business_representation_id SET NOT NULL;

ALTER TABLE public.confidence_assessments
  ADD COLUMN IF NOT EXISTS business_representation_id uuid
    REFERENCES public.business_representations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS confidence_band text,
  ADD COLUMN IF NOT EXISTS factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS affected_element_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;

UPDATE public.confidence_assessments c
SET business_representation_id=v.business_representation_id
FROM public.representation_versions v
WHERE c.representation_version_id=v.id
  AND c.business_representation_id IS NULL;

ALTER TABLE public.confidence_assessments
  ALTER COLUMN business_representation_id SET NOT NULL;

COMMIT;
