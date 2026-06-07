-- ═══════════════════════════════════════════════════════════════════════════
-- Add Traceability Fields for Call Reconstruction
-- Date: 2026-06-07
-- Purpose: Store conversation-level context needed to reconstruct calls
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Table: call_outcomes
-- Add fields to reconstruct WorkerBrief context after call
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE call_outcomes
ADD COLUMN IF NOT EXISTS conversation_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS mission_id TEXT,
ADD COLUMN IF NOT EXISTS business_id UUID,
ADD COLUMN IF NOT EXISTS target_name TEXT,
ADD COLUMN IF NOT EXISTS target_phone TEXT;

-- Create indexes for traceability queries
CREATE INDEX IF NOT EXISTS idx_call_outcomes_conversation_id
ON call_outcomes(conversation_id);

CREATE INDEX IF NOT EXISTS idx_call_outcomes_mission_id
ON call_outcomes(mission_id);

CREATE INDEX IF NOT EXISTS idx_call_outcomes_business_id
ON call_outcomes(business_id);

-- Add foreign key constraint for business_id if businesses table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'businesses') THEN
    ALTER TABLE call_outcomes
    ADD CONSTRAINT fk_call_outcomes_business_id
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- Table: memory_events
-- Add fields to link memory events back to specific briefs and calls
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE memory_events
ADD COLUMN IF NOT EXISTS worker_brief_id TEXT,
ADD COLUMN IF NOT EXISTS conversation_id TEXT,
ADD COLUMN IF NOT EXISTS outcome_id TEXT;

-- Create indexes for memory event traceability
CREATE INDEX IF NOT EXISTS idx_memory_events_worker_brief_id
ON memory_events(worker_brief_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_conversation_id
ON memory_events(conversation_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_outcome_id
ON memory_events(outcome_id);

-- Create composite index for business + brief queries
CREATE INDEX IF NOT EXISTS idx_memory_events_business_brief
ON memory_events(business_id, worker_brief_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Bridging Queries After Migration
-- These enable full call reconstruction
-- ──────────────────────────────────────────────────────────────────────────

-- Query: Given a worker_brief_id, get all related calls
-- SELECT co.* FROM call_outcomes co
--   WHERE co.worker_brief_id = 'brief_xxx'
--   JOIN worker_briefs wb ON co.worker_brief_id = wb.id
--   ORDER BY co.created_at DESC;

-- Query: Given a conversation_id, reconstruct the full context
-- SELECT
--   wb.* as brief,
--   co.* as outcome,
--   me.* as memory_event
-- FROM call_outcomes co
--   LEFT JOIN worker_briefs wb ON co.worker_brief_id = wb.id
--   LEFT JOIN memory_events me ON me.conversation_id = co.conversation_id
-- WHERE co.conversation_id = 'conv_xyz';

-- Query: Get all calls for a business with their briefs
-- SELECT
--   wb.id as brief_id,
--   wb.objective,
--   co.outcome_type,
--   co.call_duration_seconds,
--   co.created_at
-- FROM worker_briefs wb
--   LEFT JOIN call_outcomes co ON wb.id = co.worker_brief_id
-- WHERE wb.business_id = 'business_uuid'
-- ORDER BY co.created_at DESC;
