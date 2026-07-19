BEGIN;

CREATE UNIQUE INDEX representation_proposals_id_representation_idx
  ON public.representation_proposals(id, business_representation_id);
CREATE UNIQUE INDEX approval_decisions_canonicalization_identity_idx
  ON public.approval_decisions(id, representation_proposal_id, business_representation_id);
CREATE UNIQUE INDEX confidence_assessments_canonicalization_identity_idx
  ON public.confidence_assessments(id, representation_version_id, business_representation_id);

CREATE TABLE public.conversation_candidate_canonicalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL,
  review_decision_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  conversation_output_id uuid NOT NULL,
  voice_context_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  business_id uuid NOT NULL,
  business_representation_id uuid NOT NULL,
  baseline_canonical_version_id uuid NOT NULL,
  representation_proposal_id uuid NOT NULL,
  approval_decision_id uuid NOT NULL,
  canonical_version_id uuid NOT NULL,
  confidence_assessment_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL,
  request_payload jsonb NOT NULL CONSTRAINT conversation_canonicalization_payload_object CHECK (jsonb_typeof(request_payload) = 'object'),
  request_hash text NOT NULL,
  canonicalized_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_canonicalization_promotion_unique UNIQUE (promotion_id),
  CONSTRAINT conversation_canonicalization_candidate_unique UNIQUE (candidate_id),
  CONSTRAINT conversation_canonicalization_request_unique UNIQUE (request_key),
  CONSTRAINT conversation_canonicalization_proposal_unique UNIQUE (representation_proposal_id),
  CONSTRAINT conversation_canonicalization_version_unique UNIQUE (canonical_version_id),
  CONSTRAINT conversation_canonicalization_confidence_unique UNIQUE (confidence_assessment_id),
  CONSTRAINT conversation_canonicalization_business_tenant_fk FOREIGN KEY (business_id, tenant_user_id)
    REFERENCES public.businesses(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_representation_business_fk FOREIGN KEY (business_representation_id, business_id)
    REFERENCES public.business_representations(id, business_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_baseline_representation_fk FOREIGN KEY (baseline_canonical_version_id, business_representation_id)
    REFERENCES public.representation_versions(id, business_representation_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_version_representation_fk FOREIGN KEY (canonical_version_id, business_representation_id)
    REFERENCES public.representation_versions(id, business_representation_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_proposal_representation_fk FOREIGN KEY (representation_proposal_id, business_representation_id)
    REFERENCES public.representation_proposals(id, business_representation_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_approval_identity_fk FOREIGN KEY (approval_decision_id, representation_proposal_id, business_representation_id)
    REFERENCES public.approval_decisions(id, representation_proposal_id, business_representation_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_confidence_identity_fk FOREIGN KEY (confidence_assessment_id, canonical_version_id, business_representation_id)
    REFERENCES public.confidence_assessments(id, representation_version_id, business_representation_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_promotion_fk FOREIGN KEY (promotion_id)
    REFERENCES public.conversation_candidate_promotions(id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_review_fk FOREIGN KEY (review_decision_id)
    REFERENCES public.conversation_candidate_review_decisions(id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_candidate_fk FOREIGN KEY (candidate_id)
    REFERENCES public.voice_conversation_candidates(id) ON DELETE RESTRICT,
  CONSTRAINT conversation_canonicalization_output_fk FOREIGN KEY (conversation_output_id)
    REFERENCES public.voice_conversation_outputs(id) ON DELETE RESTRICT
);

CREATE INDEX conversation_candidate_canonicalizations_tenant_idx
  ON public.conversation_candidate_canonicalizations(tenant_user_id, canonicalized_at DESC);
CREATE INDEX conversation_candidate_canonicalizations_representation_idx
  ON public.conversation_candidate_canonicalizations(business_representation_id, canonicalized_at DESC);

ALTER TABLE public.conversation_candidate_canonicalizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_candidate_canonicalizations_tenant_select
  ON public.conversation_candidate_canonicalizations FOR SELECT TO authenticated
  USING (tenant_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = conversation_candidate_canonicalizations.business_id
      AND b.user_id = auth.uid()
  ));
REVOKE ALL ON public.conversation_candidate_canonicalizations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.conversation_candidate_canonicalizations TO authenticated, service_role;

CREATE FUNCTION public.zeya_enforce_conversation_candidate_canonicalization_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'conversation candidate canonicalization is immutable';
END;
$$;
CREATE TRIGGER zeya_conversation_candidate_canonicalization_immutability
  BEFORE UPDATE OR DELETE ON public.conversation_candidate_canonicalizations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_conversation_candidate_canonicalization_immutability();
REVOKE ALL ON FUNCTION public.zeya_enforce_conversation_candidate_canonicalization_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.zeya_promote_voice_candidate_to_canonical(
  p_actor_user_id uuid,
  p_candidate_id uuid,
  p_request_key uuid,
  p_confirmed_content jsonb,
  p_reason text,
  p_related_element_id uuid,
  p_element_values jsonb,
  p_overall_confidence_score smallint,
  p_approval_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.voice_conversation_candidates%ROWTYPE;
  br public.business_representations%ROWTYPE;
  e public.representation_elements%ROWTYPE;
  promotion public.conversation_candidate_promotions%ROWTYPE;
  proposal public.representation_proposals%ROWTYPE;
  approval public.approval_decisions%ROWTYPE;
  existing public.conversation_candidate_canonicalizations%ROWTYPE;
  promotion_result jsonb;
  version_result record;
  canonicalization_id uuid;
  confidence_id uuid;
  element_key text;
  statement text;
  normalized_confirmed jsonb;
  normalized_reason text := nullif(btrim(p_reason), '');
  normalized_approval_reason text := nullif(btrim(p_approval_reason), '');
  payload jsonb;
  payload_hash text;
  evidence_total integer;
  confidence_band text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='canonicalization not authorized'; END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_actor_user_id) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='canonicalization actor not authorized'; END IF;
  IF p_candidate_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate ID is required'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='request key is required'; END IF;
  IF p_confirmed_content IS NULL OR jsonb_typeof(p_confirmed_content)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='confirmed content must be an object'; END IF;
  statement := nullif(btrim(p_confirmed_content->>'statement'), '');
  IF statement IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='confirmed statement is required'; END IF;
  IF p_related_element_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='related element is required'; END IF;
  IF p_element_values IS NULL OR jsonb_typeof(p_element_values)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_element_values))<>1 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='exactly one canonical Element is required'; END IF;
  IF p_overall_confidence_score IS NULL OR p_overall_confidence_score<0 OR p_overall_confidence_score>100 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='confidence score must be between 0 and 100'; END IF;

  normalized_confirmed := jsonb_set(p_confirmed_content, '{statement}', to_jsonb(statement), true);
  payload := jsonb_build_object('actorUserId',p_actor_user_id,'candidateId',p_candidate_id,'confirmedContent',normalized_confirmed,'reason',normalized_reason,'relatedElementId',p_related_element_id,'elementValues',p_element_values,'overallConfidenceScore',p_overall_confidence_score,'approvalReason',normalized_approval_reason);
  payload_hash := encode(extensions.digest(payload::text, 'sha256'), 'hex');

  SELECT * INTO c FROM public.voice_conversation_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='candidate not found'; END IF;
  IF c.tenant_user_id<>p_actor_user_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='canonicalization not authorized'; END IF;

  SELECT * INTO existing FROM public.conversation_candidate_canonicalizations WHERE candidate_id=p_candidate_id;
  IF FOUND THEN
    IF existing.request_hash=payload_hash AND existing.request_payload=payload THEN
      SELECT rv.version_number INTO version_result FROM public.representation_versions rv WHERE rv.id=existing.canonical_version_id;
      RETURN jsonb_build_object('reviewDecisionId',existing.review_decision_id,'promotionId',existing.promotion_id,'proposalId',existing.representation_proposal_id,'approvalDecisionId',existing.approval_decision_id,'baselineCanonicalVersionId',existing.baseline_canonical_version_id,'canonicalVersionId',existing.canonical_version_id,'canonicalVersionNumber',version_result.version_number,'confidenceAssessmentId',existing.confidence_assessment_id,'canonicalizationId',existing.id,'idempotent',true);
    END IF;
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='canonicalization request conflicts';
  END IF;
  SELECT * INTO existing FROM public.conversation_candidate_canonicalizations WHERE request_key=p_request_key;
  IF FOUND THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='canonicalization request conflicts'; END IF;

  SELECT * INTO br FROM public.business_representations WHERE id=c.business_representation_id FOR UPDATE;
  IF NOT FOUND OR br.business_id<>c.business_id OR br.user_id<>p_actor_user_id
     OR NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=c.business_id AND b.user_id=p_actor_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.voice_conversation_outputs o WHERE o.id=c.conversation_output_id AND o.tenant_user_id=c.tenant_user_id AND o.business_id=c.business_id AND o.business_representation_id=c.business_representation_id AND o.canonical_version_id=c.canonical_version_id)
     OR NOT EXISTS (SELECT 1 FROM public.representation_versions rv WHERE rv.id=c.canonical_version_id AND rv.business_representation_id=c.business_representation_id)
  THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='candidate lineage is invalid'; END IF;
  IF c.canonical_version_id IS DISTINCT FROM br.current_version_id THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='canonical baseline changed'; END IF;

  SELECT * INTO e FROM public.representation_elements re WHERE re.id=p_related_element_id AND re.business_representation_id=c.business_representation_id AND re.element_key=ANY(c.relevant_element_keys) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='related element is not authorized'; END IF;
  element_key := e.element_key;
  IF normalized_confirmed ? 'elementKey' AND normalized_confirmed->>'elementKey'<>element_key THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='submitted Element does not match stored Element'; END IF;
  IF NOT (p_element_values ? element_key) OR jsonb_typeof(p_element_values->element_key)<>'object' OR nullif(btrim(p_element_values->element_key->>'value'),'') IS DISTINCT FROM statement THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='canonical Element value does not match confirmed statement'; END IF;

  promotion_result := public.zeya_promote_voice_conversation_candidate_internal(p_actor_user_id,p_candidate_id,'representation_proposal',p_request_key,normalized_confirmed,normalized_reason,p_related_element_id,'conversation');
  SELECT * INTO promotion FROM public.conversation_candidate_promotions WHERE id=(promotion_result->>'promotionId')::uuid FOR SHARE;
  IF NOT FOUND OR promotion.review_decision_id<>(promotion_result->>'reviewDecisionId')::uuid OR promotion.representation_proposal_id<>(promotion_result->>'targetId')::uuid OR promotion.target_type<>'representation_proposal' OR promotion.reviewer_user_id<>p_actor_user_id OR promotion.tenant_user_id<>p_actor_user_id OR promotion.business_id<>c.business_id OR promotion.business_representation_id<>c.business_representation_id OR promotion.canonical_version_id<>c.canonical_version_id OR promotion.related_element_id<>p_related_element_id OR promotion.request_key<>p_request_key THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='promotion lineage is invalid'; END IF;
  IF promotion.canonical_version_id IS DISTINCT FROM br.current_version_id THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='canonical baseline changed'; END IF;

  SELECT * INTO proposal FROM public.representation_proposals rp WHERE rp.id=promotion.representation_proposal_id AND rp.business_representation_id=c.business_representation_id FOR UPDATE;
  IF NOT FOUND OR proposal.status IN ('rejected'::public.proposal_status,'superseded'::public.proposal_status) OR proposal.expires_at IS NOT NULL AND proposal.expires_at<=now() OR NOT proposal.requires_approval OR (SELECT count(*) FROM jsonb_object_keys(proposal.proposed_changes))<>1 OR NOT (proposal.proposed_changes ? element_key) OR proposal.proposed_changes->element_key->>'after' IS DISTINCT FROM statement OR (SELECT count(*) FROM public.proposal_evidence pe WHERE pe.proposal_id=proposal.id AND pe.business_representation_id=c.business_representation_id)<>1 OR (SELECT count(*) FROM public.proposal_observations po WHERE po.proposal_id=proposal.id AND po.business_representation_id=c.business_representation_id)<>1 OR NOT EXISTS (SELECT 1 FROM public.proposal_elements pel WHERE pel.proposal_id=proposal.id AND pel.element_id=p_related_element_id AND pel.business_representation_id=c.business_representation_id) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Proposal lineage is invalid'; END IF;
  IF proposal.status NOT IN ('pending_approval'::public.proposal_status,'approved'::public.proposal_status) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal is not awaiting approval'; END IF;

  SELECT * INTO approval FROM public.approval_decisions ad WHERE ad.representation_proposal_id=proposal.id FOR SHARE;
  IF FOUND THEN
    IF approval.decision<>'approved'::public.approval_decision_type THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal approval was rejected'; END IF;
    IF approval.approver_user_id<>p_actor_user_id OR approval.business_representation_id<>c.business_representation_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Proposal approved by a different actor'; END IF;
  ELSE
    INSERT INTO public.approval_decisions(business_representation_id,representation_proposal_id,decision,approver_user_id,approval_reason)
    VALUES(c.business_representation_id,proposal.id,'approved',p_actor_user_id,coalesce(normalized_approval_reason,'Founder-confirmed voice candidate canonicalization')) RETURNING * INTO approval;
  END IF;
  IF proposal.status='pending_approval'::public.proposal_status THEN UPDATE public.representation_proposals SET status='approved'::public.proposal_status,status_updated_at=now() WHERE id=proposal.id AND status='pending_approval'::public.proposal_status;
  ELSIF NOT EXISTS (SELECT 1 FROM public.conversation_candidate_canonicalizations x WHERE x.representation_proposal_id=proposal.id) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='approved Proposal is not a canonicalization replay'; END IF;

  SELECT * INTO version_result FROM public.zeya_create_canonical_version_atomic(c.business_representation_id,c.business_id,proposal.id,p_element_values,p_overall_confidence_score,p_actor_user_id,NULL);
  confidence_band := CASE WHEN p_overall_confidence_score<20 THEN 'very_low' WHEN p_overall_confidence_score<40 THEN 'low' WHEN p_overall_confidence_score<60 THEN 'moderate' WHEN p_overall_confidence_score<80 THEN 'high' ELSE 'very_high' END;
  SELECT count(*)::integer INTO evidence_total FROM public.proposal_evidence pe WHERE pe.proposal_id=proposal.id;
  INSERT INTO public.confidence_assessments(business_representation_id,representation_version_id,confidence_score,confidence_band,evidence_count,source_diversity_score,source_quality_score,recency_score,contradiction_penalty,calculation_method,calculation_version,calculation_timestamp,rationale,factors)
  VALUES(c.business_representation_id,version_result.version_id,p_overall_confidence_score,confidence_band,evidence_total,CASE WHEN evidence_total>0 THEN 100 ELSE 0 END,least(100,greatest(0,round(c.confidence*100)::integer)),100,0,'voice_candidate_canonicalization_v1','1.0',now(),'Initial confidence recorded from a founder-confirmed voice candidate and its linked immutable Evidence.',jsonb_build_object('source','voice_candidate','candidate_id',c.id,'promotion_id',promotion.id,'review_decision_id',promotion.review_decision_id,'representation_proposal_id',proposal.id,'approval_decision_id',approval.id,'baseline_canonical_version_id',c.canonical_version_id,'related_element_id',p_related_element_id,'transcript_trust_level',c.transcript_trust_level,'candidate_confidence',c.confidence)) RETURNING id INTO confidence_id;

  INSERT INTO public.conversation_candidate_canonicalizations(promotion_id,review_decision_id,candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,baseline_canonical_version_id,representation_proposal_id,approval_decision_id,canonical_version_id,confidence_assessment_id,actor_user_id,request_key,request_payload,request_hash)
  VALUES(promotion.id,promotion.review_decision_id,c.id,c.conversation_output_id,promotion.voice_context_id,c.tenant_user_id,c.business_id,c.business_representation_id,c.canonical_version_id,proposal.id,approval.id,version_result.version_id,confidence_id,p_actor_user_id,p_request_key,payload,payload_hash) RETURNING id INTO canonicalization_id;
  RETURN jsonb_build_object('reviewDecisionId',promotion.review_decision_id,'promotionId',promotion.id,'proposalId',proposal.id,'approvalDecisionId',approval.id,'baselineCanonicalVersionId',c.canonical_version_id,'canonicalVersionId',version_result.version_id,'canonicalVersionNumber',version_result.version_number,'confidenceAssessmentId',confidence_id,'canonicalizationId',canonicalization_id,'idempotent',false);
END;
$$;

ALTER FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation(p_business_representation_id uuid,p_expected_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth','pg_temp' AS $$
DECLARE actual_business_id uuid; deleted jsonb:='{}'::jsonb; n integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='purge not authorized'; END IF;
 SELECT business_id INTO actual_business_id FROM public.business_representations WHERE id=p_business_representation_id FOR UPDATE;
 IF actual_business_id IS NULL OR actual_business_id<>p_expected_business_id THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='representation not found'; END IF;
 PERFORM set_config('zeya.controlled_purge','on',true);
 DELETE FROM public.conversation_candidate_canonicalizations WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('conversation_candidate_canonicalizations',n);
 DELETE FROM public.audit_events WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('audit_events',n);
 DELETE FROM public.confidence_assessments WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('confidence_assessments',n);
 DELETE FROM public.conversation_candidate_promotions WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('conversation_candidate_promotions',n);
 DELETE FROM public.conversation_candidate_review_decisions WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('conversation_candidate_review_decisions',n);
 DELETE FROM public.voice_conversation_candidates WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_conversation_candidates',n);
 DELETE FROM public.voice_conversation_outputs WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_conversation_outputs',n);
 DELETE FROM public.voice_representation_lineage WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_representation_lineage',n);
 UPDATE public.business_representations SET current_version_id=NULL WHERE id=p_business_representation_id AND business_id=p_expected_business_id;
 UPDATE public.representation_elements SET current_value_version_id=NULL WHERE business_representation_id=p_business_representation_id;
 DELETE FROM public.representation_versions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_versions',n);
 DELETE FROM public.approval_decisions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('approval_decisions',n);
 DELETE FROM public.proposal_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_elements',n);
 DELETE FROM public.proposal_evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_evidence',n);
 DELETE FROM public.proposal_observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_observations',n);
 DELETE FROM public.representation_proposals WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_proposals',n);
 DELETE FROM public.observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('observations',n);
 DELETE FROM public.evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('evidence',n);
 DELETE FROM public.representation_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_elements',n);
 DELETE FROM public.representation_domains WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_domains',n);
 DELETE FROM public.business_representations WHERE id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('business_representations',n);
 PERFORM set_config('zeya.controlled_purge','off',true);
 RETURN jsonb_build_object('businessRepresentationId',p_business_representation_id,'businessId',p_expected_business_id,'deleted',deleted);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('zeya.controlled_purge','off',true); RAISE;
END; $$;
ALTER FUNCTION public.zeya_purge_business_representation(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
