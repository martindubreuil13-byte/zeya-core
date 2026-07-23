BEGIN;

-- Repository-owned baseline required by every later migration. Earlier
-- environments inherited these tables from manual setup, which made a clean
-- Preview branch impossible to initialize from migration history alone.
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text,
  industry text,
  business_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  memory_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id)
);

CREATE INDEX businesses_user_id_idx ON public.businesses(user_id);
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY businesses_owner_select ON public.businesses FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY businesses_owner_insert ON public.businesses FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
CREATE POLICY businesses_owner_update ON public.businesses FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY businesses_owner_delete ON public.businesses FOR DELETE TO authenticated USING (user_id=auth.uid());

CREATE TABLE public.call_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_brief_id text,
  outcome_type text NOT NULL,
  summary text,
  next_action text,
  call_duration_seconds integer,
  transcript jsonb,
  raw_provider_payload jsonb,
  sentiment text,
  objections text,
  key_insights text,
  follow_up_required boolean NOT NULL DEFAULT false,
  follow_up_date timestamptz,
  meeting_booked boolean NOT NULL DEFAULT false,
  meeting_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  content text NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'system',
  importance text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_events_business_id_idx ON public.memory_events(business_id);
ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_events_owner_select ON public.memory_events FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=business_id AND b.user_id=auth.uid()));
CREATE POLICY memory_events_owner_insert ON public.memory_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=business_id AND b.user_id=auth.uid()));

GRANT SELECT,INSERT,UPDATE,DELETE ON public.businesses TO authenticated;
GRANT SELECT,INSERT ON public.memory_events TO authenticated;
GRANT ALL ON public.businesses,public.call_outcomes,public.memory_events TO service_role;

COMMIT;
