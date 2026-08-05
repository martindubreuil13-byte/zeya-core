-- Employee Induction Material Collection
-- Adds storage for induction materials provided by owner after employment acceptance.
-- Materials are stored as immutable evidence, NOT canonical representation.
-- NO file storage in this phase — URLs and text only.

BEGIN;

-- Add source type for induction materials
ALTER TYPE public.evidence_source_type ADD VALUE IF NOT EXISTS 'direct_hire_induction';

COMMIT;

-- Create induction materials linkage (separate transaction for enum handling)
BEGIN;

-- Extend evidence table to link to Direct Hire induction sessions
ALTER TABLE public.evidence
  ADD COLUMN direct_hire_onboarding_session_id uuid
    REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE CASCADE,
  ADD COLUMN induction_material_type text CHECK (
    induction_material_type IS NULL OR induction_material_type IN (
      'description', 'link', 'note'
    )
  ),
  ADD COLUMN induction_material_label text,
  ADD COLUMN induction_material_url text;

-- Add onboarding state for induction workflow
ALTER TABLE public.direct_hire_onboarding_sessions
  ADD COLUMN induction_state text DEFAULT 'not_started' CHECK (
    induction_state IN ('not_started', 'material_requested', 'material_received', 'preparation_pending')
  ),
  ADD COLUMN induction_materials_count smallint NOT NULL DEFAULT 0 CHECK (
    induction_materials_count >= 0
  ),
  ADD COLUMN induction_started_at timestamptz,
  ADD COLUMN induction_materials_received_at timestamptz;

-- Index for induction lookups
CREATE INDEX idx_evidence_direct_hire_induction
  ON public.evidence(direct_hire_onboarding_session_id)
  WHERE source_type = 'direct_hire_induction';

CREATE INDEX idx_direct_hire_induction_state
  ON public.direct_hire_onboarding_sessions(induction_state);

COMMIT;
