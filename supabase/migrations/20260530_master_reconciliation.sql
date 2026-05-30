-- ═══════════════════════════════════════════════════════════════════════════
-- Zeya Database Master Reconciliation Migration
-- Date: 2026-05-30
-- Purpose: Bring database to state required by current codebase
-- Safety: Idempotent, preserves all data, safe for multiple runs
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- WORKFORCE LAYER: Sales Agents Table
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'caller',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'inactive')),
  language TEXT NOT NULL DEFAULT 'English',
  voice_profile TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sales_agents_business_id ON sales_agents(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_agents_status ON sales_agents(status);

-- Enable Row Level Security
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'sales_agents' AND rowsecurity = true
  ) THEN
    ALTER TABLE sales_agents ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create RLS policies (drop and recreate for idempotence)
DROP POLICY IF EXISTS "users_can_see_own_business_agents" ON sales_agents;
CREATE POLICY "users_can_see_own_business_agents"
  ON sales_agents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_agents" ON sales_agents;
CREATE POLICY "users_can_insert_own_business_agents"
  ON sales_agents FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_update_own_business_agents" ON sales_agents;
CREATE POLICY "users_can_update_own_business_agents"
  ON sales_agents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- Create function for auto-updating updated_at column
CREATE OR REPLACE FUNCTION update_sales_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for auto-update
DROP TRIGGER IF EXISTS sales_agents_updated_at ON sales_agents;
CREATE TRIGGER sales_agents_updated_at
  BEFORE UPDATE ON sales_agents
  FOR EACH ROW EXECUTE FUNCTION update_sales_agents_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- WORKFORCE LAYER: Mission Assignments Table
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mission_key TEXT NOT NULL,
  agent_id UUID NOT NULL REFERENCES sales_agents(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL DEFAULT 'caller_brief',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  brief_snapshot TEXT,
  selected_lead_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_mission_assignments_business_id ON mission_assignments(business_id);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_mission_key ON mission_assignments(mission_key);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_agent_id ON mission_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_status ON mission_assignments(status);

-- Enable Row Level Security
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'mission_assignments' AND rowsecurity = true
  ) THEN
    ALTER TABLE mission_assignments ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create RLS policies (drop and recreate for idempotence)
DROP POLICY IF EXISTS "users_can_see_own_business_assignments" ON mission_assignments;
CREATE POLICY "users_can_see_own_business_assignments"
  ON mission_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_assignments" ON mission_assignments;
CREATE POLICY "users_can_insert_own_business_assignments"
  ON mission_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_update_own_business_assignments" ON mission_assignments;
CREATE POLICY "users_can_update_own_business_assignments"
  ON mission_assignments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- Create function for auto-updating updated_at column
CREATE OR REPLACE FUNCTION update_mission_assignments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for auto-update
DROP TRIGGER IF EXISTS mission_assignments_updated_at ON mission_assignments;
CREATE TRIGGER mission_assignments_updated_at
  BEFORE UPDATE ON mission_assignments
  FOR EACH ROW EXECUTE FUNCTION update_mission_assignments_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS: Workforce Management
-- ──────────────────────────────────────────────────────────────────────────

-- Ensure default "Maya" caller agent exists for a business
-- Returns: agent_id, agent_name, agent_status
-- Called by: GET /api/zeya/sales-agents (every time)
-- Safe: Idempotent - only inserts if Maya doesn't exist
CREATE OR REPLACE FUNCTION ensure_default_agent(p_business_id UUID)
RETURNS TABLE(agent_id UUID, agent_name TEXT, agent_status TEXT) AS $$
BEGIN
  -- Check if default agent already exists for this business
  IF NOT EXISTS (
    SELECT 1 FROM sales_agents
    WHERE business_id = p_business_id AND name = 'Maya'
  ) THEN
    -- Insert new default agent "Maya"
    INSERT INTO sales_agents (business_id, name, role, status, language)
    VALUES (p_business_id, 'Maya', 'caller', 'available', 'English')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Return the Maya agent for this business
  RETURN QUERY
  SELECT sa.id, sa.name, sa.status
  FROM sales_agents sa
  WHERE sa.business_id = p_business_id AND sa.name = 'Maya'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────
-- EXISTING TABLES: Verify and Complete mission_leads
-- ──────────────────────────────────────────────────────────────────────────

-- Ensure mission_leads table exists (created by earlier migration)
CREATE TABLE IF NOT EXISTS mission_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mission_key TEXT,
  company_name TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  industry TEXT,
  city TEXT,
  country TEXT,
  source TEXT,
  notes TEXT,
  fit_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (fit_status IN ('likely_match','possible_match','weak_match','unreviewed')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','selected','rejected','called','follow_up','closed')),
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Ensure all mission_leads indexes exist
CREATE INDEX IF NOT EXISTS mission_leads_business_id_idx ON mission_leads(business_id);
CREATE INDEX IF NOT EXISTS mission_leads_mission_key_idx ON mission_leads(business_id, mission_key);
CREATE INDEX IF NOT EXISTS mission_leads_fit_status_idx ON mission_leads(business_id, fit_status);

-- Ensure mission_leads RLS is enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'mission_leads' AND rowsecurity = true
  ) THEN
    ALTER TABLE mission_leads ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Ensure mission_leads RLS policy
DROP POLICY IF EXISTS "Users can manage leads for their own businesses" ON mission_leads;
CREATE POLICY "Users can manage leads for their own businesses"
  ON mission_leads
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- Ensure mission_leads trigger for updated_at
DROP TRIGGER IF EXISTS mission_leads_updated_at ON mission_leads;
CREATE OR REPLACE FUNCTION update_mission_leads_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER mission_leads_updated_at
  BEFORE UPDATE ON mission_leads
  FOR EACH ROW EXECUTE FUNCTION update_mission_leads_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Final audit output
-- ═══════════════════════════════════════════════════════════════════════════

-- Output verification results (run after migration completes)
DO $$
DECLARE
  sales_agents_exists BOOLEAN;
  mission_assignments_exists BOOLEAN;
  ensure_default_agent_exists BOOLEAN;
BEGIN
  -- Check tables
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'sales_agents'
  ) INTO sales_agents_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'mission_assignments'
  ) INTO mission_assignments_exists;

  -- Check function
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_name = 'ensure_default_agent'
  ) INTO ensure_default_agent_exists;

  -- Log results (visible in migration output)
  RAISE NOTICE '[Zeya Migration] Sales Agents table: %', CASE WHEN sales_agents_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '[Zeya Migration] Mission Assignments table: %', CASE WHEN mission_assignments_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '[Zeya Migration] ensure_default_agent function: %', CASE WHEN ensure_default_agent_exists THEN 'OK' ELSE 'MISSING' END;
END $$;

-- End of master reconciliation migration
