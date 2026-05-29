-- Mission Leads table
-- Stores prospect/lead records attached to a business and optionally a named mission.
-- mission_key is the mission name string from current_mission_detail.name — no missions table yet.

CREATE TABLE IF NOT EXISTS mission_leads (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mission_key    text          NULL,       -- matches current_mission_detail.name
  company_name   text          NULL,
  contact_name   text          NULL,
  phone          text          NULL,
  email          text          NULL,
  website        text          NULL,
  industry       text          NULL,
  city           text          NULL,
  country        text          NULL,
  source         text          NULL,       -- "paste" | "csv" | "manual"
  notes          text          NULL,
  fit_status     text          NOT NULL DEFAULT 'unreviewed'
                               CHECK (fit_status IN ('likely_match','possible_match','weak_match','unreviewed')),
  status         text          NOT NULL DEFAULT 'new'
                               CHECK (status IN ('new','selected','rejected','called','follow_up','closed')),
  raw_payload    jsonb         NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

-- Index for the most common query pattern
CREATE INDEX IF NOT EXISTS mission_leads_business_id_idx  ON mission_leads (business_id);
CREATE INDEX IF NOT EXISTS mission_leads_mission_key_idx  ON mission_leads (business_id, mission_key);
CREATE INDEX IF NOT EXISTS mission_leads_fit_status_idx   ON mission_leads (business_id, fit_status);

-- RLS
ALTER TABLE mission_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage leads for their own businesses"
  ON mission_leads
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE user_id = auth.uid()
    )
  );

-- Auto-update updated_at
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
