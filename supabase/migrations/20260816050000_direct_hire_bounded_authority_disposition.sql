BEGIN;

CREATE FUNCTION public.zeya_derive_direct_hire_governed_authority_disposition(
  p_decision_key text,p_statement text,p_raw_disposition text
) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_key text:=public.zeya_normalize_direct_hire_formation_decision_key(p_decision_key); v_text text:=coalesce(p_statement,'');
BEGIN
  IF p_raw_disposition IN ('allowed_within_bounds','owner_approval_required','prohibited','unresolved') THEN RETURN p_raw_disposition; END IF;
  IF v_key='authority_meeting_booking' THEN
    IF v_text~*'(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed).{0,35}(book|schedule).{0,20}meeting|(book|schedule).{0,20}meeting.{0,35}(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed)' THEN RETURN 'prohibited'; END IF;
    IF v_text~*'(may|can|allowed|authori[sz]ed).{0,40}(book|schedule).{0,20}meeting' AND v_text~*'(qualified|agreed to meet|published|up to|within|only|when|if|provided that|as long as)' THEN RETURN 'allowed_within_bounds'; END IF;
    IF v_text~*'(book|schedule).{0,20}meeting.{0,35}(requires?|needs?|subject to|must (get|have)).{0,15}(my |owner )?approval' THEN RETURN 'owner_approval_required'; END IF;
  ELSIF v_key='authority_negotiation' THEN
    IF v_text~*'(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed).{0,35}negotiat|negotiat.{0,35}(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed)' THEN RETURN 'prohibited'; END IF;
    IF v_text~*'(may|can|allowed|authori[sz]ed).{0,40}negotiat' AND v_text~*'(up to|within|only|when|if|provided that|as long as)' THEN RETURN 'allowed_within_bounds'; END IF;
    IF v_text~*'negotiat.{0,35}(requires?|needs?|subject to|must (get|have)).{0,15}(my |owner )?approval' THEN RETURN 'owner_approval_required'; END IF;
  ELSIF v_key='authority_pricing' THEN
    IF v_text~*'(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed).{0,35}(pric(e|ing)|quote)|(pric(e|ing)|quote).{0,35}(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed)' THEN RETURN 'prohibited'; END IF;
    IF v_text~*'(may|can|allowed|authori[sz]ed).{0,40}(pric(e|ing)|quote)' AND v_text~*'(published|up to|within|only|when|if|provided that|as long as)' THEN RETURN 'allowed_within_bounds'; END IF;
    IF v_text~*'(pric(e|ing)|quote).{0,35}(requires?|needs?|subject to|must (get|have)).{0,15}(my |owner )?approval' THEN RETURN 'owner_approval_required'; END IF;
  ELSIF v_key='authority_discounts' THEN
    IF v_text~*'(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed).{0,35}discount|discount.{0,35}(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed)' THEN RETURN 'prohibited'; END IF;
    IF v_text~*'(may|can|allowed|authori[sz]ed).{0,40}discount' AND v_text~*'(up to|within|only|when|if|provided that|as long as)' THEN RETURN 'allowed_within_bounds'; END IF;
    IF v_text~*'discount.{0,35}(requires?|needs?|subject to|must (get|have)).{0,15}(my |owner )?approval' THEN RETURN 'owner_approval_required'; END IF;
  ELSIF v_key='authority_customer_commitments' THEN
    IF v_text~*'(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed).{0,35}(promise|commit|guarantee)|(promise|commit|guarantee).{0,35}(may not|cannot|can''t|must not|do not|don''t|never|prohibited|not authori[sz]ed)' THEN RETURN 'prohibited'; END IF;
    IF v_text~*'(may|can|allowed|authori[sz]ed).{0,40}(promise|commit|guarantee)' AND v_text~*'(up to|within|only|when|if|provided that|as long as)' THEN RETURN 'allowed_within_bounds'; END IF;
    IF v_text~*'(promise|commit|guarantee).{0,35}(requires?|needs?|subject to|must (get|have)).{0,15}(my |owner )?approval' THEN RETURN 'owner_approval_required'; END IF;
  END IF;
  RETURN 'unresolved';
END; $$;

CREATE FUNCTION public.zeya_set_direct_hire_governed_authority_disposition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.decision_scope='authority' AND NEW.decision_key LIKE 'authority\_%' ESCAPE '\' THEN
    NEW.disposition:=public.zeya_derive_direct_hire_governed_authority_disposition(NEW.decision_key,NEW.decision_value->>'statement',NEW.disposition);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_authority_disposition_derive
  BEFORE INSERT ON public.direct_hire_formation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_set_direct_hire_governed_authority_disposition();

CREATE OR REPLACE FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_text text:=coalesce(NEW.decision_value->>'statement',''); v_disposition text;
BEGIN
  IF NEW.decision_scope<>'authority' OR pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  v_disposition:=public.zeya_derive_direct_hire_governed_authority_disposition(NEW.decision_key,v_text,NEW.disposition);
  INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
  SELECT NEW.formation_session_id,NEW.run_id,NEW.source_agenda_item_id,NEW.source_owner_turn_id,NEW.source_owner_evidence_id,'authority',candidate.key,candidate.disposition,NEW.decision_value,true
  FROM (VALUES
    (public.zeya_normalize_direct_hire_formation_decision_key(NEW.decision_key),v_disposition),
    (CASE WHEN v_text~*'discount' THEN 'authority_discounts' END,CASE WHEN v_text~*'(approval|check with me|subject to).*(discount)|discount.*(approval|check with me|subject to)' THEN 'owner_approval_required' ELSE v_disposition END),
    (CASE WHEN v_text~*'negotiat' THEN 'authority_negotiation' END,public.zeya_derive_direct_hire_governed_authority_disposition('authority_negotiation',v_text,NEW.disposition)),
    (CASE WHEN v_text~*'(promise|commit|guarantee)' THEN 'authority_customer_commitments' END,public.zeya_derive_direct_hire_governed_authority_disposition('authority_customer_commitments',v_text,NEW.disposition)),
    (CASE WHEN v_text~*'(book|schedule).{0,20}meeting|meeting.{0,20}(book|schedule)' THEN 'authority_meeting_booking' END,public.zeya_derive_direct_hire_governed_authority_disposition('authority_meeting_booking',v_text,NEW.disposition)),
    (CASE WHEN v_text~*'(owner approval|required approval|requires? my approval|needs? my approval|check with me first|get my approval first|subject to my approval)' THEN 'authority_owner_approval_required' END,'owner_approval_required'),
    (CASE WHEN v_text~*'(escalat|come to me|needs? my approval|requires? my approval|owner approval)' THEN 'authority_escalation_rules' END,'owner_approval_required'),
    (CASE WHEN v_text~*'(prohibited claim|may not guarantee|must not claim)' THEN 'authority_prohibited_claims' END,'prohibited')
  ) candidate(key,disposition) WHERE candidate.key IS NOT NULL AND candidate.key<>NEW.decision_key
  ON CONFLICT (source_owner_turn_id,decision_key) DO NOTHING;
  RETURN NEW;
END; $$;

ALTER TABLE public.direct_hire_formation_decision_supersessions
  DROP CONSTRAINT IF EXISTS direct_hire_formation_decision_supersessions_reason_check;
ALTER TABLE public.direct_hire_formation_decision_supersessions
  ADD CONSTRAINT direct_hire_formation_decision_supersessions_reason_check
  CHECK (reason IN ('corrected_application_semantic_mapping','corrected_authority_classification','corrected_bounded_authority_disposition'));

CREATE TABLE public.direct_hire_formation_authority_disposition_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  conversation_run_id uuid NOT NULL REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  erroneous_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  replacement_decision_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decisions(id) ON DELETE RESTRICT,
  decision_supersession_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_decision_supersessions(id) ON DELETE RESTRICT,
  corrected_disposition text NOT NULL CHECK (corrected_disposition='allowed_within_bounds'),
  reason text NOT NULL CHECK (reason='corrected_bounded_authority_disposition'),
  corrected_by_actor text NOT NULL CHECK (corrected_by_actor='service_role'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (erroneous_decision_id<>replacement_decision_id)
);
ALTER TABLE public.direct_hire_formation_authority_disposition_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_formation_authority_disposition_corrections FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.direct_hire_formation_authority_disposition_corrections TO service_role;
CREATE TRIGGER direct_hire_formation_authority_disposition_corrections_immutable
  BEFORE UPDATE OR DELETE ON public.direct_hire_formation_authority_disposition_corrections
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_conversation_history_modification();

CREATE FUNCTION public.zeya_correct_direct_hire_bounded_meeting_booking_authority(
  p_owner_id uuid,p_formation_session_id uuid,p_erroneous_decision_id uuid,p_reason text
) RETURNS TABLE(disposition_correction_id uuid,decision_supersession_id uuid,replacement_decision_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bad public.direct_hire_formation_decisions%ROWTYPE; v_run public.direct_hire_formation_conversation_runs%ROWTYPE;
  v_existing public.direct_hire_formation_authority_disposition_corrections%ROWTYPE; v_replacement uuid; v_supersession uuid; v_correction uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_reason IS DISTINCT FROM 'corrected_bounded_authority_disposition' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid bounded authority recovery request'; END IF;
  SELECT * INTO v_bad FROM public.direct_hire_formation_decisions WHERE id=p_erroneous_decision_id FOR UPDATE;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs WHERE id=v_bad.run_id AND owner_id=p_owner_id AND formation_session_id=p_formation_session_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.direct_hire_formation_authority_disposition_corrections WHERE erroneous_decision_id=p_erroneous_decision_id;
  IF v_existing.id IS NOT NULL THEN RETURN QUERY SELECT v_existing.id,v_existing.decision_supersession_id,v_existing.replacement_decision_id,true; RETURN; END IF;
  IF v_bad.id IS NULL OR v_run.id IS NULL OR v_run.status NOT IN ('active','paused') OR v_bad.formation_session_id IS DISTINCT FROM p_formation_session_id
    OR v_bad.decision_scope<>'authority' OR v_bad.decision_key<>'authority_meeting_booking' OR v_bad.disposition<>'restricted'
    OR v_bad.source_owner_evidence_id IS DISTINCT FROM '66160755-ecab-40ed-b313-1f9ec98672c0'::uuid
    OR btrim(coalesce(v_bad.decision_value->>'statement',''))<>'Zeya may book a meeting directly when the prospect is qualified and has clearly agreed to meet. Anything outside that should be escalated to me.'
    OR public.zeya_derive_direct_hire_governed_authority_disposition(v_bad.decision_key,v_bad.decision_value->>'statement',v_bad.disposition)<>'allowed_within_bounds'
    OR NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_agenda_resolution_events event WHERE event.formation_decision_id=v_bad.id AND event.answer_classification='authority_restriction' AND event.resolution_state='resolved' AND event.evidence_id=v_bad.source_owner_evidence_id)
    OR NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_decisions escalation WHERE escalation.run_id=v_bad.run_id AND escalation.source_owner_turn_id=v_bad.source_owner_turn_id AND escalation.decision_key='authority_escalation_rules' AND escalation.disposition='owner_approval_required')
    OR EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_bad.run_id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded meeting-booking authority is not eligible for governed recovery'; END IF;
  INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
  VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.source_agenda_item_id,v_bad.source_owner_turn_id,v_bad.source_owner_evidence_id,'authority','meeting_booking','allowed_within_bounds',v_bad.decision_value,true)
  RETURNING id INTO v_replacement;
  INSERT INTO public.direct_hire_formation_decision_supersessions(formation_session_id,conversation_run_id,erroneous_decision_id,replacement_decision_id,reason,corrected_by_actor)
  VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.id,v_replacement,p_reason,'service_role') RETURNING id INTO v_supersession;
  INSERT INTO public.direct_hire_formation_authority_disposition_corrections(formation_session_id,conversation_run_id,erroneous_decision_id,replacement_decision_id,decision_supersession_id,corrected_disposition,reason,corrected_by_actor)
  VALUES(v_bad.formation_session_id,v_bad.run_id,v_bad.id,v_replacement,v_supersession,'allowed_within_bounds',p_reason,'service_role') RETURNING id INTO v_correction;
  RETURN QUERY SELECT v_correction,v_supersession,v_replacement,false;
END; $$;

CREATE FUNCTION public.zeya_complete_direct_hire_formation_after_bounded_authority_recovery(
  p_owner_id uuid,p_formation_session_id uuid,p_disposition_correction_id uuid
) RETURNS TABLE(completed boolean,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_correction public.direct_hire_formation_authority_disposition_corrections%ROWTYPE;
  v_run public.direct_hire_formation_conversation_runs%ROWTYPE; v_working_session public.direct_hire_working_sessions%ROWTYPE; v_readiness jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_correction FROM public.direct_hire_formation_authority_disposition_corrections
  WHERE id=p_disposition_correction_id AND formation_session_id=p_formation_session_id FOR UPDATE;
  SELECT * INTO v_run FROM public.direct_hire_formation_conversation_runs
  WHERE id=v_correction.conversation_run_id AND owner_id=p_owner_id AND formation_session_id=p_formation_session_id FOR UPDATE;
  SELECT * INTO v_working_session FROM public.direct_hire_working_sessions
  WHERE id=v_run.direct_hire_working_session_id AND owner_id=p_owner_id AND formation_session_id=p_formation_session_id FOR UPDATE;
  IF v_correction.id IS NULL OR v_run.id IS NULL OR v_working_session.id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.representation_formation_sessions formation WHERE formation.id=p_formation_session_id AND formation.owner_id=p_owner_id AND formation.status='working_conversation_pending')
    OR NOT EXISTS(SELECT 1 FROM public.business_representations representation WHERE representation.id=v_run.business_representation_id AND representation.user_id=p_owner_id AND representation.current_version_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.representation_proposals proposal WHERE proposal.formation_session_id=p_formation_session_id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded authority completion lineage is not eligible'; END IF;
  IF v_run.status='completed' THEN
    IF v_working_session.status<>'completed' OR NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_run.id) THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded authority completion replay is inconsistent'; END IF;
    RETURN QUERY SELECT true,true; RETURN;
  END IF;
  v_readiness:=public.zeya_direct_hire_formation_readiness(v_run.id);
  IF v_run.status NOT IN ('active','paused') OR v_working_session.status<>'scheduled' OR NOT (v_readiness->>'ready')::boolean
    OR EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_run.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='bounded authority completion is not ready'; END IF;
  UPDATE public.direct_hire_formation_conversation_runs SET status='completed',completed_at=now(),updated_at=now() WHERE id=v_run.id;
  UPDATE public.direct_hire_working_sessions SET status='completed',updated_at=now() WHERE id=v_working_session.id;
  IF NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages outcome WHERE outcome.conversation_run_id=v_run.id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='bounded authority completion outcome missing'; END IF;
  RETURN QUERY SELECT true,false;
END; $$;

ALTER FUNCTION public.zeya_derive_direct_hire_governed_authority_disposition(text,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_set_direct_hire_governed_authority_disposition() OWNER TO postgres;
ALTER FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions() OWNER TO postgres;
ALTER TABLE public.direct_hire_formation_authority_disposition_corrections OWNER TO postgres;
ALTER FUNCTION public.zeya_correct_direct_hire_bounded_meeting_booking_authority(uuid,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_complete_direct_hire_formation_after_bounded_authority_recovery(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_derive_direct_hire_governed_authority_disposition(text,text,text),public.zeya_set_direct_hire_governed_authority_disposition(),public.zeya_correct_direct_hire_bounded_meeting_booking_authority(uuid,uuid,uuid,text),public.zeya_complete_direct_hire_formation_after_bounded_authority_recovery(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_correct_direct_hire_bounded_meeting_booking_authority(uuid,uuid,uuid,text),public.zeya_complete_direct_hire_formation_after_bounded_authority_recovery(uuid,uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
