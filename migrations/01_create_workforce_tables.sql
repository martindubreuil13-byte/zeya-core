-- Zeya Workforce Layer v1
-- Sales agents and mission assignments

-- ─── Sales Agents ────────────────────────────────────────────────────────────
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

CREATE INDEX idx_sales_agents_business_id ON sales_agents(business_id);
CREATE INDEX idx_sales_agents_status ON sales_agents(status);

-- RLS: Users can only see sales_agents for their own business
ALTER TABLE sales_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_see_own_business_agents"
  ON sales_agents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

CREATE POLICY "users_can_insert_own_business_agents"
  ON sales_agents FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

CREATE POLICY "users_can_update_own_business_agents"
  ON sales_agents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- ─── Mission Assignments ─────────────────────────────────────────────────────
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

CREATE INDEX idx_mission_assignments_business_id ON mission_assignments(business_id);
CREATE INDEX idx_mission_assignments_mission_key ON mission_assignments(mission_key);
CREATE INDEX idx_mission_assignments_agent_id ON mission_assignments(agent_id);
CREATE INDEX idx_mission_assignments_status ON mission_assignments(status);

-- RLS: Users can only see assignments for their own business
ALTER TABLE mission_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_see_own_business_assignments"
  ON mission_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

CREATE POLICY "users_can_insert_own_business_assignments"
  ON mission_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

CREATE POLICY "users_can_update_own_business_assignments"
  ON mission_assignments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

-- ─── Helper: Ensure default agent exists ────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_default_agent(p_business_id UUID)
RETURNS TABLE(agent_id UUID, agent_name TEXT, agent_status TEXT) AS $$
BEGIN
  -- Check if default agent already exists
  IF NOT EXISTS (SELECT 1 FROM sales_agents WHERE business_id = p_business_id AND name = 'Maya') THEN
    INSERT INTO sales_agents (business_id, name, role, status, language)
    VALUES (p_business_id, 'Maya', 'caller', 'available', 'English');
  END IF;

  RETURN QUERY
  SELECT sa.id, sa.name, sa.status
  FROM sales_agents sa
  WHERE sa.business_id = p_business_id AND sa.name = 'Maya'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
