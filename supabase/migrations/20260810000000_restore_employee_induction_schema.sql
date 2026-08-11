-- Restore the additive employee-induction schema absent from Preview.
-- Forward-only repair for 20260805000002; no existing rows are rewritten.

BEGIN;

ALTER TYPE public.evidence_source_type
  ADD VALUE IF NOT EXISTS 'direct_hire_induction';

COMMIT;

BEGIN;

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS direct_hire_onboarding_session_id uuid
    REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS induction_material_type text CHECK (
    induction_material_type IS NULL OR induction_material_type IN (
      'description', 'link', 'note'
    )
  ),
  ADD COLUMN IF NOT EXISTS induction_material_label text,
  ADD COLUMN IF NOT EXISTS induction_material_url text;

ALTER TABLE public.direct_hire_onboarding_sessions
  ADD COLUMN IF NOT EXISTS induction_state text DEFAULT 'not_started' CHECK (
    induction_state IN (
      'not_started', 'material_requested', 'material_received', 'preparation_pending'
    )
  ),
  ADD COLUMN IF NOT EXISTS induction_materials_count smallint NOT NULL DEFAULT 0 CHECK (
    induction_materials_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS induction_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS induction_materials_received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_evidence_direct_hire_induction
  ON public.evidence(direct_hire_onboarding_session_id)
  WHERE source_type = 'direct_hire_induction';

CREATE INDEX IF NOT EXISTS idx_direct_hire_induction_state
  ON public.direct_hire_onboarding_sessions(induction_state);

COMMIT;
