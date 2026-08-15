BEGIN;

ALTER TABLE public.direct_hire_formation_conversation_turns
  ADD COLUMN governed_semantic_key text CHECK (governed_semantic_key IS NULL OR governed_semantic_key IN (
    'primary_target_segment','immediate_bd_goal','qualification_threshold','meeting_objective','geography','explicit_exclusions',
    'authority_pricing','authority_discounts','authority_negotiation','authority_customer_commitments','authority_meeting_booking',
    'authority_owner_approval_required','authority_escalation_rules','authority_prohibited_claims'
  ));

CREATE TABLE public.direct_hire_formation_decision_supersessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  conversation_run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  erroneous_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  replacement_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason='corrected_application_semantic_mapping'),
  corrected_by_actor text NOT NULL CHECK (corrected_by_actor='service_role'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (erroneous_decision_id<>replacement_decision_id)
);
ALTER TABLE public.direct_hire_formation_decision_supersessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_formation_decision_supersessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.direct_hire_formation_decision_supersessions TO service_role;
CREATE TRIGGER direct_hire_formation_decision_supersessions_immutable BEFORE UPDATE OR DELETE ON public.direct_hire_formation_decision_supersessions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();

CREATE FUNCTION public.zeya_reclassify_direct_hire_formation_decision(
  p_owner_id uuid,p_erroneous_decision_id uuid,p_expected_agenda_item_id uuid,p_corrected_decision_key text,
  p_reason text
) RETURNS TABLE(supersession_id uuid,replacement_decision_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bad public.direct_hire_formation_decisions%ROWTYPE; v_run public.direct_hire_formation_conversation_runs%ROWTYPE;
  v_existing public.direct_hire_formation_decision_supersessions%ROWTYPE; v_replacement uuid; v_supersession uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_reason IS DISTINCT FROM 'corrected_application_semantic_mapping' OR p_corrected_decision_key IS DISTINCT FROM 'primary_target_segment' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid semantic recovery request'; END IF;
  SELECT * INTO v_bad FROM public.direct_hire_formation_decisions WHERE id=p_erroneous_decision_id FOR UPDATE;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=v_bad.run_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_bad.id IS NULL OR v_run.id IS NULL OR v_run.status NOT IN ('active','paused') OR v_bad.decision_scope<>'commercial'
    OR v_bad.decision_key<>'immediate_bd_goal' OR v_bad.source_agenda_item_id IS DISTINCT FROM p_expected_agenda_item_id
    OR NOT EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items agenda WHERE agenda.id=v_bad.source_agenda_item_id
      AND agenda.formation_session_id=v_bad.formation_session_id AND agenda.constitutional_domain='whoItIsFor')
    OR EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_run.id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='decision is not eligible for semantic recovery'; END IF;
  SELECT * INTO v_existing FROM public.direct_hire_formation_decision_supersessions WHERE erroneous_decision_id=v_bad.id;
  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing.id,v_existing.replacement_decision_id,true; RETURN;
  END IF;
  INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
  VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.source_agenda_item_id,v_bad.source_owner_turn_id,v_bad.source_owner_evidence_id,'commercial','primary_target_segment','decided',v_bad.decision_value,true)
  RETURNING id INTO v_replacement;
  INSERT INTO public.direct_hire_formation_decision_supersessions(formation_session_id,conversation_run_id,erroneous_decision_id,replacement_decision_id,reason,corrected_by_actor)
  VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.id,v_replacement,p_reason,'service_role') RETURNING id INTO v_supersession;
  RETURN QUERY SELECT v_supersession,v_replacement,false;
END; $$;

CREATE OR REPLACE FUNCTION public.zeya_direct_hire_formation_readiness(p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH run AS (SELECT * FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id),
  latest_events AS (
    SELECT DISTINCT ON (e.agenda_item_id) e.* FROM public.direct_hire_formation_agenda_resolution_events e
    WHERE e.run_id=p_run_id ORDER BY e.agenda_item_id,e.created_at DESC,e.id DESC
  ), normalized_decisions AS (
    SELECT DISTINCT ON (derived.normalized_key) derived.* FROM (
      SELECT d.*,public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key) normalized_key,
        CASE WHEN d.decision_scope='authority' THEN public.zeya_normalize_direct_hire_authority_disposition(d.disposition,d.decision_value->>'statement') ELSE 'decided' END normalized_disposition,
        (d.decision_key LIKE 'authority\_%' ESCAPE '\' OR d.decision_key='primary_target_segment') exact_key
      FROM public.direct_hire_formation_decisions d WHERE d.run_id=p_run_id
        AND NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decision_supersessions supersession WHERE supersession.erroneous_decision_id=d.id)
    ) derived ORDER BY derived.normalized_key,derived.exact_key DESC,derived.created_at DESC,derived.id DESC
  ), states AS (
    SELECT key,satisfied,blocked,sources FROM (VALUES
      ('offer',EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.constitutional_domain='whatYouSell' AND e.resolution_state IN ('resolved','superseded_by_prior_answer')),false,coalesce((SELECT jsonb_agg(e.id ORDER BY e.id) FROM public.direct_hire_first_working_session_formation_agenda_items a JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.constitutional_domain='whatYouSell' AND e.resolution_state IN ('resolved','superseded_by_prior_answer')),'[]'::jsonb)),
      ('target',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='primary_target_segment'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='primary_target_segment'),'[]'::jsonb)),
      ('immediate_bd_objective',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='immediate_bd_goal'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='immediate_bd_goal'),'[]'::jsonb)),
      ('qualification',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='qualification_threshold'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='qualification_threshold'),'[]'::jsonb)),
      ('meeting_objective',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='meeting_objective'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='commercial' AND normalized_key='meeting_objective'),'[]'::jsonb)),
      ('pricing_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_pricing' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_pricing' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('negotiation_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_negotiation' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_negotiation' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('commitment_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_customer_commitments' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_customer_commitments' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('meeting_booking_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_meeting_booking' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key='authority_meeting_booking' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('escalation_owner_approval',EXISTS(SELECT 1 FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key IN ('authority_escalation_rules','authority_owner_approval_required') AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE decision_scope='authority' AND normalized_key IN ('authority_escalation_rules','authority_owner_approval_required') AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('blocking_contradictions',NOT EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),coalesce((SELECT jsonb_agg(a.id ORDER BY a.id) FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),'[]'::jsonb))
    ) value(key,satisfied,blocked,sources)
  ) SELECT jsonb_build_object('contractVersion','direct-hire-telephone-bd-readiness-v1','ready',bool_and(satisfied AND NOT blocked),'categories',jsonb_object_agg(key,jsonb_build_object('state',CASE WHEN blocked THEN 'blocked' WHEN satisfied THEN 'satisfied' ELSE 'unresolved' END,'sourceIds',sources) ORDER BY key)) FROM states
$$;

CREATE OR REPLACE FUNCTION public.zeya_gate_direct_hire_formation_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_readiness jsonb; v_missing text; v_item uuid; v_question text; v_semantic_key text; v_sequence integer;
BEGIN
  IF NEW.status<>'completed' OR OLD.status='completed' THEN RETURN NEW; END IF;
  v_readiness:=public.zeya_direct_hire_formation_readiness(NEW.id);
  IF NOT (v_readiness->>'ready')::boolean THEN
    SELECT key INTO v_missing FROM jsonb_each(v_readiness->'categories') WHERE value->>'state'<>'satisfied'
      ORDER BY array_position(ARRAY['offer','target','immediate_bd_objective','qualification','meeting_objective','pricing_authority','negotiation_authority','commitment_authority','meeting_booking_authority','escalation_owner_approval','blocking_contradictions'],key) LIMIT 1;
    SELECT question,semantic_key INTO v_question,v_semantic_key FROM (VALUES
      ('offer','Please establish the offer clearly enough for a truthful introduction.',NULL::text),
      ('target','Who is the primary target for initial outreach?','primary_target_segment'),
      ('immediate_bd_objective','What is the immediate business-development objective?','immediate_bd_goal'),
      ('qualification','What makes an opportunity qualified?','qualification_threshold'),
      ('meeting_objective','What should a first meeting achieve?','meeting_objective'),
      ('pricing_authority','What pricing may Zeya discuss, and what requires owner approval?','authority_pricing'),
      ('negotiation_authority','May Zeya negotiate, or must negotiation be escalated?','authority_negotiation'),
      ('commitment_authority','Which promises or commitments are permitted, approval-gated, or prohibited?','authority_customer_commitments'),
      ('meeting_booking_authority','May Zeya book a qualified meeting directly, or is owner approval required?','authority_meeting_booking'),
      ('escalation_owner_approval','What exact escalation and owner-approval rule must Zeya follow?','authority_escalation_rules'),
      ('blocking_contradictions','A high-risk contradiction must be resolved before completion.',NULL::text)
    ) prompt(category,question,semantic_key) WHERE category=v_missing;
    SELECT id INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE formation_session_id=NEW.formation_session_id
      ORDER BY (category=CASE WHEN v_missing IN ('pricing_authority','negotiation_authority','commitment_authority','meeting_booking_authority','escalation_owner_approval') THEN 'authority' ELSE 'commercial' END) DESC,blocking DESC,rank LIMIT 1;
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id;
    IF NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id AND speaker='zeya' AND governed_semantic_key IS NOT DISTINCT FROM v_semantic_key AND owner_safe_text=v_question) THEN
      INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type,governed_semantic_key) VALUES(NEW.id,v_sequence,v_item,'zeya',v_question,'primary_question',v_semantic_key);
    END IF;
    RETURN OLD;
  END IF;
  NEW.completion_contract_version:='direct-hire-telephone-bd-readiness-v1'; NEW.completion_readiness_result:=v_readiness;
  NEW.completion_source_state_fingerprint:=public.zeya_direct_hire_formation_source_state_fingerprint(NEW.id); RETURN NEW;
END; $$;

CREATE FUNCTION public.zeya_sanitize_direct_hire_formation_outcome_supersessions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_superseded uuid[]; v_ids jsonb;
BEGIN
  SELECT coalesce(array_agg(s.erroneous_decision_id),'{}'::uuid[]),coalesce(jsonb_agg(s.id ORDER BY s.id),'[]'::jsonb)
  INTO v_superseded,v_ids FROM public.direct_hire_formation_decision_supersessions s WHERE s.conversation_run_id=NEW.conversation_run_id;
  NEW.outcome:=jsonb_set(NEW.outcome,'{decisions}',coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(NEW.outcome->'decisions') item WHERE NOT ((item->>'decisionId')::uuid=ANY(v_superseded))),'[]'::jsonb));
  NEW.outcome:=jsonb_set(NEW.outcome,'{commercial}',coalesce((SELECT jsonb_object_agg(key,CASE WHEN (value->>'sourceDecisionId')::uuid=ANY(v_superseded) THEN jsonb_build_object('value',NULL,'sourceDecisionId',NULL) ELSE value END) FROM jsonb_each(NEW.outcome->'commercial')),'{}'::jsonb));
  NEW.outcome:=NEW.outcome||jsonb_build_object('decisionSupersessionIds',v_ids,'supersededDecisionIds',to_jsonb(v_superseded));
  NEW.outcome_fingerprint:=encode(extensions.digest(convert_to(NEW.outcome::text||'|'||NEW.source_state_fingerprint,'UTF8'),'sha256'),'hex');
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_outcome_supersession_sanitize BEFORE INSERT ON public.direct_hire_formation_outcome_packages
  FOR EACH ROW EXECUTE FUNCTION public.zeya_sanitize_direct_hire_formation_outcome_supersessions();

ALTER TABLE public.direct_hire_formation_decision_supersessions OWNER TO postgres;
ALTER FUNCTION public.zeya_reclassify_direct_hire_formation_decision(uuid,uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_sanitize_direct_hire_formation_outcome_supersessions() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_reclassify_direct_hire_formation_decision(uuid,uuid,uuid,text,text),public.zeya_sanitize_direct_hire_formation_outcome_supersessions() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_reclassify_direct_hire_formation_decision(uuid,uuid,uuid,text,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
