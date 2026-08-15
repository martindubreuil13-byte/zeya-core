BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_normalize_direct_hire_authority_disposition(p_disposition text,p_statement text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_disposition IN ('allowed_within_bounds','owner_approval_required','prohibited','unresolved') THEN p_disposition
    WHEN coalesce(p_statement,'') ~* '\m(owner approval|required approval|requires? my approval|needs? my approval|check with me first|get my approval first|subject to my approval|must escalate|escalate to)\M' THEN 'owner_approval_required'
    WHEN coalesce(p_statement,'') ~* '\m(prohibited|never|must not|may not|cannot|can''t|do not|don''t)\M' THEN 'prohibited'
    WHEN p_disposition='granted' AND coalesce(p_statement,'') ~* '\m(up to|within|only|limited to|provided that|as long as)\M' THEN 'allowed_within_bounds'
    ELSE 'unresolved' END
$$;

CREATE FUNCTION public.zeya_set_direct_hire_question_semantic_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.speaker='zeya' AND NEW.turn_type='follow_up_question' AND NEW.governed_semantic_key IS NULL THEN
    SELECT prior.governed_semantic_key INTO NEW.governed_semantic_key
    FROM public.direct_hire_formation_conversation_turns prior
    WHERE prior.run_id=NEW.run_id AND prior.speaker='zeya' ORDER BY prior.sequence DESC LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_question_semantic_inheritance BEFORE INSERT ON public.direct_hire_formation_conversation_turns
  FOR EACH ROW EXECUTE FUNCTION public.zeya_set_direct_hire_question_semantic_key();

CREATE OR REPLACE FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_text text:=coalesce(NEW.decision_value->>'statement',''); v_disposition text;
BEGIN
  IF NEW.decision_scope<>'authority' OR pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  v_disposition:=public.zeya_normalize_direct_hire_authority_disposition(NEW.disposition,v_text);
  INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
  SELECT NEW.formation_session_id,NEW.run_id,NEW.source_agenda_item_id,NEW.source_owner_turn_id,NEW.source_owner_evidence_id,'authority',candidate.key,candidate.disposition,NEW.decision_value,true
  FROM (VALUES
    (public.zeya_normalize_direct_hire_formation_decision_key(NEW.decision_key),v_disposition),
    (CASE WHEN v_text~*'discount' THEN 'authority_discounts' END,CASE WHEN v_text~*'(approval|check with me|subject to).*(discount)|discount.*(approval|check with me|subject to)' THEN 'owner_approval_required' ELSE v_disposition END),
    (CASE WHEN v_text~*'negotiat' THEN 'authority_negotiation' END,CASE WHEN v_text~*'(may not|must not|cannot|can''t|do not|don''t).{0,20}negotiat' THEN 'prohibited' ELSE v_disposition END),
    (CASE WHEN v_text~*'(promise|commit|guarantee)' THEN 'authority_customer_commitments' END,CASE WHEN v_text~*'(may not|must not|cannot|can''t|do not|don''t).{0,30}(promise|commit|guarantee)' THEN 'prohibited' ELSE v_disposition END),
    (CASE WHEN v_text~*'(book|schedule).{0,20}meeting|meeting.{0,20}(book|schedule)' THEN 'authority_meeting_booking' END,CASE WHEN v_text~*'(may|can).{0,30}(book|schedule).{0,20}(qualified )?meeting' THEN 'allowed_within_bounds' ELSE v_disposition END),
    (CASE WHEN v_text~*'(owner approval|required approval|requires? my approval|needs? my approval|check with me first|get my approval first|subject to my approval)' THEN 'authority_owner_approval_required' END,'owner_approval_required'),
    (CASE WHEN v_text~*'escalat' THEN 'authority_escalation_rules' END,'owner_approval_required'),
    (CASE WHEN v_text~*'(prohibited claim|may not guarantee|must not claim)' THEN 'authority_prohibited_claims' END,'prohibited')
  ) candidate(key,disposition) WHERE candidate.key IS NOT NULL AND candidate.key<>NEW.decision_key
  ON CONFLICT (source_owner_turn_id,decision_key) DO NOTHING;
  RETURN NEW;
END; $$;

-- Replaces only the deployed P2.3B answer RPC. Its persistence and completion
-- behavior are unchanged; synthetic readiness questions now carry their
-- contract key, and bounded follow-ups inherit it through the trigger above.
CREATE OR REPLACE FUNCTION public.zeya_record_direct_hire_formation_answer(
  p_owner_id uuid,p_run_id uuid,p_agenda_item_id uuid,p_idempotency_key uuid,p_owner_text text,
  p_classification text,p_resolution_state text,p_decision_key text DEFAULT NULL,p_decision_value jsonb DEFAULT NULL,
  p_hypothesis_operation_id uuid DEFAULT NULL
) RETURNS TABLE(owner_turn_id uuid,resolution_event_id uuid,replayed boolean,complete boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE;
  v_existing public.direct_hire_formation_conversation_turns%ROWTYPE; v_turn_id uuid; v_event_id uuid; v_evidence_id uuid; v_decision_id uuid;
  v_sequence integer; v_followups integer; v_next public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE; v_complete boolean:=false;
  v_next_text text; v_required_scope text; v_required_key text; v_next_semantic_key text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_owner_id IS NULL OR p_run_id IS NULL OR p_agenda_item_id IS NULL OR p_idempotency_key IS NULL
    OR char_length(btrim(coalesce(p_owner_text,''))) NOT BETWEEN 1 AND 4000
    OR p_classification NOT IN ('confirm','correct','authority_grant','authority_restriction','commercial_decision','defer','unclear','nonresponsive')
    OR p_resolution_state NOT IN ('resolved','deferred','still_unresolved','superseded_by_prior_answer') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid conversation answer'; END IF;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status<>'active' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation is not active'; END IF;
  SELECT * INTO v_existing FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id AND idempotency_key=p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.agenda_item_id IS DISTINCT FROM p_agenda_item_id OR v_existing.owner_safe_text IS DISTINCT FROM btrim(p_owner_text) THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='answer idempotency conflict'; END IF;
    SELECT id INTO v_event_id FROM public.direct_hire_formation_agenda_resolution_events WHERE owner_turn_id=v_existing.id;
    RETURN QUERY SELECT v_existing.id,v_event_id,true,v_run.status='completed'; RETURN;
  END IF;
  SELECT * INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE id=p_agenda_item_id AND formation_session_id=v_run.formation_session_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='agenda item not found'; END IF;
  SELECT count(*) INTO v_followups FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=p_agenda_item_id AND e.resolution_state='still_unresolved';
  IF p_resolution_state='still_unresolved' AND v_followups>=1 THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded follow-up exhausted'; END IF;
  IF p_classification IN ('confirm','correct','defer') AND cardinality(v_item.source_hypothesis_ids)>0 AND (p_hypothesis_operation_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.hypothesis_owner_operations op WHERE op.operation_id=p_hypothesis_operation_id AND op.owner_id=p_owner_id AND op.hypothesis_id=ANY(v_item.source_hypothesis_ids)
      AND op.decision=CASE p_classification WHEN 'confirm' THEN 'approved'::public.approval_decision_type WHEN 'correct' THEN 'rejected'::public.approval_decision_type ELSE 'deferred'::public.approval_decision_type END
  )) THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed hypothesis operation required'; END IF;
  SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
  INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,idempotency_key)
    VALUES(p_run_id,v_sequence,p_agenda_item_id,'owner',btrim(p_owner_text),'owner_answer',p_idempotency_key) RETURNING id INTO v_turn_id;
  IF p_classification IN ('authority_grant','authority_restriction','commercial_decision') THEN
    INSERT INTO public.evidence(business_representation_id,direct_hire_onboarding_session_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)
    SELECT v_run.business_representation_id,h.direct_hire_onboarding_session_id,'manual'::public.evidence_source_type,'Owner answer in governed Formation text session',btrim(p_owner_text),ARRAY[coalesce(v_item.constitutional_domain,CASE WHEN v_item.category='authority' THEN 'authorityBoundaries' ELSE 'clarificationsNeeded' END)]::text[],'owner:'||p_owner_id::text
    FROM public.direct_hire_first_working_session_formation_handoffs h WHERE h.id=v_run.formation_handoff_id RETURNING id INTO v_evidence_id;
    IF p_decision_key IS NULL OR p_decision_value IS NULL OR jsonb_typeof(p_decision_value)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='structured Formation decision required'; END IF;
    INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
    VALUES(v_run.formation_session_id,p_run_id,p_agenda_item_id,v_turn_id,v_evidence_id,CASE WHEN p_classification LIKE 'authority_%' THEN 'authority' ELSE 'commercial' END,p_decision_key,CASE p_classification WHEN 'authority_grant' THEN 'granted' WHEN 'authority_restriction' THEN 'restricted' ELSE 'decided' END,p_decision_value,true) RETURNING id INTO v_decision_id;
  END IF;
  INSERT INTO public.direct_hire_formation_agenda_resolution_events(run_id,agenda_item_id,owner_turn_id,resolution_state,answer_classification,evidence_id,hypothesis_operation_id,formation_decision_id,actor_owner_id)
    VALUES(p_run_id,p_agenda_item_id,v_turn_id,p_resolution_state,p_classification,v_evidence_id,p_hypothesis_operation_id,v_decision_id,p_owner_id) RETURNING id INTO v_event_id;
  IF p_resolution_state='resolved' AND p_hypothesis_operation_id IS NOT NULL THEN
    INSERT INTO public.direct_hire_formation_agenda_resolution_events(run_id,agenda_item_id,owner_turn_id,resolution_state,answer_classification,evidence_id,hypothesis_operation_id,formation_decision_id,actor_owner_id)
    SELECT p_run_id,other.id,v_turn_id,'superseded_by_prior_answer',p_classification,v_evidence_id,p_hypothesis_operation_id,v_decision_id,p_owner_id
    FROM public.direct_hire_first_working_session_formation_agenda_items other WHERE other.formation_session_id=v_run.formation_session_id AND other.id<>p_agenda_item_id
      AND other.source_hypothesis_ids @> ARRAY[(SELECT op.hypothesis_id FROM public.hypothesis_owner_operations op WHERE op.operation_id=p_hypothesis_operation_id)]::uuid[]
      AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_agenda_resolution_events prior WHERE prior.run_id=p_run_id AND prior.agenda_item_id=other.id);
  END IF;
  SELECT item.* INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items item
  LEFT JOIN LATERAL(SELECT e.resolution_state FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=item.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
  WHERE item.formation_session_id=v_run.formation_session_id AND (latest.resolution_state IS NULL OR latest.resolution_state='still_unresolved') ORDER BY item.blocking DESC,item.rank LIMIT 1;
  v_next_text:=coalesce(v_next.suggested_wording,v_next.question_intent);
  IF v_next.id IS NULL THEN
    SELECT required.scope,required.key,required.question INTO v_required_scope,v_required_key,v_next_text FROM (VALUES
      (1,'authority','pricing','What pricing may Zeya discuss, and what requires owner approval?'),(2,'authority','negotiation','May Zeya negotiate, or must every negotiation be escalated?'),
      (3,'authority','promises_commitments','What promises or commitments are permitted or prohibited?'),(4,'authority','escalation','What exact escalation path should Zeya use?'),
      (5,'commercial','immediate_bd_goal','What is the immediate business-development objective?'),(6,'commercial','target_segment','Which target segment is in scope?'),
      (7,'commercial','qualification_threshold','What makes an opportunity qualified?'),(8,'commercial','meeting_objective','What should a first meeting achieve?')
    ) required(rank,scope,key,question) WHERE NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decisions d WHERE d.run_id=p_run_id
      AND public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key)=public.zeya_normalize_direct_hire_formation_decision_key(required.key)
      AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decision_supersessions supersession WHERE supersession.erroneous_decision_id=d.id)) ORDER BY required.rank LIMIT 1;
    v_next_semantic_key:=CASE v_required_key WHEN 'pricing' THEN 'authority_pricing' WHEN 'negotiation' THEN 'authority_negotiation' WHEN 'promises_commitments' THEN 'authority_customer_commitments'
      WHEN 'escalation' THEN 'authority_escalation_rules' WHEN 'target_segment' THEN 'primary_target_segment' ELSE v_required_key END;
    IF v_required_scope IS NOT NULL THEN
      SELECT * INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items WHERE formation_session_id=v_run.formation_session_id AND category=v_required_scope ORDER BY blocking DESC,rank LIMIT 1;
      IF v_next.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='required readiness agenda category missing'; END IF;
    END IF;
  END IF;
  IF v_next.id IS NULL AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_agenda_resolution_events e JOIN public.direct_hire_first_working_session_formation_agenda_items i ON i.id=e.agenda_item_id WHERE e.run_id=p_run_id AND i.blocking AND e.resolution_state IN ('deferred','still_unresolved')) THEN
    IF (SELECT count(DISTINCT ready.domain) FROM (
      SELECT item.constitutional_domain domain FROM public.direct_hire_first_working_session_formation_agenda_items item JOIN LATERAL(SELECT e.resolution_state FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=item.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
      WHERE item.formation_session_id=v_run.formation_session_id AND item.constitutional_domain IN ('whatYouSell','whoItIsFor') AND latest.resolution_state='resolved'
      UNION ALL SELECT h.constitutional_domain FROM public.hypotheses h JOIN LATERAL(SELECT v.decision FROM public.hypothesis_verifications v WHERE v.hypothesis_id=h.id ORDER BY v.verification_sequence DESC LIMIT 1) latest ON true
      WHERE h.owner_id=p_owner_id AND h.business_representation_id=v_run.business_representation_id AND h.constitutional_domain IN ('whatYouSell','whoItIsFor') AND h.epistemic_state='supported' AND latest.decision='approved' AND NOT EXISTS(SELECT 1 FROM public.hypotheses successor WHERE successor.previous_hypothesis_id=h.id)
    ) ready)<>2 THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='offer and target readiness remain unresolved'; END IF;
    v_complete:=true; UPDATE public.direct_hire_formation_conversation_runs SET status='completed',completed_at=now(),updated_at=now() WHERE id=p_run_id;
    UPDATE public.direct_hire_working_sessions SET status='completed',updated_at=now() WHERE id=v_run.direct_hire_working_session_id AND status='scheduled';
  ELSE
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
    INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,governed_semantic_key)
    VALUES(p_run_id,v_sequence,v_next.id,'zeya',CASE WHEN v_next.id=p_agenda_item_id AND v_required_scope IS NULL THEN 'I need one clearer boundary before we move on: '||v_next.question_intent ELSE v_next_text END,CASE WHEN v_next.id=p_agenda_item_id THEN 'follow_up_question' ELSE 'primary_question' END,v_next_semantic_key);
  END IF;
  RETURN QUERY SELECT v_turn_id,v_event_id,false,v_complete;
END; $$;

CREATE FUNCTION public.zeya_reissue_direct_hire_readiness_question(p_owner_id uuid,p_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_latest public.direct_hire_formation_conversation_turns%ROWTYPE;
  v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE; v_readiness jsonb; v_missing text; v_key text; v_question text; v_sequence integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status<>'active' THEN RETURN false; END IF;
  SELECT * INTO v_latest FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id AND speaker='zeya' ORDER BY sequence DESC LIMIT 1;
  IF v_latest.id IS NULL OR v_latest.governed_semantic_key IS NOT NULL OR v_latest.turn_type<>'follow_up_question' THEN RETURN false; END IF;
  SELECT * INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE id=v_latest.agenda_item_id;
  v_readiness:=public.zeya_direct_hire_formation_readiness(p_run_id);
  SELECT category,key,question INTO v_missing,v_key,v_question FROM (VALUES
    ('pricing_authority','authority_pricing','What pricing may Zeya discuss, and what requires owner approval?'),
    ('negotiation_authority','authority_negotiation','May Zeya negotiate, or must negotiation be escalated?'),
    ('commitment_authority','authority_customer_commitments','Which promises or commitments are permitted, approval-gated, or prohibited?'),
    ('meeting_booking_authority','authority_meeting_booking','May Zeya book a qualified meeting directly, or is owner approval required?'),
    ('escalation_owner_approval','authority_escalation_rules','What exact escalation and owner-approval rule must Zeya follow?')
  ) missing(category,key,question) WHERE v_item.category='authority' AND v_readiness#>>ARRAY['categories',category,'state']<>'satisfied'
  ORDER BY array_position(ARRAY['pricing_authority','negotiation_authority','commitment_authority','meeting_booking_authority','escalation_owner_approval'],category) LIMIT 1;
  IF v_key IS NULL THEN RETURN false; END IF;
  SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
  INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,governed_semantic_key)
  VALUES(p_run_id,v_sequence,v_latest.agenda_item_id,'zeya',v_question,'primary_question',v_key);
  RETURN true;
END; $$;

ALTER FUNCTION public.zeya_set_direct_hire_question_semantic_key() OWNER TO postgres;
ALTER FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions() OWNER TO postgres;
ALTER FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_reissue_direct_hire_readiness_question(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_set_direct_hire_question_semantic_key(),public.zeya_reissue_direct_hire_readiness_question(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_reissue_direct_hire_readiness_question(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
