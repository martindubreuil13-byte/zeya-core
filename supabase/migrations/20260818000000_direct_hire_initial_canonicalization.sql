BEGIN;

ALTER TABLE public.approval_decisions
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS source_state_fingerprint text,
  ADD COLUMN IF NOT EXISTS canonicalization_intent text,
  ADD COLUMN IF NOT EXISTS resulting_version_id uuid REFERENCES public.representation_versions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS approval_decisions_owner_operation_unique
  ON public.approval_decisions(approver_user_id,operation_id) WHERE operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.zeya_decide_direct_hire_initial_canonicalization(
  p_owner_id uuid, p_formation_session_id uuid, p_proposal_id uuid,
  p_operation_id uuid, p_decision text
)
RETURNS TABLE(approved boolean, replayed boolean, approval_id uuid, version_id uuid,
  version_number bigint, proposal_status public.proposal_status, representation jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_proposal public.representation_proposals%ROWTYPE;
  v_rep public.business_representations%ROWTYPE;
  v_formation public.representation_formation_sessions%ROWTYPE;
  v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE;
  v_run public.direct_hire_formation_conversation_runs%ROWTYPE;
  v_approval public.approval_decisions%ROWTYPE;
  v_version public.representation_versions%ROWTYPE;
  v_values jsonb; v_fingerprint text; v_decision public.approval_decision_type;
  v_proposed_element_count bigint; v_accepted_element_count bigint;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL OR p_decision NOT IN ('approve','reject','correct') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid owner decision';
  END IF;

  SELECT * INTO v_proposal FROM public.representation_proposals WHERE id=p_proposal_id FOR UPDATE;
  SELECT * INTO v_rep FROM public.business_representations
    WHERE id=v_proposal.business_representation_id AND user_id=p_owner_id FOR UPDATE;
  SELECT * INTO v_formation FROM public.representation_formation_sessions
    WHERE id=p_formation_session_id AND id=v_proposal.formation_session_id AND owner_id=p_owner_id
      AND business_representation_id=v_rep.id FOR UPDATE;
  IF v_proposal.id IS NULL OR v_rep.id IS NULL OR v_formation.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='proposal not found';
  END IF;

  SELECT * INTO v_approval FROM public.approval_decisions WHERE approver_user_id=p_owner_id AND operation_id=p_operation_id;
  IF v_approval.id IS NOT NULL THEN
    IF v_approval.representation_proposal_id<>p_proposal_id OR
       v_approval.decision<>(CASE p_decision WHEN 'approve' THEN 'approved'::public.approval_decision_type WHEN 'reject' THEN 'rejected'::public.approval_decision_type ELSE 'deferred'::public.approval_decision_type END) OR
       v_approval.source_state_fingerprint IS DISTINCT FROM v_proposal.source_state_fingerprint OR
       v_approval.canonicalization_intent IS DISTINCT FROM 'initial_canonicalization'
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='decision operation conflicts'; END IF;
    IF v_approval.resulting_version_id IS NOT NULL THEN
      SELECT * INTO v_version FROM public.representation_versions
      WHERE id=v_approval.resulting_version_id AND source_proposal_id=p_proposal_id AND source_approval_id=v_approval.id;
    END IF;
    IF p_decision='approve' AND (v_version.id IS NULL OR v_rep.current_version_id IS DISTINCT FROM v_version.id OR v_proposal.status<>'approved')
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='approved decision lineage is incomplete'; END IF;
    IF p_decision<>'approve' AND (v_approval.resulting_version_id IS NOT NULL OR v_proposal.status<>'rejected'
      OR EXISTS(SELECT 1 FROM public.representation_versions x WHERE x.source_proposal_id=p_proposal_id))
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='non-approval decision lineage is incomplete'; END IF;
    RETURN QUERY SELECT p_decision='approve',true,v_approval.id,v_version.id,v_version.version_number,v_proposal.status,coalesce(v_version.element_values,'{}'::jsonb); RETURN;
  END IF;

  -- Proposal identity is also replay-safe when a client lost its original operation id.
  SELECT * INTO v_approval FROM public.approval_decisions WHERE representation_proposal_id=p_proposal_id;
  IF v_approval.id IS NOT NULL THEN
    IF p_decision<>'approve' OR v_approval.decision<>'approved' OR
       v_approval.source_state_fingerprint IS DISTINCT FROM v_proposal.source_state_fingerprint OR
       v_approval.canonicalization_intent IS DISTINCT FROM 'initial_canonicalization'
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='proposal already has a conflicting decision'; END IF;
    SELECT * INTO v_version FROM public.representation_versions
      WHERE id=v_approval.resulting_version_id AND source_proposal_id=p_proposal_id AND source_approval_id=v_approval.id;
    IF v_version.id IS NULL OR v_rep.current_version_id IS DISTINCT FROM v_version.id OR v_proposal.status<>'approved'
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='approved decision lineage is incomplete'; END IF;
    RETURN QUERY SELECT true,true,v_approval.id,v_version.id,v_version.version_number,v_proposal.status,v_version.element_values; RETURN;
  END IF;

  IF v_proposal.status<>'pending_approval' OR v_proposal.proposal_contract_version<>'direct-hire-formation-proposal-v2'
    OR v_proposal.canonicalization_intent<>'initial_canonicalization' OR v_proposal.base_representation_version_id IS NOT NULL
    OR v_proposal.source_formation_outcome_package_id IS NULL OR v_rep.current_version_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.representation_versions x WHERE x.business_representation_id=v_rep.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='proposal is not eligible for initial canonicalization'; END IF;

  SELECT * INTO v_outcome FROM public.direct_hire_formation_outcome_packages
    WHERE id=v_proposal.source_formation_outcome_package_id AND formation_session_id=v_formation.id AND owner_id=p_owner_id;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs
    WHERE id=v_outcome.conversation_run_id AND formation_session_id=v_formation.id AND owner_id=p_owner_id AND status='completed';
  IF v_outcome.id IS NULL OR v_run.id IS NULL OR v_run.completion_readiness_result->>'ready'<>'true'
    OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='Formation outcome is stale or not ready'; END IF;

  v_fingerprint:=encode(extensions.digest(convert_to(v_outcome.outcome_fingerprint||'|none|direct-hire-formation-proposal-v2|'||(v_proposal.proposed_changes->'elementUpdates')::text,'UTF8'),'sha256'),'hex');
  IF v_proposal.source_state_fingerprint IS DISTINCT FROM v_fingerprint
    OR v_proposal.proposed_changes#>>'{_metadata,sourceFingerprint}' IS DISTINCT FROM v_fingerprint
    OR EXISTS(SELECT 1 FROM public.representation_proposals newer WHERE newer.business_representation_id=v_rep.id
      AND newer.canonicalization_intent='initial_canonicalization' AND newer.status='pending_approval'
      AND (newer.created_at>v_proposal.created_at OR (newer.created_at=v_proposal.created_at AND newer.id>v_proposal.id)))
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='proposal is stale or superseded'; END IF;

  SELECT coalesce(jsonb_object_agg(entry.key,jsonb_build_object('value',entry.value->>'after') ORDER BY entry.key),'{}'::jsonb)
  INTO v_values FROM jsonb_each(coalesce(v_proposal.proposed_changes->'elementUpdates','{}'::jsonb)) entry
  WHERE entry.key IN ('whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription')
    AND jsonb_typeof(entry.value->'after')='string' AND btrim(entry.value->>'after')<>'';
  SELECT count(*) INTO v_proposed_element_count
  FROM jsonb_each(coalesce(v_proposal.proposed_changes->'elementUpdates','{}'::jsonb));
  SELECT count(*) INTO v_accepted_element_count FROM jsonb_each(v_values);
  IF v_accepted_element_count=0 OR v_accepted_element_count<>v_proposed_element_count
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='proposal contains no valid descriptive element updates'; END IF;

  v_decision:=CASE p_decision WHEN 'approve' THEN 'approved'::public.approval_decision_type WHEN 'reject' THEN 'rejected'::public.approval_decision_type ELSE 'deferred'::public.approval_decision_type END;
  INSERT INTO public.approval_decisions(business_representation_id,representation_proposal_id,decision,approver_user_id,approver_actor,approval_reason,operation_id,source_state_fingerprint,canonicalization_intent)
  VALUES(v_rep.id,v_proposal.id,v_decision,p_owner_id,'owner',CASE p_decision WHEN 'correct' THEN 'correction_requested' ELSE NULL END,p_operation_id,v_fingerprint,'initial_canonicalization') RETURNING * INTO v_approval;

  IF p_decision<>'approve' THEN
    UPDATE public.representation_proposals SET status='rejected',status_updated_at=pg_catalog.now() WHERE id=v_proposal.id AND status='pending_approval';
    INSERT INTO public.audit_events(business_representation_id,event_type,proposal_id,approval_id,actor_user_id,details)
    VALUES(v_rep.id,'proposal_rejected',v_proposal.id,v_approval.id,p_owner_id,jsonb_build_object('owner_action',p_decision,'canonicalization_intent','initial_canonicalization'));
    RETURN QUERY SELECT false,false,v_approval.id,NULL::uuid,NULL::bigint,'rejected'::public.proposal_status,'{}'::jsonb; RETURN;
  END IF;

  INSERT INTO public.representation_versions(business_representation_id,previous_version_id,source_proposal_id,source_approval_id,element_values,version_number,overall_confidence_score,created_by_actor)
  VALUES(v_rep.id,NULL,v_proposal.id,v_approval.id,v_values,1,75,p_owner_id::text) RETURNING * INTO v_version;
  UPDATE public.business_representations SET current_version_id=v_version.id,updated_at=pg_catalog.now()
    WHERE id=v_rep.id AND current_version_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='canonical pointer changed concurrently'; END IF;
  UPDATE public.approval_decisions SET resulting_version_id=v_version.id WHERE id=v_approval.id;
  UPDATE public.representation_proposals SET status='approved',status_updated_at=pg_catalog.now() WHERE id=v_proposal.id AND status='pending_approval';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='proposal changed concurrently'; END IF;
  INSERT INTO public.audit_events(business_representation_id,event_type,proposal_id,approval_id,version_id,actor_user_id,details)
  VALUES(v_rep.id,'proposal_approved',v_proposal.id,v_approval.id,v_version.id,p_owner_id,jsonb_build_object('version_number',1,'canonicalization_intent','initial_canonicalization'));
  INSERT INTO public.audit_events(business_representation_id,event_type,proposal_id,approval_id,version_id,actor_user_id,details)
  VALUES(v_rep.id,'version_created',v_proposal.id,v_approval.id,v_version.id,p_owner_id,jsonb_build_object('version_number',1,'canonicalization_intent','initial_canonicalization'));
  RETURN QUERY SELECT true,false,v_approval.id,v_version.id,v_version.version_number,'approved'::public.proposal_status,v_values;
END; $$;

ALTER FUNCTION public.zeya_decide_direct_hire_initial_canonicalization(uuid,uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_decide_direct_hire_initial_canonicalization(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_decide_direct_hire_initial_canonicalization(uuid,uuid,uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
