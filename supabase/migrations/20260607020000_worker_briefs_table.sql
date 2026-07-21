-- Normalized migration version: 20260607020000.
-- ═══════════════════════════════════════════════════════════════════════════
-- WorkerBriefs Persistence Table
-- Date: 2026-06-07
-- Purpose: Persist WorkerBrief data for complete call traceability
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Table: worker_briefs
-- Stores complete WorkerBrief context from Isaiah to Veya
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worker_briefs (
  id TEXT PRIMARY KEY,

  -- Identifiers and linkage
  mission_id TEXT NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Target information
  target_name TEXT,
  target_phone TEXT,

  -- Brief context
  objective TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  company_context TEXT,
  lead_context TEXT,

  -- Guidance arrays (stored as JSON)
  key_questions JSONB DEFAULT '[]'::JSONB,
  objection_guidance JSONB DEFAULT '[]'::JSONB,
  escalation_rules JSONB DEFAULT '[]'::JSONB,

  -- Tone and requirements
  tone_guidance TEXT,
  success_criteria TEXT,

  -- Dynamic variables for runtime substitution
  dynamic_variables JSONB DEFAULT '{}'::JSONB,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_worker_briefs_mission_id ON worker_briefs(mission_id);
CREATE INDEX IF NOT EXISTS idx_worker_briefs_business_id ON worker_briefs(business_id);
CREATE INDEX IF NOT EXISTS idx_worker_briefs_created_at ON worker_briefs(created_at DESC);

-- Enable Row Level Security
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'worker_briefs' AND rowsecurity = true
  ) THEN
    ALTER TABLE worker_briefs ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create RLS policies
DROP POLICY IF EXISTS "users_can_see_own_business_briefs" ON worker_briefs;
CREATE POLICY "users_can_see_own_business_briefs"
  ON worker_briefs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_briefs" ON worker_briefs;
CREATE POLICY "users_can_insert_own_business_briefs"
  ON worker_briefs FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- Create function for auto-updating updated_at column
CREATE OR REPLACE FUNCTION update_worker_briefs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for auto-update
DROP TRIGGER IF EXISTS worker_briefs_updated_at ON worker_briefs;
CREATE TRIGGER worker_briefs_updated_at
  BEFORE UPDATE ON worker_briefs
  FOR EACH ROW EXECUTE FUNCTION update_worker_briefs_updated_at();
