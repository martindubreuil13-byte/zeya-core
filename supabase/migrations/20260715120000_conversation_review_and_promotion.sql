BEGIN;

CREATE TYPE public.conversation_candidate_decision_type AS ENUM ('deferred','rejected','duplicate','acknowledged','accepted_for_promotion');
CREATE TYPE public.conversation_candidate_promotion_target AS ENUM ('evidence','observation','representation_proposal');

CREATE UNIQUE INDEX voice_candidates_review_identity_idx ON public.voice_conversation_candidates(id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id);
CREATE UNIQUE INDEX voice_outputs_review_identity_idx ON public.voice_conversation_outputs(id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id);

CREATE TABLE public.conversation_candidate_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL, conversation_output_id uuid NOT NULL,
 voice_context_id uuid NOT NULL, tenant_user_id uuid NOT NULL, business_id uuid NOT NULL,
 business_representation_id uuid NOT NULL, canonical_version_id uuid NOT NULL,
 reviewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 decision_type public.conversation_candidate_decision_type NOT NULL, decision_reason text,
 candidate_trust_level text NOT NULL, candidate_extraction_schema_version text NOT NULL,
 request_key uuid NOT NULL, decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,request_key),
 UNIQUE(id,candidate_id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id),
 CONSTRAINT conversation_review_candidate_identity_fk FOREIGN KEY(candidate_id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id)
  REFERENCES public.voice_conversation_candidates(id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id) ON DELETE RESTRICT,
 CONSTRAINT conversation_review_output_voice_fk FOREIGN KEY(conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id)
  REFERENCES public.voice_conversation_outputs(id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id) ON DELETE RESTRICT,
 CONSTRAINT conversation_review_reason_length CHECK(decision_reason IS NULL OR char_length(decision_reason)<=2000)
);

CREATE TABLE public.conversation_candidate_promotions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_decision_id uuid NOT NULL UNIQUE,
 candidate_id uuid NOT NULL UNIQUE, conversation_output_id uuid NOT NULL, voice_context_id uuid NOT NULL,
 tenant_user_id uuid NOT NULL, business_id uuid NOT NULL, business_representation_id uuid NOT NULL,
 canonical_version_id uuid NOT NULL, reviewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 target_type public.conversation_candidate_promotion_target NOT NULL, request_key uuid NOT NULL,
 request_payload jsonb NOT NULL CHECK(jsonb_typeof(request_payload)='object'), request_hash text NOT NULL,
 decision_reason text, related_element_id uuid REFERENCES public.representation_elements(id) ON DELETE RESTRICT,
 evidence_source_type public.evidence_source_type NOT NULL,
 evidence_id uuid REFERENCES public.evidence(id) ON DELETE RESTRICT,
 observation_id uuid REFERENCES public.observations(id) ON DELETE RESTRICT,
 representation_proposal_id uuid REFERENCES public.representation_proposals(id) ON DELETE RESTRICT,
 extracted_content jsonb NOT NULL CHECK(jsonb_typeof(extracted_content)='object'),
 confirmed_content jsonb NOT NULL CHECK(jsonb_typeof(confirmed_content)='object'), promoted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,request_key),
 CONSTRAINT conversation_promotion_review_identity_fk FOREIGN KEY(review_decision_id,candidate_id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id)
  REFERENCES public.conversation_candidate_review_decisions(id,candidate_id,conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id) ON DELETE RESTRICT,
 CONSTRAINT conversation_promotion_exact_target CHECK(
  (target_type='evidence' AND evidence_id IS NOT NULL AND observation_id IS NULL AND representation_proposal_id IS NULL) OR
  (target_type='observation' AND evidence_id IS NULL AND observation_id IS NOT NULL AND representation_proposal_id IS NULL) OR
  (target_type='representation_proposal' AND evidence_id IS NULL AND observation_id IS NULL AND representation_proposal_id IS NOT NULL))
);

CREATE INDEX conversation_reviews_tenant_idx ON public.conversation_candidate_review_decisions(tenant_user_id,decided_at DESC);
CREATE INDEX conversation_reviews_candidate_idx ON public.conversation_candidate_review_decisions(candidate_id,decided_at DESC);
CREATE INDEX conversation_promotions_tenant_idx ON public.conversation_candidate_promotions(tenant_user_id,promoted_at DESC);
CREATE INDEX conversation_promotions_output_idx ON public.conversation_candidate_promotions(conversation_output_id);
ALTER TABLE public.conversation_candidate_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_candidate_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_reviews_tenant_select ON public.conversation_candidate_review_decisions FOR SELECT TO authenticated USING(tenant_user_id=auth.uid());
CREATE POLICY conversation_promotions_tenant_select ON public.conversation_candidate_promotions FOR SELECT TO authenticated USING(tenant_user_id=auth.uid());
REVOKE ALL ON public.conversation_candidate_review_decisions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.conversation_candidate_promotions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.conversation_candidate_review_decisions TO authenticated,service_role;
GRANT SELECT ON public.conversation_candidate_promotions TO authenticated,service_role;

CREATE FUNCTION public.zeya_enforce_conversation_review_immutability() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='conversation review history is immutable';
END; $$;
CREATE TRIGGER zeya_conversation_review_immutability BEFORE UPDATE OR DELETE ON public.conversation_candidate_review_decisions FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_conversation_review_immutability();
CREATE TRIGGER zeya_conversation_promotion_immutability BEFORE UPDATE OR DELETE ON public.conversation_candidate_promotions FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_conversation_review_immutability();
REVOKE ALL ON FUNCTION public.zeya_enforce_conversation_review_immutability() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.zeya_review_voice_conversation_candidate(p_candidate_id uuid,p_decision public.conversation_candidate_decision_type,p_request_key uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.voice_conversation_candidates%ROWTYPE; o public.voice_conversation_outputs%ROWTYPE;
 latest public.conversation_candidate_review_decisions%ROWTYPE; existing public.conversation_candidate_review_decisions%ROWTYPE; decision_id uuid;
BEGIN
 IF auth.role()<>'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='review not authorized'; END IF;
 IF p_candidate_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate ID is required'; END IF;
 IF p_decision IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review decision is required'; END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='request key is required'; END IF;
 IF p_decision='accepted_for_promotion' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='promotion target is required'; END IF;
 IF p_reason IS NOT NULL AND char_length(p_reason)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review reason is too long'; END IF;
 SELECT * INTO c FROM public.voice_conversation_candidates WHERE id=p_candidate_id AND tenant_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='candidate not found'; END IF;
 SELECT * INTO o FROM public.voice_conversation_outputs WHERE id=c.conversation_output_id FOR SHARE;
 SELECT * INTO existing FROM public.conversation_candidate_review_decisions WHERE candidate_id=p_candidate_id AND request_key=p_request_key;
 IF FOUND THEN
  IF existing.decision_type=p_decision AND existing.decision_reason IS NOT DISTINCT FROM p_reason THEN
   RETURN jsonb_build_object('reviewDecisionId',existing.id,'decision',existing.decision_type,'idempotent',true);
  END IF;
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='review request conflicts';
 END IF;
 SELECT * INTO latest FROM public.conversation_candidate_review_decisions WHERE candidate_id=p_candidate_id ORDER BY decided_at DESC,id DESC LIMIT 1;
 IF FOUND AND latest.decision_type<>'deferred' THEN
  IF latest.decision_type=p_decision AND latest.decision_reason IS NOT DISTINCT FROM p_reason THEN
   RETURN jsonb_build_object('reviewDecisionId',latest.id,'decision',latest.decision_type,'idempotent',true);
  END IF;
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='candidate review is terminal';
 END IF;
 INSERT INTO public.conversation_candidate_review_decisions(candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,decision_type,decision_reason,candidate_trust_level,candidate_extraction_schema_version,request_key)
 VALUES(c.id,c.conversation_output_id,o.voice_context_id,c.tenant_user_id,c.business_id,c.business_representation_id,c.canonical_version_id,auth.uid(),p_decision,p_reason,c.transcript_trust_level,c.extraction_schema_version,p_request_key)
 RETURNING id INTO decision_id;
 RETURN jsonb_build_object('reviewDecisionId',decision_id,'decision',p_decision,'idempotent',false);
END; $$;

CREATE FUNCTION public.zeya_promote_voice_conversation_candidate(p_candidate_id uuid,p_target_type public.conversation_candidate_promotion_target,p_request_key uuid,p_confirmed_content jsonb,p_reason text DEFAULT NULL,p_related_element_id uuid DEFAULT NULL,p_evidence_source_type public.evidence_source_type DEFAULT 'conversation')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.voice_conversation_candidates%ROWTYPE; o public.voice_conversation_outputs%ROWTYPE;
 existing public.conversation_candidate_promotions%ROWTYPE; element public.representation_elements%ROWTYPE;
 v_decision_id uuid; v_evidence_id uuid; v_observation_id uuid; v_proposal_id uuid; v_promotion_id uuid;
 statement text; actor uuid; reason text; confirmed jsonb; payload jsonb; payload_hash text; allowed boolean:=false;
 ref jsonb; turn_index_numeric numeric; turn_index integer; turn jsonb; seen integer[]:=ARRAY[]::integer[];
BEGIN
 IF auth.role()<>'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='promotion not authorized'; END IF;
 IF p_candidate_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate ID is required'; END IF;
 IF p_target_type IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='promotion target is required'; END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='request key is required'; END IF;
 IF p_confirmed_content IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='confirmed content is required'; END IF;
 IF p_evidence_source_type IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source type is required'; END IF;
 IF jsonb_typeof(p_confirmed_content)<>'object' OR nullif(btrim(p_confirmed_content->>'statement'),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='confirmed statement is required'; END IF;
 IF p_reason IS NOT NULL AND char_length(p_reason)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='review reason is too long'; END IF;
 IF p_evidence_source_type<>'conversation' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='conversation promotion requires conversation Evidence source'; END IF;
 SELECT * INTO c FROM public.voice_conversation_candidates WHERE id=p_candidate_id AND tenant_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='candidate not found'; END IF;
 SELECT * INTO o FROM public.voice_conversation_outputs WHERE id=c.conversation_output_id FOR SHARE;
 statement:=btrim(p_confirmed_content->>'statement'); reason:=nullif(btrim(p_reason),'');
 confirmed:=jsonb_set(p_confirmed_content,'{statement}',to_jsonb(statement),true);
 payload:=jsonb_build_object('candidateId',p_candidate_id,'targetType',p_target_type,'confirmedContent',confirmed,'reason',reason,'relatedElementId',p_related_element_id,'evidenceSourceType',p_evidence_source_type);
 payload_hash:=encode(extensions.digest(payload::text,'sha256'),'hex');
 SELECT * INTO existing FROM public.conversation_candidate_promotions WHERE candidate_id=p_candidate_id AND request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=payload_hash AND existing.request_payload=payload THEN RETURN jsonb_build_object('reviewDecisionId',existing.review_decision_id,'promotionId',existing.id,'targetType',existing.target_type,'targetId',coalesce(existing.evidence_id,existing.observation_id,existing.representation_proposal_id),'idempotent',true); END IF;
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='promotion request conflicts';
 END IF;
 SELECT * INTO existing FROM public.conversation_candidate_promotions WHERE candidate_id=p_candidate_id;
 IF FOUND THEN
  IF existing.request_hash=payload_hash AND existing.request_payload=payload THEN RETURN jsonb_build_object('reviewDecisionId',existing.review_decision_id,'promotionId',existing.id,'targetType',existing.target_type,'targetId',coalesce(existing.evidence_id,existing.observation_id,existing.representation_proposal_id),'idempotent',true); END IF;
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='candidate already promoted with different configuration';
 END IF;
 allowed:=CASE p_target_type
  WHEN 'evidence' THEN c.candidate_type='candidate_evidence'
  WHEN 'observation' THEN c.candidate_type IN('candidate_observation','customer_need','customer_aspiration','customer_language','qualification_signal','possible_representation_gap','possible_contradiction')
  WHEN 'representation_proposal' THEN c.candidate_type IN('possible_representation_gap','possible_contradiction','candidate_observation','customer_need','customer_aspiration','customer_language') ELSE false END;
 IF NOT allowed THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate cannot be promoted to requested target'; END IF;
 IF p_target_type='evidence' AND (c.transcript_trust_level<>'provider_attested' OR c.speaker_role IN('zeya','veya','unknown')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate is not eligible for Evidence'; END IF;
 IF p_target_type='evidence' THEN
  IF jsonb_typeof(c.source_reference)<>'object' OR jsonb_typeof(c.source_reference->'turnIndexes')<>'array' OR jsonb_array_length(c.source_reference->'turnIndexes')=0 OR jsonb_typeof(o.transcript)<>'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='valid source references are required for Evidence'; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(c.source_reference->'turnIndexes') LOOP
   IF jsonb_typeof(ref)<>'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source turn index is invalid'; END IF;
   BEGIN
    turn_index_numeric:=(ref#>>'{}')::numeric;
   EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source turn index is invalid';
   END;
   IF turn_index_numeric<>trunc(turn_index_numeric) OR turn_index_numeric<0 OR turn_index_numeric>2147483647 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source turn index is invalid'; END IF;
   IF turn_index_numeric>=jsonb_array_length(o.transcript) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source turn index is out of range'; END IF;
   turn_index:=turn_index_numeric::integer;
   IF turn_index=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source turn indexes must be unique'; END IF;
   seen:=array_append(seen,turn_index); turn:=o.transcript->turn_index;
   IF jsonb_typeof(turn)<>'object' OR turn->>'role' NOT IN('customer','agent') OR jsonb_typeof(turn->'text')<>'string' OR nullif(btrim(turn->>'text'),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source transcript turn is invalid'; END IF;
   IF c.speaker_role IN('customer','founder','staff') AND turn->>'role'<>'customer' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Evidence source speaker does not match transcript turn'; END IF;
  END LOOP;
 END IF;
 IF p_related_element_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.representation_elements e WHERE e.id=p_related_element_id AND e.business_representation_id=c.business_representation_id AND e.element_key=ANY(c.relevant_element_keys)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='related element is not authorized'; END IF;
 IF p_target_type='representation_proposal' AND p_related_element_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='related element is required for Proposal'; END IF;
 IF p_target_type='representation_proposal' THEN
  SELECT * INTO element FROM public.representation_elements e WHERE e.id=p_related_element_id AND e.business_representation_id=c.business_representation_id AND e.element_key=ANY(c.relevant_element_keys) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='related element is not authorized'; END IF;
  IF confirmed?'elementKey' AND confirmed->>'elementKey'<>element.element_key THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='submitted Element does not match stored Element'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.conversation_candidate_review_decisions d WHERE d.candidate_id=p_candidate_id AND d.decision_type<>'deferred') THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='candidate review is terminal'; END IF;
 actor:=auth.uid();
 INSERT INTO public.conversation_candidate_review_decisions(candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,decision_type,decision_reason,candidate_trust_level,candidate_extraction_schema_version,request_key)
 VALUES(c.id,c.conversation_output_id,o.voice_context_id,c.tenant_user_id,c.business_id,c.business_representation_id,c.canonical_version_id,auth.uid(),'accepted_for_promotion',reason,c.transcript_trust_level,c.extraction_schema_version,p_request_key) RETURNING id INTO v_decision_id;
 INSERT INTO public.evidence(business_representation_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)
 VALUES(c.business_representation_id,p_evidence_source_type,'Founder-confirmed conversation promotion',statement,ARRAY[]::text[],actor) RETURNING id INTO v_evidence_id;
 IF p_target_type IN('observation','representation_proposal') THEN
  INSERT INTO public.observations(business_representation_id,evidence_id,interpreted_meaning,confidence_in_interpretation,affected_domains,affected_elements,created_by_actor)
  VALUES(c.business_representation_id,v_evidence_id,statement,least(100,greatest(0,round(c.confidence*100)::integer)),ARRAY[]::text[],CASE WHEN p_related_element_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_related_element_id::text] END,actor) RETURNING id INTO v_observation_id;
 END IF;
 IF p_target_type='representation_proposal' THEN
  INSERT INTO public.representation_proposals(business_representation_id,proposed_changes,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale)
  VALUES(c.business_representation_id,jsonb_build_object(element.element_key,jsonb_build_object('before',NULL,'after',statement)),'high',element.field_sensitivity,true,'pending_approval',actor,coalesce(reason,'Founder-confirmed conversation promotion')) RETURNING id INTO v_proposal_id;
  INSERT INTO public.proposal_evidence(proposal_id,evidence_id,business_representation_id) VALUES(v_proposal_id,v_evidence_id,c.business_representation_id);
  INSERT INTO public.proposal_observations(proposal_id,observation_id,business_representation_id) VALUES(v_proposal_id,v_observation_id,c.business_representation_id);
  INSERT INTO public.proposal_elements(proposal_id,element_id,business_representation_id) VALUES(v_proposal_id,element.id,c.business_representation_id);
 END IF;
 INSERT INTO public.conversation_candidate_promotions(review_decision_id,candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,target_type,request_key,request_payload,request_hash,decision_reason,related_element_id,evidence_source_type,evidence_id,observation_id,representation_proposal_id,extracted_content,confirmed_content)
 VALUES(v_decision_id,c.id,c.conversation_output_id,o.voice_context_id,c.tenant_user_id,c.business_id,c.business_representation_id,c.canonical_version_id,auth.uid(),p_target_type,p_request_key,payload,payload_hash,reason,p_related_element_id,p_evidence_source_type,CASE WHEN p_target_type='evidence' THEN v_evidence_id END,CASE WHEN p_target_type='observation' THEN v_observation_id END,CASE WHEN p_target_type='representation_proposal' THEN v_proposal_id END,c.content,confirmed) RETURNING id INTO v_promotion_id;
 RETURN jsonb_build_object('reviewDecisionId',v_decision_id,'promotionId',v_promotion_id,'targetType',p_target_type,'targetId',coalesce(v_proposal_id,v_observation_id,v_evidence_id),'idempotent',false);
END; $$;

REVOKE ALL ON FUNCTION public.zeya_review_voice_conversation_candidate(uuid,public.conversation_candidate_decision_type,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_review_voice_conversation_candidate(uuid,public.conversation_candidate_decision_type,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
