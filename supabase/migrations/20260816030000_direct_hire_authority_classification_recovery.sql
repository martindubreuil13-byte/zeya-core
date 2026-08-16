BEGIN;

ALTER TABLE public.direct_hire_formation_decision_supersessions
  DROP CONSTRAINT IF EXISTS direct_hire_formation_decision_supersessions_reason_check;
ALTER TABLE public.direct_hire_formation_decision_supersessions
  ADD CONSTRAINT direct_hire_formation_decision_supersessions_reason_check
  CHECK (reason IN ('corrected_application_semantic_mapping','corrected_authority_classification'));

CREATE TABLE public.direct_hire_formation_answer_classification_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  conversation_run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  erroneous_resolution_event_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_agenda_resolution_events(id) ON DELETE RESTRICT,
  erroneous_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  replacement_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  decision_supersession_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decision_supersessions(id) ON DELETE RESTRICT,
  corrected_answer_classification text NOT NULL CHECK (corrected_answer_classification='authority_restriction'),
  reason text NOT NULL CHECK (reason='corrected_authority_classification'),
  corrected_by_actor text NOT NULL CHECK (corrected_by_actor='service_role'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (erroneous_decision_id<>replacement_decision_id)
);

ALTER TABLE public.direct_hire_formation_answer_classification_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_formation_answer_classification_corrections FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.direct_hire_formation_answer_classification_corrections TO service_role;
CREATE TRIGGER direct_hire_formation_answer_classification_corrections_immutable
  BEFORE UPDATE OR DELETE ON public.direct_hire_formation_answer_classification_corrections
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();

CREATE FUNCTION public.zeya_correct_direct_hire_authority_classification(
  p_owner_id uuid,
  p_formation_session_id uuid,
  p_erroneous_decision_id uuid,
  p_erroneous_resolution_event_id uuid,
  p_reason text
) RETURNS TABLE(classification_correction_id uuid,decision_supersession_id uuid,replacement_decision_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_bad public.direct_hire_formation_decisions%ROWTYPE;
  v_event public.direct_hire_formation_agenda_resolution_events%ROWTYPE;
  v_run public.direct_hire_formation_conversation_runs%ROWTYPE;
  v_existing public.direct_hire_formation_answer_classification_corrections%ROWTYPE;
  v_replacement uuid;
  v_supersession uuid;
  v_correction uuid;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized';
  END IF;
  IF p_reason IS DISTINCT FROM 'corrected_authority_classification' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid authority classification recovery request';
  END IF;

  SELECT * INTO v_bad FROM public.direct_hire_formation_decisions
  WHERE id=p_erroneous_decision_id FOR UPDATE;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs
  WHERE id=v_bad.run_id AND owner_id=p_owner_id AND formation_session_id=p_formation_session_id FOR UPDATE;
  SELECT * INTO v_event FROM public.direct_hire_formation_agenda_resolution_events
  WHERE id=p_erroneous_resolution_event_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.direct_hire_formation_answer_classification_corrections
  WHERE erroneous_resolution_event_id=p_erroneous_resolution_event_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.erroneous_decision_id IS DISTINCT FROM p_erroneous_decision_id THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='authority classification recovery replay conflict';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.decision_supersession_id,v_existing.replacement_decision_id,true;
    RETURN;
  END IF;

  IF v_bad.id IS NULL OR v_run.id IS NULL OR v_run.status NOT IN ('active','paused')
    OR v_bad.formation_session_id IS DISTINCT FROM p_formation_session_id
    OR v_bad.decision_scope<>'authority' OR v_bad.decision_key<>'authority_negotiation' OR v_bad.disposition<>'granted'
    OR public.zeya_normalize_direct_hire_authority_disposition(v_bad.disposition,v_bad.decision_value->>'statement')<>'prohibited'
    OR btrim(coalesce(v_bad.decision_value->>'statement',''))<>'Zeya may not negotiate prices or commercial terms. Any negotiation must be escalated to me.'
    OR v_event.id IS NULL OR v_event.run_id IS DISTINCT FROM v_bad.run_id
    OR v_event.agenda_item_id IS DISTINCT FROM v_bad.source_agenda_item_id
    OR v_event.owner_turn_id IS DISTINCT FROM v_bad.source_owner_turn_id
    OR v_event.evidence_id IS DISTINCT FROM v_bad.source_owner_evidence_id
    OR v_event.formation_decision_id IS DISTINCT FROM v_bad.id
    OR v_event.answer_classification<>'authority_grant' OR v_event.resolution_state<>'resolved'
    OR NOT EXISTS(
      SELECT 1 FROM public.direct_hire_formation_conversation_turns question
      JOIN public.direct_hire_formation_conversation_turns answer ON answer.id=v_bad.source_owner_turn_id
      WHERE question.run_id=v_bad.run_id AND question.agenda_item_id=v_bad.source_agenda_item_id
        AND question.speaker='zeya' AND question.sequence<answer.sequence
        AND question.governed_semantic_key='authority_negotiation'
        AND NOT EXISTS(
          SELECT 1 FROM public.direct_hire_formation_conversation_turns later
          WHERE later.run_id=question.run_id AND later.speaker='zeya'
            AND later.sequence<answer.sequence AND later.sequence>question.sequence
        )
    )
    OR NOT EXISTS(
      SELECT 1 FROM public.direct_hire_formation_decisions escalation
      WHERE escalation.run_id=v_bad.run_id AND escalation.source_owner_turn_id=v_bad.source_owner_turn_id
        AND escalation.decision_key='authority_escalation_rules'
        AND public.zeya_normalize_direct_hire_authority_disposition(escalation.disposition,escalation.decision_value->>'statement')='owner_approval_required'
    )
    OR EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_run.id)
  THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='authority classification is not eligible for governed recovery';
  END IF;

  INSERT INTO public.direct_hire_formation_decisions(
    formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,
    decision_scope,decision_key,disposition,decision_value,noncanonical
  ) VALUES(
    v_bad.formation_session_id,v_bad.run_id,v_bad.source_agenda_item_id,v_bad.source_owner_turn_id,v_bad.source_owner_evidence_id,
    'authority','negotiation','prohibited',v_bad.decision_value,true
  ) RETURNING id INTO v_replacement;

  INSERT INTO public.direct_hire_formation_decision_supersessions(
    formation_session_id,conversation_run_id,erroneous_decision_id,replacement_decision_id,reason,corrected_by_actor
  ) VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.id,v_replacement,p_reason,'service_role')
  RETURNING id INTO v_supersession;

  INSERT INTO public.direct_hire_formation_answer_classification_corrections(
    formation_session_id,conversation_run_id,erroneous_resolution_event_id,erroneous_decision_id,
    replacement_decision_id,decision_supersession_id,corrected_answer_classification,reason,corrected_by_actor
  ) VALUES(
    v_bad.formation_session_id,v_bad.run_id,v_event.id,v_bad.id,v_replacement,v_supersession,
    'authority_restriction',p_reason,'service_role'
  ) RETURNING id INTO v_correction;

  RETURN QUERY SELECT v_correction,v_supersession,v_replacement,false;
END;
$$;

CREATE OR REPLACE FUNCTION public.zeya_sanitize_direct_hire_formation_outcome_supersessions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_superseded uuid[]; v_ids jsonb; v_correction_ids jsonb; v_entry record; v_replacement public.direct_hire_formation_decisions%ROWTYPE;
BEGIN
  SELECT coalesce(array_agg(s.erroneous_decision_id),'{}'::uuid[]),coalesce(jsonb_agg(s.id ORDER BY s.id),'[]'::jsonb)
  INTO v_superseded,v_ids FROM public.direct_hire_formation_decision_supersessions s WHERE s.conversation_run_id=NEW.conversation_run_id;
  SELECT coalesce(jsonb_agg(c.id ORDER BY c.id),'[]'::jsonb) INTO v_correction_ids
  FROM public.direct_hire_formation_answer_classification_corrections c WHERE c.conversation_run_id=NEW.conversation_run_id;
  NEW.outcome:=jsonb_set(NEW.outcome,'{decisions}',coalesce((SELECT jsonb_agg(item) FROM jsonb_array_elements(NEW.outcome->'decisions') item WHERE NOT ((item->>'decisionId')::uuid=ANY(v_superseded))),'[]'::jsonb));
  NEW.outcome:=jsonb_set(NEW.outcome,'{commercial}',coalesce((SELECT jsonb_object_agg(key,CASE WHEN (value->>'sourceDecisionId')::uuid=ANY(v_superseded) THEN jsonb_build_object('value',NULL,'sourceDecisionId',NULL) ELSE value END) FROM jsonb_each(NEW.outcome->'commercial')),'{}'::jsonb));
  FOR v_entry IN SELECT s.erroneous_decision_id,s.replacement_decision_id FROM public.direct_hire_formation_decision_supersessions s WHERE s.conversation_run_id=NEW.conversation_run_id LOOP
    IF EXISTS(SELECT 1 FROM jsonb_each(NEW.outcome->'authority') item WHERE (item.value->>'sourceDecisionId')::uuid=v_entry.erroneous_decision_id) THEN
      SELECT * INTO v_replacement FROM public.direct_hire_formation_decisions WHERE id=v_entry.replacement_decision_id;
      NEW.outcome:=jsonb_set(NEW.outcome,ARRAY['authority',public.zeya_normalize_direct_hire_formation_decision_key(v_replacement.decision_key)],jsonb_build_object(
        'disposition',public.zeya_normalize_direct_hire_authority_disposition(v_replacement.disposition,v_replacement.decision_value->>'statement'),
        'value',v_replacement.decision_value,'sourceDecisionId',v_replacement.id
      ));
    END IF;
  END LOOP;
  NEW.outcome:=jsonb_set(NEW.outcome,'{sourceDecisionIds}',coalesce((SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(NEW.outcome->'sourceDecisionIds') value WHERE NOT value::uuid=ANY(v_superseded)),'[]'::jsonb));
  NEW.outcome:=NEW.outcome||jsonb_build_object('decisionSupersessionIds',v_ids,'supersededDecisionIds',to_jsonb(v_superseded),'answerClassificationCorrectionIds',v_correction_ids);
  NEW.outcome_fingerprint:=encode(extensions.digest(convert_to(NEW.outcome::text||'|'||NEW.source_state_fingerprint,'UTF8'),'sha256'),'hex');
  RETURN NEW;
END;
$$;

ALTER TABLE public.direct_hire_formation_answer_classification_corrections OWNER TO postgres;
ALTER FUNCTION public.zeya_correct_direct_hire_authority_classification(uuid,uuid,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_sanitize_direct_hire_formation_outcome_supersessions() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_correct_direct_hire_authority_classification(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_correct_direct_hire_authority_classification(uuid,uuid,uuid,uuid,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
