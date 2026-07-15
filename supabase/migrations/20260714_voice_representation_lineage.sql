BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_id_user_idx
  ON public.businesses(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS business_representations_id_business_idx
  ON public.business_representations(id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS representation_versions_id_representation_idx
  ON public.representation_versions(id, business_representation_id);

CREATE TABLE IF NOT EXISTS public.voice_representation_lineage (
  voice_context_id UUID PRIMARY KEY,
  worker_brief_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  conversation_id TEXT UNIQUE,
  provider_call_id TEXT,
  tenant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_representation_id UUID NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  canonical_version_id UUID NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  context_generated_at TIMESTAMPTZ NOT NULL,
  authorized_element_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  provisional_mode BOOLEAN NOT NULL DEFAULT FALSE,
  agent_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  context_schema_version TEXT NOT NULL,
  prompt_assembly_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_lineage_business_tenant_fk
    FOREIGN KEY (business_id, tenant_user_id)
    REFERENCES public.businesses(id, user_id),
  CONSTRAINT voice_lineage_business_representation_fk
    FOREIGN KEY (business_representation_id, business_id)
    REFERENCES public.business_representations(id, business_id),
  CONSTRAINT voice_lineage_version_representation_fk
    FOREIGN KEY (canonical_version_id, business_representation_id)
    REFERENCES public.representation_versions(id, business_representation_id)
);

CREATE INDEX IF NOT EXISTS voice_lineage_business_idx ON public.voice_representation_lineage(business_id);
CREATE INDEX IF NOT EXISTS voice_lineage_tenant_idx ON public.voice_representation_lineage(tenant_user_id);
CREATE INDEX IF NOT EXISTS voice_lineage_representation_idx ON public.voice_representation_lineage(business_representation_id);
CREATE INDEX IF NOT EXISTS voice_lineage_conversation_idx ON public.voice_representation_lineage(conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS voice_lineage_provider_call_idx
  ON public.voice_representation_lineage(provider_call_id)
  WHERE provider_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS voice_lineage_version_idx ON public.voice_representation_lineage(canonical_version_id);

ALTER TABLE public.voice_representation_lineage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_view_own_voice_lineage" ON public.voice_representation_lineage;
CREATE POLICY "users_can_view_own_voice_lineage"
  ON public.voice_representation_lineage FOR SELECT
  USING (auth.uid() = tenant_user_id AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = voice_representation_lineage.business_id
      AND b.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "users_can_insert_own_voice_lineage" ON public.voice_representation_lineage;
DROP POLICY IF EXISTS "users_can_update_own_voice_lineage" ON public.voice_representation_lineage;
DROP POLICY IF EXISTS "users_can_delete_own_voice_lineage" ON public.voice_representation_lineage;

REVOKE ALL ON public.voice_representation_lineage
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.voice_representation_lineage
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.zeya_enforce_voice_lineage_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.voice_context_id IS DISTINCT FROM OLD.voice_context_id
     OR NEW.worker_brief_id IS DISTINCT FROM OLD.worker_brief_id
     OR NEW.mission_id IS DISTINCT FROM OLD.mission_id
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.business_representation_id IS DISTINCT FROM OLD.business_representation_id
     OR NEW.canonical_version_id IS DISTINCT FROM OLD.canonical_version_id
     OR NEW.context_generated_at IS DISTINCT FROM OLD.context_generated_at
     OR NEW.authorized_element_keys IS DISTINCT FROM OLD.authorized_element_keys
     OR NEW.provisional_mode IS DISTINCT FROM OLD.provisional_mode
     OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.agent_type IS DISTINCT FROM OLD.agent_type
     OR NEW.agent_role IS DISTINCT FROM OLD.agent_role
     OR NEW.context_schema_version IS DISTINCT FROM OLD.context_schema_version
     OR NEW.prompt_assembly_version IS DISTINCT FROM OLD.prompt_assembly_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'voice lineage provenance is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zeya_voice_lineage_immutability ON public.voice_representation_lineage;
CREATE TRIGGER zeya_voice_lineage_immutability
  BEFORE UPDATE ON public.voice_representation_lineage
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_enforce_voice_lineage_immutability();

CREATE OR REPLACE FUNCTION public.zeya_create_voice_representation_lineage(
  p_voice_context_id UUID,
  p_worker_brief_id TEXT,
  p_mission_id TEXT,
  p_conversation_id TEXT,
  p_tenant_user_id UUID,
  p_business_id UUID,
  p_business_representation_id UUID,
  p_canonical_version_id UUID,
  p_context_generated_at TIMESTAMPTZ,
  p_authorized_element_keys TEXT[],
  p_provisional_mode BOOLEAN,
  p_agent_id TEXT,
  p_agent_type TEXT,
  p_agent_role TEXT,
  p_context_schema_version TEXT,
  p_prompt_assembly_version TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lineage write not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses b
    JOIN public.business_representations br
      ON br.business_id = b.id AND br.user_id = b.user_id
    JOIN public.representation_versions rv
      ON rv.business_representation_id = br.id
    WHERE b.id = p_business_id
      AND b.user_id = p_tenant_user_id
      AND br.id = p_business_representation_id
      AND rv.id = p_canonical_version_id
      AND br.current_version_id = rv.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'voice lineage context not found';
  END IF;

  INSERT INTO public.voice_representation_lineage (
    voice_context_id, worker_brief_id, mission_id, conversation_id,
    tenant_user_id, business_id, business_representation_id,
    canonical_version_id, context_generated_at, authorized_element_keys,
    provisional_mode, agent_id, agent_type, agent_role,
    context_schema_version, prompt_assembly_version
  ) VALUES (
    p_voice_context_id, p_worker_brief_id, p_mission_id, p_conversation_id,
    p_tenant_user_id, p_business_id, p_business_representation_id,
    p_canonical_version_id, p_context_generated_at, p_authorized_element_keys,
    p_provisional_mode, p_agent_id, p_agent_type, p_agent_role,
    p_context_schema_version, p_prompt_assembly_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_attach_voice_provider_ids(
  p_voice_context_id UUID,
  p_conversation_id TEXT,
  p_provider_call_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lineage public.voice_representation_lineage%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lineage attachment not authorized';
  END IF;
  IF p_provider_call_id IS NULL OR btrim(p_provider_call_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'provider call identifier is required';
  END IF;

  SELECT * INTO v_lineage
  FROM public.voice_representation_lineage
  WHERE voice_context_id = p_voice_context_id
  FOR UPDATE;

  IF v_lineage.voice_context_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'voice lineage not found';
  END IF;
  IF v_lineage.provider_call_id IS NOT NULL
     AND v_lineage.provider_call_id <> p_provider_call_id THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'provider identifiers already attached';
  END IF;
  IF v_lineage.conversation_id IS NOT NULL
     AND v_lineage.conversation_id NOT LIKE 'voice_%'
     AND v_lineage.conversation_id NOT LIKE 'dispatch_%'
     AND v_lineage.conversation_id <> p_conversation_id THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'conversation identifier already attached';
  END IF;

  IF v_lineage.provider_call_id = p_provider_call_id
     AND (p_conversation_id IS NULL OR v_lineage.conversation_id = p_conversation_id) THEN
    RETURN;
  END IF;

  UPDATE public.voice_representation_lineage
  SET conversation_id = COALESCE(p_conversation_id, conversation_id),
      provider_call_id = COALESCE(p_provider_call_id, provider_call_id),
      updated_at = now()
  WHERE voice_context_id = p_voice_context_id;
END;
$$;

REVOKE ALL ON FUNCTION public.zeya_create_voice_representation_lineage(UUID,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_create_voice_representation_lineage(UUID,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,TIMESTAMPTZ,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.zeya_attach_voice_provider_ids(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_attach_voice_provider_ids(UUID,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.zeya_enforce_voice_lineage_immutability() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
