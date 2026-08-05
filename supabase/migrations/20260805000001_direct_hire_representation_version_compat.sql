-- Make representation_versions compatible with Direct Hire employment flow.
-- Direct Hire does not create Formation sessions or proposals, so source_proposal_id
-- must be nullable. This migration adds a discriminator column to track the actual source.
BEGIN;

-- Add source tracking and Direct Hire reference
ALTER TABLE public.representation_versions
  ADD COLUMN source_type text DEFAULT 'proposal' NOT NULL CHECK (
    source_type IN ('proposal', 'direct_hire_employment')
  ),
  ADD COLUMN source_direct_hire_onboarding_session_id uuid
    REFERENCES public.direct_hire_onboarding_sessions(id);

-- Make source_proposal_id nullable (proposal-sourced versions have it, direct_hire versions don't)
ALTER TABLE public.representation_versions
  DROP CONSTRAINT IF EXISTS representation_versions_source_proposal_id_fkey,
  ALTER COLUMN source_proposal_id DROP NOT NULL;

-- Re-add the foreign key constraint
ALTER TABLE public.representation_versions
  ADD CONSTRAINT representation_versions_source_proposal_id_fkey
    FOREIGN KEY (source_proposal_id) REFERENCES public.representation_proposals(id);

-- Ensure exactly one source is populated
ALTER TABLE public.representation_versions
  ADD CONSTRAINT representation_versions_source_discriminator CHECK (
    (source_type = 'proposal' AND source_proposal_id IS NOT NULL AND source_direct_hire_onboarding_session_id IS NULL)
    OR (source_type = 'direct_hire_employment' AND source_proposal_id IS NULL AND source_direct_hire_onboarding_session_id IS NOT NULL)
  );

-- Index for Direct Hire lineage
CREATE INDEX idx_representation_versions_direct_hire_onboarding
  ON public.representation_versions(source_direct_hire_onboarding_session_id);

COMMIT;
