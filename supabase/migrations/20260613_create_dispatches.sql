-- Dispatch table for outbound execution tracking
-- Production-ready storage for dispatch records

create table if not exists dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_id text not null unique,
  user_id uuid references auth.users(id) on delete cascade,

  -- Visitor information
  visitor_name text not null,
  phone_number text not null,

  -- Business context
  business_offer text not null,
  target_buyer text not null,

  -- Agent brief (JSON)
  agent_brief jsonb not null,

  -- Execution status
  status text not null default 'draft' check (
    status in ('draft', 'queued', 'calling', 'answered', 'no_answer', 'completed', 'failed')
  ),

  -- Execution tracking
  execution_attempts int default 0,
  last_attempt_at timestamptz,
  last_error text,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Metadata
  source text default 'experience_conversation',
  metadata jsonb
);

-- Indexes for performance
create index if not exists idx_dispatches_status on dispatches(status);
create index if not exists idx_dispatches_user_id on dispatches(user_id);
create index if not exists idx_dispatches_dispatch_id on dispatches(dispatch_id);
create index if not exists idx_dispatches_created_at on dispatches(created_at desc);
create index if not exists idx_dispatches_phone_number on dispatches(phone_number);

-- Enable RLS
alter table dispatches enable row level security;

-- RLS policy: users can only see their own dispatches
create policy "Users can view own dispatches" on dispatches
  for select using (auth.uid() = user_id);

create policy "Users can insert own dispatches" on dispatches
  for insert with check (auth.uid() = user_id);

create policy "Users can update own dispatches" on dispatches
  for update using (auth.uid() = user_id);
