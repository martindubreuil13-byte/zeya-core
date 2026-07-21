-- Normalized migration version: 20260613010000.
-- ═══════════════════════════════════════════════════════════════════════════
-- Dispatch Lifecycle and Event Tracking
-- Date: 2026-06-13
-- Purpose: Complete dispatch-to-outcome pipeline integration
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Table: dispatch_events
-- Immutable event log for dispatch lifecycle
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists dispatch_events (
  id uuid primary key default gen_random_uuid(),
  dispatch_id text not null references dispatches(dispatch_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Event classification
  event_type text not null check (
    event_type in (
      'created',
      'queued',
      'calling',
      'answered',
      'no_answer',
      'completed',
      'failed',
      'rescheduled'
    )
  ),

  -- Event context
  message text,
  metadata jsonb,

  -- Timestamps (immutable)
  created_at timestamptz not null default now()
);

create index if not exists idx_dispatch_events_dispatch_id on dispatch_events(dispatch_id);
create index if not exists idx_dispatch_events_user_id on dispatch_events(user_id);
create index if not exists idx_dispatch_events_type on dispatch_events(event_type);
create index if not exists idx_dispatch_events_created_at on dispatch_events(created_at desc);

alter table dispatch_events enable row level security;

create policy "Users can view own dispatch events" on dispatch_events
  for select using (auth.uid() = user_id);

create policy "Users can create own dispatch events" on dispatch_events
  for insert with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Extend dispatches table: Link to worker brief and call outcome
-- ──────────────────────────────────────────────────────────────────────────

alter table dispatches
add column if not exists worker_brief_id text references worker_briefs(id) on delete set null,
add column if not exists call_outcome_id uuid references call_outcomes(id) on delete set null;

create index if not exists idx_dispatches_worker_brief_id on dispatches(worker_brief_id);
create index if not exists idx_dispatches_call_outcome_id on dispatches(call_outcome_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Function: Create dispatch event and update dispatch status atomically
-- ──────────────────────────────────────────────────────────────────────────

create or replace function update_dispatch_with_event(
  p_dispatch_id text,
  p_new_status text,
  p_event_type text,
  p_user_id uuid,
  p_message text default null,
  p_metadata jsonb default null
)
returns table (
  dispatch_id text,
  status text,
  event_id uuid
) as $$
declare
  v_event_id uuid;
begin
  -- Update dispatch status
  update dispatches
  set status = p_new_status, updated_at = now()
  where dispatches.dispatch_id = p_dispatch_id;

  -- Create dispatch event
  insert into dispatch_events (dispatch_id, user_id, event_type, message, metadata)
  values (p_dispatch_id, p_user_id, p_event_type, p_message, p_metadata)
  returning id into v_event_id;

  -- Return results
  return query
  select dispatches.dispatch_id, dispatches.status, v_event_id
  from dispatches
  where dispatches.dispatch_id = p_dispatch_id;
end;
$$ language plpgsql;

-- ──────────────────────────────────────────────────────────────────────────
-- Function: Get dispatch with full context
-- ──────────────────────────────────────────────────────────────────────────

create or replace function get_dispatch_context(p_dispatch_id text)
returns table (
  dispatch_id text,
  status text,
  visitor_name text,
  phone_number text,
  business_offer text,
  target_buyer text,
  worker_brief_id text,
  call_outcome_id uuid,
  created_at timestamptz,
  updated_at timestamptz
) as $$
begin
  return query
  select
    d.dispatch_id,
    d.status,
    d.visitor_name,
    d.phone_number,
    d.business_offer,
    d.target_buyer,
    d.worker_brief_id,
    d.call_outcome_id,
    d.created_at,
    d.updated_at
  from dispatches d
  where d.dispatch_id = p_dispatch_id;
end;
$$ language plpgsql;
