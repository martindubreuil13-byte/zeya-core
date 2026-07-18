-- Additive correction: advance canonical Element pointers in the atomic Version transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_create_canonical_version_atomic(
  p_business_representation_id UUID,
  p_business_id UUID,
  p_source_proposal_id UUID,
  p_element_values JSONB,
  p_overall_confidence_score SMALLINT,
  p_actor_user_id UUID,
  p_rollback_of_version_id UUID DEFAULT NULL
)
RETURNS TABLE(version_id UUID, version_number BIGINT, created_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rep public.business_representations%ROWTYPE;
  v_next_version_number BIGINT;
  v_new_version_id UUID;
  v_new_version_created_at TIMESTAMP WITH TIME ZONE;
  v_source_approval_id UUID;
  v_affected_rows INTEGER;
  v_expected_element_rows INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized';
  END IF;

  SELECT * INTO v_rep
  FROM public.business_representations
  WHERE id = p_business_representation_id AND business_id = p_business_id
  FOR UPDATE;
  IF v_rep.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='representation not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.representation_proposals AS proposal
    WHERE proposal.id = p_source_proposal_id
      AND proposal.business_representation_id = p_business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid source proposal';
  END IF;

  IF p_rollback_of_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.representation_versions AS rollback_target
    WHERE rollback_target.id = p_rollback_of_version_id
      AND rollback_target.business_representation_id = p_business_representation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid rollback target';
  END IF;

  SELECT approval.id INTO v_source_approval_id
  FROM public.approval_decisions AS approval
  WHERE approval.representation_proposal_id = p_source_proposal_id
    AND approval.decision = 'approved';

  SELECT COALESCE(MAX(version_row.version_number), 0) + 1
  INTO v_next_version_number
  FROM public.representation_versions AS version_row
  WHERE version_row.business_representation_id = p_business_representation_id;

  INSERT INTO public.representation_versions AS inserted_version (
    business_representation_id, previous_version_id, source_proposal_id,
    source_approval_id, element_values, version_number,
    overall_confidence_score, created_by_actor
  ) VALUES (
    p_business_representation_id, v_rep.current_version_id, p_source_proposal_id,
    v_source_approval_id, p_element_values, v_next_version_number,
    p_overall_confidence_score, p_actor_user_id
  )
  RETURNING inserted_version.id, inserted_version.created_at
  INTO v_new_version_id, v_new_version_created_at;

  UPDATE public.business_representations
  SET current_version_id = v_new_version_id, updated_at = pg_catalog.now()
  WHERE id = p_business_representation_id AND business_id = p_business_id;
  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
  IF v_affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='pointer update failed: unexpected row count';
  END IF;

  SELECT count(*)::integer INTO v_expected_element_rows
  FROM public.representation_elements AS element_row
  WHERE element_row.business_representation_id = p_business_representation_id
    AND p_element_values ? element_row.element_key;

  UPDATE public.representation_elements AS element_row
  SET current_value_version_id = v_new_version_id,
      updated_at = pg_catalog.now()
  WHERE element_row.business_representation_id = p_business_representation_id
    AND p_element_values ? element_row.element_key;
  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
  IF v_affected_rows <> v_expected_element_rows THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='element pointer update failed: unexpected row count';
  END IF;

  INSERT INTO public.audit_events (
    business_representation_id, event_type, version_id, actor_user_id, details
  ) VALUES (
    p_business_representation_id,
    CASE WHEN p_rollback_of_version_id IS NULL THEN 'version_created' ELSE 'version_rolled_back' END,
    v_new_version_id,
    p_actor_user_id,
    pg_catalog.jsonb_build_object(
      'version_number', v_next_version_number,
      'source_proposal_id', p_source_proposal_id,
      'confidence_score', p_overall_confidence_score,
      'rollback_of_version_id', p_rollback_of_version_id
    )
  );

  RETURN QUERY SELECT v_new_version_id, v_next_version_number, v_new_version_created_at;
END;
$$;

ALTER FUNCTION public.zeya_create_canonical_version_atomic(UUID,UUID,UUID,JSONB,SMALLINT,UUID,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_create_canonical_version_atomic(UUID,UUID,UUID,JSONB,SMALLINT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_create_canonical_version_atomic(UUID,UUID,UUID,JSONB,SMALLINT,UUID,UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
