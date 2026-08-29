BEGIN;

-- P2.12C Formation Events Table
--
-- Authoritative semantic record of Formation lifecycle events.
-- Each event represents an explicit action or state transition with full attribution.
--
-- Initial support: owner_acknowledged_prepared_opening
-- Future: extended with other Formation lifecycle semantics
--
-- Immutability: once inserted, events are never modified (append-only audit trail)

CREATE TYPE public.formation_event_type AS ENUM (
  'owner_acknowledged_prepared_opening'
);

CREATE TABLE IF NOT EXISTS public.formation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session linkage
  formation_session_id UUID NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE CASCADE,

  -- Owner attribution (cached for efficiency, also in session)
  owner_id UUID NOT NULL,

  -- Event classification
  event_type public.formation_event_type NOT NULL,

  -- Event-specific details (optional, kept minimal)
  details JSONB,

  -- Immutable timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.now()
);

-- Semantic uniqueness: at most one acknowledgement event per session
-- Implemented as partial UNIQUE INDEX (standard PostgreSQL syntax)
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_events_one_acknowledgement_per_session
  ON public.formation_events (formation_session_id, event_type)
  WHERE event_type = 'owner_acknowledged_prepared_opening'::public.formation_event_type;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_formation_events_session_id
  ON public.formation_events(formation_session_id);

CREATE INDEX IF NOT EXISTS idx_formation_events_owner_id
  ON public.formation_events(owner_id);

CREATE INDEX IF NOT EXISTS idx_formation_events_event_type
  ON public.formation_events(event_type);

CREATE INDEX IF NOT EXISTS idx_formation_events_created_at
  ON public.formation_events(created_at DESC);

-- Row-level security: owners can only read their own Formation events
ALTER TABLE public.formation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY formation_events_owner_select ON public.formation_events
  FOR SELECT
  USING (owner_id = auth.uid());

REVOKE ALL ON TABLE public.formation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.formation_events TO authenticated;

-- Service role only for inserts (via authoritative RPC)
REVOKE ALL ON TABLE public.formation_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.formation_events TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
