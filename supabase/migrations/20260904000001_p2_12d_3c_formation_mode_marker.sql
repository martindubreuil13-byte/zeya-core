-- P2.12D.3C: Durable Formation Mode Marker
-- Disambiguates legacy vs snapshot-v6 Formations durably
-- Historical NULL values remain legacy
-- New Day-One v6 Formations set to 'immutable_snapshot_v6'

BEGIN;

-- Enum: formation prepared-context mode
CREATE TYPE formation_prepared_context_mode AS ENUM (
  'immutable_snapshot_v6'  -- New Day-One v6 Formation, snapshot REQUIRED
);

-- Add mode column to Formation sessions
ALTER TABLE public.representation_formation_sessions
ADD COLUMN prepared_context_mode public.formation_prepared_context_mode DEFAULT NULL;

-- Index for mode-based queries
CREATE INDEX idx_formation_sessions_prepared_context_mode
ON public.representation_formation_sessions(prepared_context_mode);

-- Constraint: immutable_snapshot_v6 Formations MUST have a snapshot
-- (will be validated at application level for now; could be strengthened with CHECK)

NOTIFY pgrst, 'reload schema';
COMMIT;
