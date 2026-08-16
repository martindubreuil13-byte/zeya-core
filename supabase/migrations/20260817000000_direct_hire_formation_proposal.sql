BEGIN;

ALTER TABLE public.representation_proposals
  ADD COLUMN source_formation_outcome_package_id uuid REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  ADD COLUMN proposal_contract_version text CHECK (proposal_contract_version IS NULL OR proposal_contract_version='direct-hire-formation-proposal-v1'),
  ADD COLUMN source_state_fingerprint text CHECK (source_state_fingerprint IS NULL OR source_state_fingerprint~'^[0-9a-f]{64}$'),
  ADD COLUMN base_representation_version_id uuid REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  ADD COLUMN canonicalization_intent text CHECK (canonicalization_intent IS NULL OR canonicalization_intent='initial_canonicalization');
CREATE UNIQUE INDEX representation_proposals_direct_hire_source_unique
  ON public.representation_proposals(source_formation_outcome_package_id,coalesce(base_representation_version_id,'00000000-0000-0000-0000-000000000000'::uuid),proposal_contract_version)
  WHERE source_formation_outcome_package_id IS NOT NULL;

CREATE FUNCTION public.zeya_preserve_direct_hire_formation_proposal_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF OLD.source_formation_outcome_package_id IS NOT NULL AND (
    NEW.source_formation_outcome_package_id IS DISTINCT FROM OLD.source_formation_outcome_package_id OR NEW.proposal_contract_version IS DISTINCT FROM OLD.proposal_contract_version
    OR NEW.source_state_fingerprint IS DISTINCT FROM OLD.source_state_fingerprint OR NEW.base_representation_version_id IS DISTINCT FROM OLD.base_representation_version_id
    OR NEW.canonicalization_intent IS DISTINCT FROM OLD.canonicalization_intent OR NEW.proposed_changes IS DISTINCT FROM OLD.proposed_changes
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Direct Hire Formation proposal source lineage is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER representation_proposals_direct_hire_lineage_immutable BEFORE UPDATE ON public.representation_proposals
  FOR EACH ROW EXECUTE FUNCTION public.zeya_preserve_direct_hire_formation_proposal_lineage();

CREATE FUNCTION public.zeya_generate_direct_hire_formation_proposal(p_owner_id uuid,p_formation_session_id uuid)
RETURNS TABLE(proposal_id uuid,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_formation public.representation_formation_sessions%ROWTYPE; v_rep public.business_representations%ROWTYPE;
  v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE;
  v_existing public.representation_proposals%ROWTYPE; v_updates jsonb:='{}'::jsonb; v_sources uuid[]:='{}'::uuid[];
  v_target text; v_target_decision uuid; v_h record; v_fingerprint text; v_proposal uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_formation FROM public.representation_formation_sessions WHERE id=p_formation_session_id AND owner_id=p_owner_id FOR UPDATE;
  SELECT * INTO v_rep FROM public.business_representations WHERE id=v_formation.business_representation_id AND user_id=p_owner_id FOR UPDATE;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE formation_session_id=p_formation_session_id AND owner_id=p_owner_id AND status='completed';
  SELECT * INTO v_outcome FROM public.direct_hire_formation_outcome_packages WHERE formation_session_id=p_formation_session_id AND conversation_run_id=v_run.id AND owner_id=p_owner_id;
  IF v_formation.id IS NULL OR v_rep.id IS NULL OR v_formation.status<>'working_conversation_pending' OR v_rep.current_version_id IS NOT NULL
    OR v_run.id IS NULL OR v_run.completion_readiness_result->>'ready'<>'true' OR v_outcome.id IS NULL OR NOT v_outcome.noncanonical
    OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)
    OR NOT EXISTS(SELECT 1 FROM public.direct_hire_working_sessions working WHERE working.id=v_run.direct_hire_working_session_id AND working.owner_id=p_owner_id AND working.status='completed')
    OR EXISTS(SELECT 1 FROM public.representation_versions version WHERE version.business_representation_id=v_rep.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='Formation outcome is not eligible for proposal generation'; END IF;
  SELECT * INTO v_existing FROM public.representation_proposals WHERE source_formation_outcome_package_id=v_outcome.id AND proposal_contract_version='direct-hire-formation-proposal-v1';
  IF v_existing.id IS NOT NULL THEN RETURN QUERY SELECT v_existing.id,true; RETURN; END IF;

  FOR v_h IN
    SELECT h.id,h.constitutional_domain,h.current_belief,h.source_evidence_ids,h.confidence,h.representation_risk
    FROM public.hypotheses h JOIN LATERAL(SELECT verification.decision FROM public.hypothesis_verifications verification WHERE verification.hypothesis_id=h.id ORDER BY verification.verification_sequence DESC LIMIT 1) latest ON true
    WHERE h.owner_id=p_owner_id AND h.business_representation_id=v_rep.id AND h.constitutional_domain IN ('whatYouSell','problemOrAspiration','whyCustomersShouldCare','proposedDescription')
      AND h.epistemic_state='supported' AND latest.decision='approved' AND NOT EXISTS(SELECT 1 FROM public.hypotheses successor WHERE successor.previous_hypothesis_id=h.id)
    ORDER BY h.constitutional_domain
  LOOP
    v_updates:=v_updates||jsonb_build_object(v_h.constitutional_domain,jsonb_build_object('domain',v_h.constitutional_domain,'before',NULL,'after',v_h.current_belief,'reason','Confirmed during Formation','sourceType','hypothesis','sourceId',v_h.id,'confidence',v_h.confidence,'representationRisk',v_h.representation_risk));
    v_sources:=v_sources||v_h.source_evidence_ids;
  END LOOP;
  v_target:=v_outcome.outcome#>>'{commercial,primary_target_segment,value,statement}';
  v_target_decision:=nullif(v_outcome.outcome#>>'{commercial,primary_target_segment,sourceDecisionId}','')::uuid;
  IF nullif(btrim(coalesce(v_target,'')),'') IS NOT NULL AND v_target_decision IS NOT NULL THEN
    v_updates:=v_updates||jsonb_build_object('whoItIsFor',jsonb_build_object('domain','whoItIsFor','before',NULL,'after',v_target,'reason','Owner established the primary target during Formation','sourceType','formation_decision','sourceId',v_target_decision,'confidence','owner_confirmed','representationRisk','high'));
    SELECT array_append(v_sources,d.source_owner_evidence_id) INTO v_sources FROM public.direct_hire_formation_decisions d WHERE d.id=v_target_decision AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decision_supersessions s WHERE s.erroneous_decision_id=d.id);
  END IF;
  IF v_updates='{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='Formation outcome has no proposal-eligible Representation conclusions'; END IF;
  SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}'::uuid[]) INTO v_sources FROM unnest(v_sources) value;
  v_fingerprint:=encode(extensions.digest(convert_to(v_outcome.outcome_fingerprint||'|none|direct-hire-formation-proposal-v1|'||v_updates::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.representation_proposals(business_representation_id,formation_session_id,proposed_changes,supporting_evidence_ids,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale,source_formation_outcome_package_id,proposal_contract_version,source_state_fingerprint,base_representation_version_id,canonicalization_intent)
  VALUES(v_rep.id,p_formation_session_id,jsonb_build_object('_metadata',jsonb_build_object('contractVersion','direct-hire-formation-proposal-v1','formationSessionId',p_formation_session_id,'sourceOutcomePackageId',v_outcome.id,'sourceFingerprint',v_fingerprint,'canonicalizationIntent','initial_canonicalization'),'_review',jsonb_build_object('headline','Here is how I propose representing your business.'),'elementUpdates',v_updates),v_sources,'high','strategic_positioning',true,'pending_approval','zeya_direct_hire_formation','Based on the finalized working session, these are the confirmed business descriptions proposed for your review.',v_outcome.id,'direct-hire-formation-proposal-v1',v_fingerprint,NULL,'initial_canonicalization') RETURNING id INTO v_proposal;
  RETURN QUERY SELECT v_proposal,false;
END; $$;

ALTER FUNCTION public.zeya_generate_direct_hire_formation_proposal(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_preserve_direct_hire_formation_proposal_lineage() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_generate_direct_hire_formation_proposal(uuid,uuid),public.zeya_preserve_direct_hire_formation_proposal_lineage() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_generate_direct_hire_formation_proposal(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
