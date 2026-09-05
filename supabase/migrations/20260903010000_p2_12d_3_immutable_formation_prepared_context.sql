-- P2.12D.3: Immutable Formation Prepared Context Snapshot
-- Binds Formation session to exact Preparation state at entry time
-- Never updates; protects conversational lineage consistency

BEGIN;

CREATE TABLE public.direct_hire_formation_prepared_context (
  formation_session_id uuid PRIMARY KEY,
  direct_hire_working_session_id uuid NOT NULL,
  business_representation_id uuid NOT NULL,
  preparation_brief_id uuid NOT NULL,
  hypothesis_snapshot_ids uuid[] NOT NULL,
  preparation_contract_version text NOT NULL,
  reasoning_contract_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_formation_session FOREIGN KEY (formation_session_id)
    REFERENCES public.representation_formation_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_working_session FOREIGN KEY (direct_hire_working_session_id)
    REFERENCES public.direct_hire_working_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_preparation_brief FOREIGN KEY (preparation_brief_id)
    REFERENCES public.direct_hire_first_working_session_briefs(id) ON DELETE RESTRICT,
  CONSTRAINT hypothesis_ids_nonempty CHECK (cardinality(hypothesis_snapshot_ids) > 0)
);

CREATE UNIQUE INDEX formation_prepared_context_formation_session
  ON public.direct_hire_formation_prepared_context(formation_session_id);

CREATE INDEX formation_prepared_context_working_session
  ON public.direct_hire_formation_prepared_context(direct_hire_working_session_id);

CREATE INDEX formation_prepared_context_business
  ON public.direct_hire_formation_prepared_context(business_representation_id);

-- RLS: Tenant isolation via business_representation_id
ALTER TABLE public.direct_hire_formation_prepared_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY formation_prepared_context_select_own
  ON public.direct_hire_formation_prepared_context FOR SELECT
  USING (
    business_representation_id IN (
      SELECT id FROM public.business_representations
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY formation_prepared_context_insert_service_only
  ON public.direct_hire_formation_prepared_context FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Prevent any updates or deletes (immutable snapshot)
CREATE POLICY formation_prepared_context_no_update
  ON public.direct_hire_formation_prepared_context FOR UPDATE
  USING (false);

CREATE POLICY formation_prepared_context_no_delete
  ON public.direct_hire_formation_prepared_context FOR DELETE
  USING (false);

-- RPC: Create immutable Formation prepared-context snapshot
CREATE FUNCTION public.zeya_create_formation_prepared_context_snapshot(
  p_formation_session_id uuid,
  p_working_session_id uuid,
  p_business_representation_id uuid,
  p_preparation_brief_id uuid,
  p_hypothesis_snapshot_ids uuid[],
  p_preparation_contract_version text,
  p_reasoning_contract_version text
) RETURNS TABLE (
  context_id uuid,
  formation_session_id uuid,
  brief_id uuid,
  hypothesis_count int,
  created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_context_id uuid;
BEGIN
  -- Verify Formation exists
  IF NOT EXISTS (
    SELECT 1 FROM public.representation_formation_sessions fs
    WHERE fs.id = p_formation_session_id
      AND fs.business_representation_id = p_business_representation_id
  ) THEN
    RAISE EXCEPTION 'formation_session_not_found';
  END IF;

  -- Verify working session belongs to same business
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_hire_working_sessions ws
    JOIN public.direct_hire_onboarding_sessions os
      ON ws.direct_hire_onboarding_session_id = os.id
    WHERE ws.id = p_working_session_id
      AND os.business_representation_id = p_business_representation_id
  ) THEN
    RAISE EXCEPTION 'working_session_not_found';
  END IF;

  -- Verify brief belongs to working session
  IF NOT EXISTS (
    SELECT 1 FROM public.direct_hire_first_working_session_briefs b
    WHERE b.id = p_preparation_brief_id
      AND b.direct_hire_working_session_id = p_working_session_id
      AND b.preparation_contract_version = p_preparation_contract_version
  ) THEN
    RAISE EXCEPTION 'brief_not_found';
  END IF;

  -- Verify hypotheses belong to this business/onboarding
  IF NOT EXISTS (
    SELECT 1 FROM public.hypotheses h
    JOIN public.direct_hire_onboarding_sessions os
      ON h.direct_hire_onboarding_session_id = os.id
    WHERE os.business_representation_id = p_business_representation_id
      AND h.id = ANY(p_hypothesis_snapshot_ids)
    GROUP BY os.id
    HAVING count(DISTINCT h.id) = cardinality(p_hypothesis_snapshot_ids)
  ) THEN
    RAISE EXCEPTION 'hypotheses_not_found';
  END IF;

  -- Create atomically. A concurrent winner is normalized to already_bound so
  -- the application can load and reconcile the complete immutable identity.
  INSERT INTO public.direct_hire_formation_prepared_context AS inserted_context (
    formation_session_id,
    direct_hire_working_session_id,
    business_representation_id,
    preparation_brief_id,
    hypothesis_snapshot_ids,
    preparation_contract_version,
    reasoning_contract_version
  ) VALUES (
    p_formation_session_id,
    p_working_session_id,
    p_business_representation_id,
    p_preparation_brief_id,
    p_hypothesis_snapshot_ids,
    p_preparation_contract_version,
    p_reasoning_contract_version
  ) ON CONFLICT ON CONSTRAINT direct_hire_formation_prepared_context_pkey DO NOTHING
  RETURNING inserted_context.formation_session_id INTO v_context_id;

  IF v_context_id IS NULL THEN
    RAISE EXCEPTION 'formation_prepared_context_already_bound';
  END IF;

  RETURN QUERY SELECT
    v_context_id,
    p_formation_session_id,
    p_preparation_brief_id,
    cardinality(p_hypothesis_snapshot_ids)::int,
    now();
END; $$;

REVOKE ALL ON FUNCTION public.zeya_create_formation_prepared_context_snapshot(
  uuid, uuid, uuid, uuid, uuid[], text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_create_formation_prepared_context_snapshot(
  uuid, uuid, uuid, uuid, uuid[], text, text
) TO service_role;

-- RPC: Load immutable Formation prepared-context
CREATE FUNCTION public.zeya_load_formation_prepared_context(
  p_formation_session_id uuid
) RETURNS TABLE (
  formation_session_id uuid,
  preparation_brief_id uuid,
  hypothesis_snapshot_ids uuid[],
  preparation_contract_version text,
  reasoning_contract_version text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY
  SELECT
    fpc.formation_session_id,
    fpc.preparation_brief_id,
    fpc.hypothesis_snapshot_ids,
    fpc.preparation_contract_version,
    fpc.reasoning_contract_version
  FROM public.direct_hire_formation_prepared_context fpc
  WHERE fpc.formation_session_id = p_formation_session_id;
END; $$;

REVOKE ALL ON FUNCTION public.zeya_load_formation_prepared_context(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_load_formation_prepared_context(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
