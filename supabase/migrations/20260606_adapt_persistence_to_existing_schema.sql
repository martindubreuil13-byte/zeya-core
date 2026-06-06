-- Phase 12B Persistence Adaptation Migration
-- Adapts Phase 12A repositories to existing production schema
-- Date: 2026-06-06
--
-- Purpose: Add ONLY missing columns needed for Phase 12B repositories
-- Does NOT create duplicate tables
-- Does NOT modify existing columns
--
-- Changes:
-- 1. Add updated_at to call_outcomes (required for upsert operations)
-- 2. Add updated_at to memory_events (required for upsert operations)
-- 3. Add indexes for performance

-- ============================================================================
-- Table: call_outcomes
-- Add updated_at column for tracking last modification
-- ============================================================================
ALTER TABLE call_outcomes
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Index for efficient queries on updated_at
CREATE INDEX IF NOT EXISTS idx_call_outcomes_updated_at
ON call_outcomes(updated_at DESC);

-- ============================================================================
-- Table: memory_events
-- Add updated_at column for tracking last modification
-- ============================================================================
ALTER TABLE memory_events
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Index for efficient queries on updated_at
CREATE INDEX IF NOT EXISTS idx_memory_events_updated_at
ON memory_events(updated_at DESC);
