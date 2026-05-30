# Zeya Database Audit Report
**Generated**: 2026-05-30  
**Purpose**: Reconcile actual Supabase database against current codebase requirements

---

## SECTION 1: Database Audit

### Tables Status

#### ✅ EXISTING TABLES

**`businesses`** (auth.users reference)
- Required columns (from code):
  - user_id (uuid, FK→auth.users)
  - business_name (text)
  - industry (text)
  - business_profile (jsonb) - stores BusinessMemory fields
  - memory_summary (text)
  - created_at (timestamptz)
  - updated_at (timestamptz)
- RLS: Likely scoped by user_id

**`memory_events`**
- Required columns (from code):
  - id (uuid)
  - business_id (uuid, FK→businesses)
  - event_type (text) - "onboarding_answer"|"correction"|"confirmation"|"update"
  - metadata (jsonb)
  - created_at (timestamptz)
- Queries: getMemoryEvents(businessId), appendMemoryEvent()

**`messages`**
- Required columns (from code):
  - id (uuid)
  - session_id (uuid, FK→sessions)
  - role ("user"|"assistant")
  - plaintext_body (text)
  - created_at (timestamptz)
- Queries: getSessionMessages(sessionId, limit)

**`mission_leads`** (status: EXISTS via migration)
- Columns: id, business_id, mission_key, company_name, contact_name, phone, email, website, industry, city, country, source, notes, fit_status, status, raw_payload, created_at, updated_at
- Constraints: fit_status CHECK, status CHECK
- Indexes: business_id, (business_id, mission_key), (business_id, fit_status)
- RLS: "Users can manage leads for their own businesses"
- Trigger: mission_leads_updated_at (updates updated_at before UPDATE)

**`sessions`**
- Required columns (from code):
  - id (uuid)
  - business_id (uuid, FK→businesses)
  - session_type (text) - "briefing_voice"|"onboarding_voice"
  - started_at (timestamptz)
  - completed_at (timestamptz, nullable)
- Queries: createSession(), getLatestSession(businessId), getSessionMessages(sessionId)

#### ❌ MISSING TABLES

**`sales_agents`**
- Required columns: id, business_id, name, role, status, language, voice_profile, notes, created_at, updated_at
- Constraints: status CHECK ('available'|'busy'|'inactive')
- Indexes: business_id, status
- RLS: SELECT/INSERT/UPDATE for own business
- Used by: getSalesAgents(), createSalesAgent(), getOrCreateDefaultAgent()

**`mission_assignments`**
- Required columns: id, business_id, mission_key, agent_id, assignment_type, status, brief_snapshot, selected_lead_count, created_at, updated_at
- Constraints: status CHECK ('pending'|'in_progress'|'completed'|'failed')
- Indexes: business_id, mission_key, agent_id, status
- RLS: SELECT/INSERT/UPDATE for own business
- Used by: createMissionAssignment(), getMissionAssignments(), getLatestMissionAssignment()

#### ❓ FUNCTIONS STATUS

**`ensure_default_agent(p_business_id UUID)`**
- Status: MISSING
- Purpose: Create "Maya" default caller agent if not exists
- Returns: TABLE(agent_id UUID, agent_name TEXT, agent_status TEXT)
- Called by: GET /api/zeya/sales-agents

**Update triggers for created_at/updated_at**
- Status: mission_leads has trigger, others missing
- Required for: sales_agents, mission_assignments

---

## SECTION 2: Gap Analysis

### Missing Objects Summary

| Category | Object | Impact | Priority |
|----------|--------|--------|----------|
| Table | sales_agents | CRITICAL - Cannot assign briefs to callers | HIGH |
| Table | mission_assignments | CRITICAL - Cannot track assignments | HIGH |
| Function | ensure_default_agent() | CRITICAL - Cannot seed default "Maya" agent | HIGH |
| Trigger | sales_agents_updated_at | MEDIUM - Data integrity | MEDIUM |
| Trigger | mission_assignments_updated_at | MEDIUM - Data integrity | MEDIUM |
| Column | business_profile.caller_brief | LOW - Using JSONB, auto-supported | LOW |
| Column | business_profile.current_mission_detail | LOW - Using JSONB, auto-supported | LOW |

### Verification Checklist

- [ ] sales_agents table created with correct columns and indexes
- [ ] mission_assignments table created with correct columns and indexes
- [ ] ensure_default_agent() function exists and works
- [ ] RLS policies enabled on both workforce tables
- [ ] Triggers created for updated_at columns
- [ ] business_profile JSONB supports all BusinessMemory fields (no schema changes needed)
- [ ] All API routes can successfully query new tables
- [ ] Default agent "Maya" seeds correctly on first API call

---

## SECTION 3: Master SQL Migration

This migration is **idempotent** and **safe to run multiple times**. It:
- Uses CREATE TABLE IF NOT EXISTS
- Uses CREATE INDEX IF NOT EXISTS
- Uses CREATE OR REPLACE FUNCTION
- Preserves existing data
- Enables RLS safely (idempotent)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Zeya Database Master Migration - Complete Reconciliation
-- Purpose: Bring database to state required by current codebase
-- Scope: Sales Agents, Mission Assignments, Workforce Layer
-- Safety: Idempotent, preserves data, safe for multiple runs
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- WORKFORCE LAYER: Sales Agents
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sales_agents_business_id ON sales_agents(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_agents_status ON sales_agents(status);

-- Enable RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'sales_agents' AND rowsecurity = true
  ) THEN
    ALTER TABLE sales_agents ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- RLS Policies (idempotent creation)
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

-- Auto-update updated_at on sales_agents
CREATE OR REPLACE FUNCTION update_sales_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_agents_updated_at ON sales_agents;
CREATE TRIGGER sales_agents_updated_at
  BEFORE UPDATE ON sales_agents
  FOR EACH ROW EXECUTE FUNCTION update_sales_agents_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- WORKFORCE LAYER: Mission Assignments
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mission_assignments_business_id ON mission_assignments(business_id);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_mission_key ON mission_assignments(mission_key);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_agent_id ON mission_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_mission_assignments_status ON mission_assignments(status);

-- Enable RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'mission_assignments' AND rowsecurity = true
  ) THEN
    ALTER TABLE mission_assignments ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- RLS Policies (idempotent creation)
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

-- Auto-update updated_at on mission_assignments
CREATE OR REPLACE FUNCTION update_mission_assignments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mission_assignments_updated_at ON mission_assignments;
CREATE TRIGGER mission_assignments_updated_at
  BEFORE UPDATE ON mission_assignments
  FOR EACH ROW EXECUTE FUNCTION update_mission_assignments_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS: Workforce
-- ──────────────────────────────────────────────────────────────────────────

-- Create default agent "Maya" if not exists for a business
CREATE OR REPLACE FUNCTION ensure_default_agent(p_business_id UUID)
RETURNS TABLE(agent_id UUID, agent_name TEXT, agent_status TEXT) AS $$
BEGIN
  -- Check if default agent already exists
  IF NOT EXISTS (SELECT 1 FROM sales_agents WHERE business_id = p_business_id AND name = 'Maya') THEN
    INSERT INTO sales_agents (business_id, name, role, status, language)
    VALUES (p_business_id, 'Maya', 'caller', 'available', 'English')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT sa.id, sa.name, sa.status
  FROM sales_agents sa
  WHERE sa.business_id = p_business_id AND sa.name = 'Maya'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────
-- EXISTING TABLES: Verify structure
-- ──────────────────────────────────────────────────────────────────────────

-- mission_leads should already exist from earlier migration (20260529_mission_leads.sql)
-- If missing, create it:
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

-- Ensure mission_leads indexes exist
CREATE INDEX IF NOT EXISTS mission_leads_business_id_idx ON mission_leads(business_id);
CREATE INDEX IF NOT EXISTS mission_leads_mission_key_idx ON mission_leads(business_id, mission_key);
CREATE INDEX IF NOT EXISTS mission_leads_fit_status_idx ON mission_leads(business_id, fit_status);

-- Ensure mission_leads RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'mission_leads' AND rowsecurity = true
  ) THEN
    ALTER TABLE mission_leads ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Ensure mission_leads RLS policy exists
DROP POLICY IF EXISTS "Users can manage leads for their own businesses" ON mission_leads;
CREATE POLICY "Users can manage leads for their own businesses"
  ON mission_leads
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- Ensure mission_leads trigger exists
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
-- Migration Complete
-- ═══════════════════════════════════════════════════════════════════════════
```

---

## SECTION 4: Verification Queries

Run these queries **after** the migration to confirm everything is in place:

```sql
-- Check: sales_agents table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'sales_agents'
) AS sales_agents_exists;

-- Check: mission_assignments table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'mission_assignments'
) AS mission_assignments_exists;

-- Check: ensure_default_agent function exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.routines
  WHERE routine_name = 'ensure_default_agent'
) AS ensure_default_agent_exists;

-- Check: sales_agents RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'sales_agents';

-- Check: mission_assignments RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'mission_assignments';

-- Check: Sales agent triggers exist
SELECT tgname, tgrelname
FROM pg_trigger
WHERE tgrelname IN ('sales_agents', 'mission_assignments')
ORDER BY tgrelname;

-- Check: All required indexes exist
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE tablename IN ('sales_agents', 'mission_assignments', 'mission_leads')
ORDER BY tablename, indexname;

-- Check: RLS policies active
SELECT policyname, tablename
FROM pg_policies
WHERE tablename IN ('sales_agents', 'mission_assignments', 'mission_leads')
ORDER BY tablename, policyname;

-- Test: Can create default agent (dry run)
-- SELECT * FROM ensure_default_agent('00000000-0000-0000-0000-000000000001'::uuid);
-- Note: Replace UUID with actual test business_id

-- Test: Maya agent was created
-- SELECT name, role, status, language FROM sales_agents WHERE name = 'Maya' LIMIT 1;
```

---

## SECTION 5: Deployment Checklist

- [ ] Backup current database
- [ ] Run master migration script in order (section 3)
- [ ] Run verification queries (section 4)
- [ ] Confirm all tables, indexes, triggers, functions exist
- [ ] Test `/api/zeya/sales-agents` endpoint (should seed Maya)
- [ ] Test `/api/zeya/mission-assignments` POST endpoint
- [ ] Test Mission Control in UI (assign brief to caller)
- [ ] Confirm RLS works (users see only own business data)
- [ ] Monitor for errors in logs post-deployment
