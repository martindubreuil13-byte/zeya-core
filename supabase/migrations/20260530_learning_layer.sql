-- Zeya Learning Layer v1
-- Stores post-assignment call feedback and derived mission learnings.

CREATE TABLE IF NOT EXISTS call_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES mission_assignments(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES mission_leads(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('answered', 'voicemail', 'no_answer', 'wrong_number', 'not_interested', 'follow_up', 'qualified', 'closed')
  ),
  interest_level TEXT CHECK (interest_level IN ('low', 'medium', 'high', 'unknown')),
  objection TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT false,
  follow_up_date TIMESTAMP WITH TIME ZONE,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_results_business_id ON call_results(business_id);
CREATE INDEX IF NOT EXISTS idx_call_results_assignment_id ON call_results(assignment_id);
CREATE INDEX IF NOT EXISTS idx_call_results_lead_id ON call_results(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_results_created_at ON call_results(created_at DESC);

ALTER TABLE call_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_see_own_business_call_results" ON call_results;
CREATE POLICY "users_can_see_own_business_call_results"
  ON call_results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_call_results" ON call_results;
CREATE POLICY "users_can_insert_own_business_call_results"
  ON call_results FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mission_key TEXT,
  learning_type TEXT NOT NULL CHECK (
    learning_type IN ('objection_pattern', 'message_resonance', 'follow_up_pattern', 'outcome_pattern')
  ),
  title TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC(4, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_count INT NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_events_business_id ON learning_events(business_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_mission_key ON learning_events(business_id, mission_key);
CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(learning_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_created_at ON learning_events(created_at DESC);

ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_see_own_business_learning_events" ON learning_events;
CREATE POLICY "users_can_see_own_business_learning_events"
  ON learning_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_business_learning_events" ON learning_events;
CREATE POLICY "users_can_insert_own_business_learning_events"
  ON learning_events FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses
    WHERE id = business_id AND user_id = auth.uid()
  ));
