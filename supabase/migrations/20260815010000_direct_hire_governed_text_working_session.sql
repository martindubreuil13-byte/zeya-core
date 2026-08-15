BEGIN;

CREATE TABLE public.direct_hire_formation_conversation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  formation_handoff_id uuid NOT NULL REFERENCES public.direct_hire_first_working_session_formation_handoffs(id) ON DELETE RESTRICT,
  direct_hire_working_session_id uuid NOT NULL REFERENCES public.direct_hire_working_sessions(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  preparation_snapshot_fingerprint text NOT NULL,
  hypothesis_trace_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','paused','completed','abandoned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (formation_session_id, id)
);

CREATE UNIQUE INDEX direct_hire_formation_one_open_run
  ON public.direct_hire_formation_conversation_runs (formation_session_id)
  WHERE status IN ('active','paused');

CREATE TABLE public.direct_hire_formation_conversation_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  agenda_item_id uuid NOT NULL REFERENCES public.direct_hire_first_working_session_formation_agenda_items(id) ON DELETE RESTRICT,
  speaker text NOT NULL CHECK (speaker IN ('zeya','owner')),
  owner_safe_text text NOT NULL CHECK (char_length(btrim(owner_safe_text)) BETWEEN 1 AND 4000),
  turn_type text NOT NULL CHECK (turn_type IN ('primary_question','follow_up_question','owner_answer','completion')),
  idempotency_key uuid,
  resolution_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, idempotency_key),
  CHECK ((speaker = 'owner') = (idempotency_key IS NOT NULL))
);

CREATE TABLE public.direct_hire_formation_agenda_resolution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  agenda_item_id uuid NOT NULL REFERENCES public.direct_hire_first_working_session_formation_agenda_items(id) ON DELETE RESTRICT,
  owner_turn_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_turns(id) ON DELETE RESTRICT,
  resolution_state text NOT NULL CHECK (resolution_state IN ('resolved','deferred','still_unresolved','superseded_by_prior_answer')),
  answer_classification text NOT NULL CHECK (answer_classification IN ('confirm','correct','authority_grant','authority_restriction','commercial_decision','defer','unclear','nonresponsive')),
  evidence_id uuid REFERENCES public.evidence(id) ON DELETE RESTRICT,
  hypothesis_operation_id uuid REFERENCES public.hypothesis_owner_operations(operation_id) ON DELETE RESTRICT,
  formation_decision_id uuid,
  actor_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.direct_hire_formation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  source_agenda_item_id uuid NOT NULL REFERENCES public.direct_hire_first_working_session_formation_agenda_items(id) ON DELETE RESTRICT,
  source_owner_turn_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_conversation_turns(id) ON DELETE RESTRICT,
  source_owner_evidence_id uuid NOT NULL REFERENCES public.evidence(id) ON DELETE RESTRICT,
  decision_scope text NOT NULL CHECK (decision_scope IN ('authority','commercial')),
  decision_key text NOT NULL CHECK (decision_key IN ('pricing','discounts','negotiation','promises_commitments','meeting_booking','owner_approval_required','escalation','prohibited_claims','immediate_bd_goal','target_segment','qualification_threshold','meeting_objective','geography_exclusions','owner_availability_escalation')),
  disposition text NOT NULL CHECK (disposition IN ('granted','restricted','decided')),
  decision_value jsonb NOT NULL CHECK (jsonb_typeof(decision_value) = 'object'),
  noncanonical boolean NOT NULL CHECK (noncanonical),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.direct_hire_formation_agenda_resolution_events
  ADD CONSTRAINT direct_hire_resolution_decision_fk FOREIGN KEY (formation_decision_id)
  REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT;
ALTER TABLE public.direct_hire_formation_conversation_turns
  ADD CONSTRAINT direct_hire_turn_resolution_fk FOREIGN KEY (resolution_event_id)
  REFERENCES public.direct_hire_formation_agenda_resolution_events(id) ON DELETE RESTRICT;

ALTER TABLE public.direct_hire_formation_conversation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_hire_formation_conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_hire_formation_agenda_resolution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_hire_formation_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_formation_conversation_runs, public.direct_hire_formation_conversation_turns,
  public.direct_hire_formation_agenda_resolution_events, public.direct_hire_formation_decisions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.direct_hire_formation_conversation_runs, public.direct_hire_formation_conversation_turns,
  public.direct_hire_formation_agenda_resolution_events, public.direct_hire_formation_decisions TO service_role;

CREATE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Formation conversation history is append-only';
END;
$$;
CREATE TRIGGER direct_hire_formation_turns_immutable BEFORE UPDATE OR DELETE ON public.direct_hire_formation_conversation_turns
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();
CREATE TRIGGER direct_hire_formation_resolutions_immutable BEFORE UPDATE OR DELETE ON public.direct_hire_formation_agenda_resolution_events
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();
CREATE TRIGGER direct_hire_formation_decisions_immutable BEFORE UPDATE OR DELETE ON public.direct_hire_formation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();

-- Owner-facing routes use a service client and pass the authenticated owner explicitly.
-- The RPC locks the exact Formation row, validates frozen handoff lineage, and is idempotent.
CREATE FUNCTION public.zeya_start_or_resume_direct_hire_formation_conversation(p_owner_id uuid, p_formation_session_id uuid)
RETURNS TABLE (run_id uuid, run_status text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_formation public.representation_formation_sessions%ROWTYPE; v_handoff public.direct_hire_first_working_session_formation_handoffs%ROWTYPE; v_run public.direct_hire_formation_conversation_runs%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized'; END IF;
  SELECT * INTO v_formation FROM public.representation_formation_sessions WHERE id=p_formation_session_id AND owner_id=p_owner_id FOR UPDATE;
  SELECT * INTO v_handoff FROM public.direct_hire_first_working_session_formation_handoffs WHERE formation_session_id=p_formation_session_id AND owner_id=p_owner_id;
  IF v_formation.id IS NULL OR v_handoff.id IS NULL OR v_formation.status NOT IN ('initiated','getting_familiar','working_conversation_pending')
    OR NOT EXISTS (SELECT 1 FROM public.direct_hire_working_sessions w WHERE w.id=v_handoff.direct_hire_working_session_id AND w.formation_session_id=v_formation.id AND w.owner_id=p_owner_id AND w.preparation_status='ready' AND w.preparation_contract_version='first-working-session-preparation-v4')
    OR NOT EXISTS (SELECT 1 FROM public.business_representations r WHERE r.id=v_handoff.business_representation_id AND r.user_id=p_owner_id AND r.current_version_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.representation_proposals p WHERE p.formation_session_id=v_formation.id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='Formation conversation lineage is not eligible';
  END IF;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE formation_session_id=v_formation.id AND status IN ('active','paused') FOR UPDATE;
  IF v_run.id IS NOT NULL THEN
    IF v_run.status='paused' THEN UPDATE public.direct_hire_formation_conversation_runs SET status='active',paused_at=NULL,updated_at=now() WHERE id=v_run.id; END IF;
    RETURN QUERY SELECT v_run.id,'active'::text,false; RETURN;
  END IF;
  INSERT INTO public.direct_hire_formation_conversation_runs(formation_session_id,formation_handoff_id,direct_hire_working_session_id,owner_id,business_id,business_representation_id,preparation_snapshot_fingerprint,hypothesis_trace_fingerprint,status)
  VALUES(v_formation.id,v_handoff.id,v_handoff.direct_hire_working_session_id,p_owner_id,v_handoff.business_id,v_handoff.business_representation_id,v_handoff.preparation_snapshot_fingerprint,v_handoff.hypothesis_trace_fingerprint,'active') RETURNING * INTO v_run;
  UPDATE public.representation_formation_sessions SET status='working_conversation_pending',updated_at=now() WHERE id=v_formation.id;
  INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type)
  SELECT v_run.id,1,item.id,'zeya',coalesce(item.suggested_wording,item.question_intent),'primary_question'
  FROM public.direct_hire_first_working_session_formation_agenda_items item
  WHERE item.formation_session_id=v_formation.id ORDER BY item.blocking DESC,item.rank LIMIT 1;
  RETURN QUERY SELECT v_run.id,v_run.status,true;
END; $$;

CREATE FUNCTION public.zeya_pause_direct_hire_formation_conversation(p_owner_id uuid,p_run_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  UPDATE public.direct_hire_formation_conversation_runs SET status='paused',paused_at=now(),updated_at=now()
  WHERE id=p_run_id AND owner_id=p_owner_id AND status='active';
  IF FOUND THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id AND owner_id=p_owner_id AND status='paused') THEN RETURN false; END IF;
  RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation cannot be paused';
END; $$;

CREATE FUNCTION public.zeya_record_direct_hire_formation_answer(
  p_owner_id uuid,p_run_id uuid,p_agenda_item_id uuid,p_idempotency_key uuid,p_owner_text text,
  p_classification text,p_resolution_state text,p_decision_key text DEFAULT NULL,p_decision_value jsonb DEFAULT NULL,
  p_hypothesis_operation_id uuid DEFAULT NULL
) RETURNS TABLE(owner_turn_id uuid,resolution_event_id uuid,replayed boolean,complete boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE;
  v_existing public.direct_hire_formation_conversation_turns%ROWTYPE; v_turn_id uuid; v_event_id uuid; v_evidence_id uuid; v_decision_id uuid;
  v_sequence integer; v_followups integer; v_next public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE; v_complete boolean:=false; v_next_text text; v_required_scope text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_owner_id IS NULL OR p_run_id IS NULL OR p_agenda_item_id IS NULL OR p_idempotency_key IS NULL
    OR char_length(btrim(coalesce(p_owner_text,''))) NOT BETWEEN 1 AND 4000
    OR p_classification NOT IN ('confirm','correct','authority_grant','authority_restriction','commercial_decision','defer','unclear','nonresponsive')
    OR p_resolution_state NOT IN ('resolved','deferred','still_unresolved','superseded_by_prior_answer') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid conversation answer'; END IF;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.status<>'active' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation is not active'; END IF;
  SELECT * INTO v_existing FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id AND idempotency_key=p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.agenda_item_id IS DISTINCT FROM p_agenda_item_id OR v_existing.owner_safe_text IS DISTINCT FROM btrim(p_owner_text) THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='answer idempotency conflict'; END IF;
    SELECT id INTO v_event_id FROM public.direct_hire_formation_agenda_resolution_events WHERE owner_turn_id=v_existing.id;
    RETURN QUERY SELECT v_existing.id,v_event_id,true,v_run.status='completed'; RETURN;
  END IF;
  SELECT * INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE id=p_agenda_item_id AND formation_session_id=v_run.formation_session_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='agenda item not found'; END IF;
  SELECT count(*) INTO v_followups FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=p_agenda_item_id AND e.resolution_state='still_unresolved';
  IF p_resolution_state='still_unresolved' AND v_followups>=1 THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded follow-up exhausted'; END IF;
  IF p_classification IN ('confirm','correct','defer') AND cardinality(v_item.source_hypothesis_ids)>0 THEN
    IF p_hypothesis_operation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.hypothesis_owner_operations op WHERE op.operation_id=p_hypothesis_operation_id AND op.owner_id=p_owner_id AND op.hypothesis_id=ANY(v_item.source_hypothesis_ids)
      AND op.decision=CASE p_classification WHEN 'confirm' THEN 'approved'::public.approval_decision_type WHEN 'correct' THEN 'rejected'::public.approval_decision_type ELSE 'deferred'::public.approval_decision_type END) THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed hypothesis operation required'; END IF;
  END IF;
  SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
  INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,idempotency_key)
    VALUES(p_run_id,v_sequence,p_agenda_item_id,'owner',btrim(p_owner_text),'owner_answer',p_idempotency_key) RETURNING id INTO v_turn_id;
  IF p_classification IN ('authority_grant','authority_restriction','commercial_decision') THEN
    INSERT INTO public.evidence(business_representation_id,direct_hire_onboarding_session_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)
    SELECT v_run.business_representation_id,h.direct_hire_onboarding_session_id,'manual'::public.evidence_source_type,'Owner answer in governed Formation text session',btrim(p_owner_text),
      ARRAY[coalesce(v_item.constitutional_domain,CASE WHEN v_item.category='authority' THEN 'authorityBoundaries' ELSE 'clarificationsNeeded' END)]::text[],'owner:'||p_owner_id::text
    FROM public.direct_hire_first_working_session_formation_handoffs h WHERE h.id=v_run.formation_handoff_id RETURNING id INTO v_evidence_id;
    IF p_decision_key IS NULL OR p_decision_value IS NULL OR jsonb_typeof(p_decision_value)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='structured Formation decision required'; END IF;
    INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
    VALUES(v_run.formation_session_id,p_run_id,p_agenda_item_id,v_turn_id,v_evidence_id,CASE WHEN p_classification LIKE 'authority_%' THEN 'authority' ELSE 'commercial' END,p_decision_key,
      CASE p_classification WHEN 'authority_grant' THEN 'granted' WHEN 'authority_restriction' THEN 'restricted' ELSE 'decided' END,p_decision_value,true) RETURNING id INTO v_decision_id;
  END IF;
  INSERT INTO public.direct_hire_formation_agenda_resolution_events(run_id,agenda_item_id,owner_turn_id,resolution_state,answer_classification,evidence_id,hypothesis_operation_id,formation_decision_id,actor_owner_id)
    VALUES(p_run_id,p_agenda_item_id,v_turn_id,p_resolution_state,p_classification,v_evidence_id,p_hypothesis_operation_id,v_decision_id,p_owner_id) RETURNING id INTO v_event_id;
  -- A governed hypothesis operation can make another agenda occurrence of the
  -- same hypothesis redundant. Preserve both immutable agenda rows and append
  -- an explicit derived event instead of silently skipping provenance.
  IF p_resolution_state='resolved' AND p_hypothesis_operation_id IS NOT NULL THEN
    INSERT INTO public.direct_hire_formation_agenda_resolution_events(run_id,agenda_item_id,owner_turn_id,resolution_state,answer_classification,evidence_id,hypothesis_operation_id,formation_decision_id,actor_owner_id)
    SELECT p_run_id,other.id,v_turn_id,'superseded_by_prior_answer',p_classification,v_evidence_id,p_hypothesis_operation_id,v_decision_id,p_owner_id
    FROM public.direct_hire_first_working_session_formation_agenda_items other
    WHERE other.formation_session_id=v_run.formation_session_id AND other.id<>p_agenda_item_id
      AND other.source_hypothesis_ids @> ARRAY[(SELECT op.hypothesis_id FROM public.hypothesis_owner_operations op WHERE op.operation_id=p_hypothesis_operation_id)]::uuid[]
      AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_agenda_resolution_events prior WHERE prior.run_id=p_run_id AND prior.agenda_item_id=other.id);
  END IF;
  SELECT item.* INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items item
  LEFT JOIN LATERAL(SELECT e.resolution_state FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=item.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
  WHERE item.formation_session_id=v_run.formation_session_id AND (latest.resolution_state IS NULL OR latest.resolution_state='still_unresolved')
  ORDER BY item.blocking DESC,item.rank LIMIT 1;
  v_next_text:=coalesce(v_next.suggested_wording,v_next.question_intent);
  IF v_next.id IS NULL THEN
    SELECT required.scope,required.question INTO v_required_scope,v_next_text
    FROM (VALUES
      (1,'authority','pricing','What pricing may Zeya discuss, and what requires owner approval?'),
      (2,'authority','negotiation','May Zeya negotiate, or must every negotiation be escalated?'),
      (3,'authority','promises_commitments','What promises or commitments are permitted or prohibited?'),
      (4,'authority','escalation','What exact escalation path should Zeya use?'),
      (5,'commercial','immediate_bd_goal','What is the immediate business-development objective?'),
      (6,'commercial','target_segment','Which target segment is in scope?'),
      (7,'commercial','qualification_threshold','What makes an opportunity qualified?'),
      (8,'commercial','meeting_objective','What should a first meeting achieve?')
    ) AS required(rank,scope,key,question)
    WHERE NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decisions d WHERE d.run_id=p_run_id AND d.decision_key=required.key)
    ORDER BY required.rank LIMIT 1;
    IF v_required_scope IS NOT NULL THEN
      SELECT * INTO v_next FROM public.direct_hire_first_working_session_formation_agenda_items
      WHERE formation_session_id=v_run.formation_session_id AND category=v_required_scope
      ORDER BY blocking DESC,rank LIMIT 1;
      IF v_next.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='required readiness agenda category missing'; END IF;
    END IF;
  END IF;
  IF v_next.id IS NULL AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_agenda_resolution_events e JOIN public.direct_hire_first_working_session_formation_agenda_items i ON i.id=e.agenda_item_id WHERE e.run_id=p_run_id AND i.blocking AND e.resolution_state IN ('deferred','still_unresolved')) THEN
    IF (SELECT count(DISTINCT ready.domain) FROM (
      SELECT item.constitutional_domain AS domain
      FROM public.direct_hire_first_working_session_formation_agenda_items item
      JOIN LATERAL(SELECT e.resolution_state FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id AND e.agenda_item_id=item.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
      WHERE item.formation_session_id=v_run.formation_session_id AND item.constitutional_domain IN ('whatYouSell','whoItIsFor') AND latest.resolution_state='resolved'
      UNION ALL
      SELECT h.constitutional_domain FROM public.hypotheses h
      JOIN LATERAL(SELECT v.decision FROM public.hypothesis_verifications v WHERE v.hypothesis_id=h.id ORDER BY v.verification_sequence DESC LIMIT 1) latest ON true
      WHERE h.owner_id=p_owner_id AND h.business_representation_id=v_run.business_representation_id AND h.constitutional_domain IN ('whatYouSell','whoItIsFor')
        AND h.epistemic_state='supported' AND latest.decision='approved' AND NOT EXISTS(SELECT 1 FROM public.hypotheses successor WHERE successor.previous_hypothesis_id=h.id)
    ) ready)<>2 THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='offer and target readiness remain unresolved';
    END IF;
    v_complete:=true; UPDATE public.direct_hire_formation_conversation_runs SET status='completed',completed_at=now(),updated_at=now() WHERE id=p_run_id;
    UPDATE public.direct_hire_working_sessions SET status='completed',updated_at=now() WHERE id=v_run.direct_hire_working_session_id AND status='scheduled';
  ELSE
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=p_run_id;
    INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type)
      VALUES(p_run_id,v_sequence,v_next.id,'zeya',CASE WHEN v_next.id=p_agenda_item_id AND v_required_scope IS NULL THEN 'I need one clearer boundary before we move on: '||v_next.question_intent ELSE v_next_text END,
      CASE WHEN v_next.id=p_agenda_item_id THEN 'follow_up_question' ELSE 'primary_question' END);
  END IF;
  RETURN QUERY SELECT v_turn_id,v_event_id,false,v_complete;
END; $$;

ALTER TABLE public.direct_hire_formation_conversation_runs OWNER TO postgres;
ALTER TABLE public.direct_hire_formation_conversation_turns OWNER TO postgres;
ALTER TABLE public.direct_hire_formation_agenda_resolution_events OWNER TO postgres;
ALTER TABLE public.direct_hire_formation_decisions OWNER TO postgres;
ALTER FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification() OWNER TO postgres;
ALTER FUNCTION public.zeya_start_or_resume_direct_hire_formation_conversation(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_pause_direct_hire_formation_conversation(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_start_or_resume_direct_hire_formation_conversation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_pause_direct_hire_formation_conversation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_start_or_resume_direct_hire_formation_conversation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_pause_direct_hire_formation_conversation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_record_direct_hire_formation_answer(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
