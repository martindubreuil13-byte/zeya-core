-- Normalized migration version: 20260607010000.
-- ═══════════════════════════════════════════════════════════════════════════
-- Brief-Conversation Mapping Table
-- Date: 2026-06-07
-- Purpose: Persist mappings for webhook routing after server restart
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS brief_conversation_mappings (
  worker_brief_id TEXT PRIMARY KEY,
  conversation_id TEXT UNIQUE,
  mission_id TEXT NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_brief_conv_mappings_conversation_id
ON brief_conversation_mappings(conversation_id);

CREATE INDEX IF NOT EXISTS idx_brief_conv_mappings_mission_id
ON brief_conversation_mappings(mission_id);

CREATE INDEX IF NOT EXISTS idx_brief_conv_mappings_business_id
ON brief_conversation_mappings(business_id);

-- Enable Row Level Security
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'brief_conversation_mappings' AND rowsecurity = true
  ) THEN
    ALTER TABLE brief_conversation_mappings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create RLS policies
DROP POLICY IF EXISTS "users_can_see_own_business_mappings" ON brief_conversation_mappings;
CREATE POLICY "users_can_see_own_business_mappings"
  ON brief_conversation_mappings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_mappings" ON brief_conversation_mappings;
CREATE POLICY "users_can_insert_own_business_mappings"
  ON brief_conversation_mappings FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_update_own_business_mappings" ON brief_conversation_mappings;
CREATE POLICY "users_can_update_own_business_mappings"
  ON brief_conversation_mappings FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- Create function for auto-updating updated_at column
CREATE OR REPLACE FUNCTION update_brief_conversation_mappings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for auto-update
DROP TRIGGER IF EXISTS brief_conv_mappings_updated_at ON brief_conversation_mappings;
CREATE TRIGGER brief_conv_mappings_updated_at
  BEFORE UPDATE ON brief_conversation_mappings
  FOR EACH ROW EXECUTE FUNCTION update_brief_conversation_mappings_updated_at();
