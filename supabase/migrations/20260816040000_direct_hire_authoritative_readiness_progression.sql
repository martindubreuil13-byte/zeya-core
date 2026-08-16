BEGIN;

CREATE FUNCTION public.zeya_direct_hire_first_missing_readiness_requirement(p_run_id uuid)
RETURNS TABLE(readiness_category text,question text,governed_semantic_key text,agenda_category text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH readiness AS (
    SELECT public.zeya_direct_hire_formation_readiness(p_run_id) value
  ), prompts AS (
    SELECT * FROM (VALUES
      (1,'offer','Please establish the offer clearly enough for a truthful introduction.',NULL::text,NULL::text),
      (2,'target','Who is the primary target for initial outreach?','primary_target_segment','commercial'),
      (3,'immediate_bd_objective','What is the immediate business-development objective?','immediate_bd_goal','commercial'),
      (4,'qualification','What makes an opportunity qualified?','qualification_threshold','commercial'),
      (5,'meeting_objective','What should a first meeting achieve?','meeting_objective','commercial'),
      (6,'pricing_authority','What pricing may Zeya discuss, and what requires owner approval?','authority_pricing','authority'),
      (7,'negotiation_authority','May Zeya negotiate, or must negotiation be escalated?','authority_negotiation','authority'),
      (8,'commitment_authority','Which promises or commitments are permitted, approval-gated, or prohibited?','authority_customer_commitments','authority'),
      (9,'meeting_booking_authority','May Zeya book a qualified meeting directly, or is owner approval required?','authority_meeting_booking','authority'),
      (10,'escalation_owner_approval','What exact escalation and owner-approval rule must Zeya follow?','authority_escalation_rules','authority'),
      (11,'blocking_contradictions','A high-risk contradiction must be resolved before completion.',NULL::text,'contradiction')
    ) value(priority,category,question,semantic_key,scope)
  )
  SELECT prompts.category,prompts.question,prompts.semantic_key,prompts.scope
  FROM prompts,readiness
  WHERE readiness.value#>>ARRAY['categories',prompts.category,'state']<>'satisfied'
  ORDER BY prompts.priority
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.zeya_gate_direct_hire_formation_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_readiness jsonb; v_missing text; v_item uuid; v_question text; v_semantic_key text; v_agenda_category text; v_sequence integer;
BEGIN
  IF NEW.status<>'completed' OR OLD.status='completed' THEN RETURN NEW; END IF;
  v_readiness:=public.zeya_direct_hire_formation_readiness(NEW.id);
  IF NOT (v_readiness->>'ready')::boolean THEN
    SELECT requirement.readiness_category,requirement.question,requirement.governed_semantic_key,requirement.agenda_category
    INTO v_missing,v_question,v_semantic_key,v_agenda_category
    FROM public.zeya_direct_hire_first_missing_readiness_requirement(NEW.id) requirement;
    IF v_missing IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='readiness requirement mapping missing'; END IF;
    SELECT id INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items
    WHERE formation_session_id=NEW.formation_session_id
    ORDER BY (v_agenda_category IS NOT NULL AND category=v_agenda_category) DESC,blocking DESC,rank LIMIT 1;
    IF v_item IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='required readiness agenda category missing'; END IF;
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id;
    IF NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id AND speaker='zeya' AND governed_semantic_key IS NOT DISTINCT FROM v_semantic_key AND owner_safe_text=v_question) THEN
      INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,governed_semantic_key)
      VALUES(NEW.id,v_sequence,v_item,'zeya',v_question,'primary_question',v_semantic_key);
    END IF;
    RETURN OLD;
  END IF;
  NEW.completion_contract_version:='direct-hire-telephone-bd-readiness-v1';
  NEW.completion_readiness_result:=v_readiness;
  NEW.completion_source_state_fingerprint:=public.zeya_direct_hire_formation_source_state_fingerprint(NEW.id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.zeya_record_direct_hire_formation_answer(
  p_owner_id uuid,p_run_id uuid,p_agenda_item_id uuid,p_idempotency_key uuid,p_owner_text text,
  p_classification text,p_resolution_state text,p_decision_key text DEFAULT NULL,p_decision_value jsonb DEFAULT NULL,
  p_hypothesis_operation_id uuid DEFAULT NULL
) RETURNS TABLE(owner_turn_id uuid,resolution_event_id uuid,replayed boolean,complete boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE;
  v_existing public.direct_hire_formation_conversation_turns%ROWTYPE; v_turn_id uuid; v_event_id uuid; v_evidence_id uuid; v_decision_id uuid;
  v_sequence integer; v_followups integer; v_next public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE; v_complete boolean:=false;
  v_next_text text; v_required_scope text; v_missing_category text; v_next_semantic_key text; v_readiness jsonb;
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
  v_readiness:=public.zeya_direct_hire_formation_readiness(p_run_id);
  IF v_next.id IS NULL AND NOT (v_readiness->>'ready')::boolean THEN
    SELECT requirement.readiness_category,requirement.question,requirement.governed_semantic_key,requirement.agenda_category
    INTO v_missing_category,v_next_text,v_next_semantic_key,v_required_scope
    FROM public.zeya_direct_hire_first_missing_readiness_requirement(p_run_id) requirement;
    IF v_missing_category IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='readiness requirement mapping missing'; END IF;
    SELECT * INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items
    WHERE formation_session_id=v_run.formation_session_id
    ORDER BY (v_required_scope IS NOT NULL AND category=v_required_scope) DESC,blocking DESC,rank LIMIT 1;
    IF v_next.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='required readiness agenda category missing'; END IF;
  END IF;
  IF v_next.id IS NULL AND (v_readiness->>'ready')::boolean THEN
    v_complete:=true;
    UPDATE public.direct_hire_formation_conversation_runs SET status='completed',completed_at=now(),updated_at=now() WHERE id=p_run_id;
    UPDATE public.direct_hire_working_sessions SET status='completed',updated_at=now() WHERE id=v_run.direct_hire_working_session_id AND status='scheduled';
  ELSE
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
    INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,governed_semantic_key)
    VALUES(p_run_id,v_sequence,v_next.id,'zeya',CASE WHEN v_next.id=p_agenda_item_id AND v_required_scope IS NULL THEN 'I need one clearer boundary before we move on: '||v_next.question_intent ELSE v_next_text END,CASE WHEN v_next.id=p_agenda_item_id AND v_required_scope IS NULL THEN 'follow_up_question' ELSE 'primary_question' END,v_next_semantic_key);
  END IF;
  RETURN QUERY SELECT v_turn_id,v_event_id,false,v_complete;
END; $$;

ALTER FUNCTION public.zeya_direct_hire_first_missing_readiness_requirement(uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_gate_direct_hire_formation_completion() OWNER TO postgres;
ALTER FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_direct_hire_first_missing_readiness_requirement(uuid),public.zeya_gate_direct_hire_formation_completion() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
