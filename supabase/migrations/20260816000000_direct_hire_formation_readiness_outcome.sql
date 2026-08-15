BEGIN;

ALTER TABLE public.direct_hire_formation_decisions
  DROP CONSTRAINT IF EXISTS direct_hire_formation_decisions_source_owner_turn_id_key,
  DROP CONSTRAINT IF EXISTS direct_hire_formation_decisions_decision_key_check,
  DROP CONSTRAINT IF EXISTS direct_hire_formation_decisions_disposition_check;
ALTER TABLE public.direct_hire_formation_decisions
  ADD CONSTRAINT direct_hire_formation_decisions_turn_key_unique UNIQUE (source_owner_turn_id,decision_key),
  ADD CONSTRAINT direct_hire_formation_decisions_decision_key_check CHECK (decision_key IN (
    'pricing','discounts','negotiation','promises_commitments','meeting_booking','owner_approval_required','escalation','prohibited_claims',
    'immediate_bd_goal','target_segment','qualification_threshold','meeting_objective','geography_exclusions','owner_availability_escalation',
    'authority_pricing','authority_discounts','authority_negotiation','authority_customer_commitments','authority_meeting_booking',
    'authority_owner_approval_required','authority_escalation_rules','authority_prohibited_claims','primary_target_segment','geography','explicit_exclusions','preferred_opportunity_type'
  )),
  ADD CONSTRAINT direct_hire_formation_decisions_disposition_check CHECK (disposition IN (
    'granted','restricted','decided','allowed_within_bounds','owner_approval_required','prohibited','unresolved'
  ));

ALTER TABLE public.direct_hire_formation_conversation_runs
  ADD COLUMN completion_contract_version text CHECK (completion_contract_version IS NULL OR completion_contract_version='direct-hire-telephone-bd-readiness-v1'),
  ADD COLUMN completion_readiness_result jsonb CHECK (completion_readiness_result IS NULL OR jsonb_typeof(completion_readiness_result)='object'),
  ADD COLUMN completion_source_state_fingerprint text CHECK (completion_source_state_fingerprint IS NULL OR completion_source_state_fingerprint ~ '^[0-9a-f]{64}$');

CREATE TABLE public.direct_hire_formation_outcome_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_session_id uuid NOT NULL UNIQUE REFERENCES public.representation_formation_sessions(id) ON DELETE RESTRICT,
  formation_handoff_id uuid NOT NULL REFERENCES public.direct_hire_first_working_session_formation_handoffs(id) ON DELETE RESTRICT,
  conversation_run_id uuid NOT NULL UNIQUE REFERENCES public.direct_hire_formation_conversation_runs(id) ON DELETE RESTRICT,
  direct_hire_working_session_id uuid NOT NULL REFERENCES public.direct_hire_working_sessions(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  preparation_snapshot_fingerprint text NOT NULL,
  handoff_hypothesis_trace_fingerprint text NOT NULL,
  completion_contract_version text NOT NULL CHECK (completion_contract_version='direct-hire-telephone-bd-readiness-v1'),
  readiness_result jsonb NOT NULL CHECK (jsonb_typeof(readiness_result)='object' AND readiness_result->>'ready'='true'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome)='object'),
  source_state_fingerprint text NOT NULL CHECK (source_state_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome_fingerprint text NOT NULL UNIQUE CHECK (outcome_fingerprint ~ '^[0-9a-f]{64}$'),
  noncanonical boolean NOT NULL CHECK (noncanonical),
  finalized_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.direct_hire_formation_outcome_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_hire_formation_outcome_packages FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.direct_hire_formation_outcome_packages TO service_role;

CREATE FUNCTION public.zeya_normalize_direct_hire_formation_decision_key(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_key
    WHEN 'pricing' THEN 'authority_pricing' WHEN 'discounts' THEN 'authority_discounts'
    WHEN 'negotiation' THEN 'authority_negotiation' WHEN 'promises_commitments' THEN 'authority_customer_commitments'
    WHEN 'meeting_booking' THEN 'authority_meeting_booking' WHEN 'owner_approval_required' THEN 'authority_owner_approval_required'
    WHEN 'escalation' THEN 'authority_escalation_rules' WHEN 'prohibited_claims' THEN 'authority_prohibited_claims'
    WHEN 'target_segment' THEN 'primary_target_segment' ELSE p_key END
$$;

CREATE FUNCTION public.zeya_normalize_direct_hire_authority_disposition(p_disposition text,p_statement text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_disposition IN ('allowed_within_bounds','owner_approval_required','prohibited','unresolved') THEN p_disposition
    WHEN coalesce(p_statement,'') ~* '\m(owner approval|required approval|must escalate|escalate to)\M' THEN 'owner_approval_required'
    WHEN coalesce(p_statement,'') ~* '\m(prohibited|never|must not|may not|cannot|can''t|do not|don''t)\M' THEN 'prohibited'
    WHEN p_disposition='granted' AND coalesce(p_statement,'') ~* '\m(up to|within|only|limited to|provided that|as long as)\M' THEN 'allowed_within_bounds'
    ELSE 'unresolved' END
$$;

CREATE FUNCTION public.zeya_direct_hire_formation_source_state_fingerprint(p_run_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH run AS (SELECT * FROM public.direct_hire_formation_conversation_runs WHERE id=p_run_id),
  hypothesis_state AS (
    SELECT coalesce(string_agg(h.id::text||':'||h.hypothesis_version::text||':'||coalesce(latest.decision::text,'none'),'|' ORDER BY h.id), '') value
    FROM run JOIN public.hypotheses h ON h.owner_id=run.owner_id AND h.business_representation_id=run.business_representation_id
    LEFT JOIN LATERAL (SELECT v.decision FROM public.hypothesis_verifications v WHERE v.hypothesis_id=h.id ORDER BY v.verification_sequence DESC LIMIT 1) latest ON true
    WHERE NOT EXISTS(SELECT 1 FROM public.hypotheses successor WHERE successor.previous_hypothesis_id=h.id)
  ), decision_state AS (
    SELECT coalesce(string_agg(d.id::text||':'||public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key)||':'||d.disposition||':'||d.decision_value::text,'|' ORDER BY d.id),'') value
    FROM public.direct_hire_formation_decisions d WHERE d.run_id=p_run_id
  ), resolution_state AS (
    SELECT coalesce(string_agg(e.id::text||':'||e.agenda_item_id::text||':'||e.resolution_state,'|' ORDER BY e.id),'') value
    FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=p_run_id
  ), turn_state AS (
    SELECT coalesce(string_agg(t.id::text||':'||t.sequence::text||':'||encode(extensions.digest(convert_to(t.owner_safe_text,'UTF8'),'sha256'),'hex'),'|' ORDER BY t.sequence),'') value
    FROM public.direct_hire_formation_conversation_turns t WHERE t.run_id=p_run_id
  )
  SELECT encode(extensions.digest(convert_to(run.id::text||'|'||run.formation_handoff_id::text||'|'||run.preparation_snapshot_fingerprint||'|'||run.hypothesis_trace_fingerprint||'|'||hypothesis_state.value||'|'||decision_state.value||'|'||resolution_state.value||'|'||turn_state.value,'UTF8'),'sha256'),'hex')
  FROM run,hypothesis_state,decision_state,resolution_state,turn_state
$$;

CREATE FUNCTION public.zeya_direct_hire_formation_readiness(p_run_id uuid)
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
    ) derived ORDER BY derived.normalized_key,derived.exact_key DESC,derived.created_at DESC,derived.id DESC
  ), states AS (
    SELECT key, satisfied, blocked, sources FROM (VALUES
      ('offer',EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.constitutional_domain='whatYouSell' AND e.resolution_state IN ('resolved','superseded_by_prior_answer')),false,coalesce((SELECT jsonb_agg(e.id ORDER BY e.id) FROM public.direct_hire_first_working_session_formation_agenda_items a JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.constitutional_domain='whatYouSell' AND e.resolution_state IN ('resolved','superseded_by_prior_answer')),'[]'::jsonb)),
      ('target',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='primary_target_segment'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='primary_target_segment'),'[]'::jsonb)),
      ('immediate_bd_objective',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='immediate_bd_goal'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='immediate_bd_goal'),'[]'::jsonb)),
      ('qualification',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='qualification_threshold'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='qualification_threshold'),'[]'::jsonb)),
      ('meeting_objective',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='meeting_objective'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='meeting_objective'),'[]'::jsonb)),
      ('pricing_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='authority_pricing' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='authority_pricing' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('negotiation_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='authority_negotiation' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='authority_negotiation' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('commitment_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='authority_customer_commitments' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='authority_customer_commitments' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('meeting_booking_authority',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key='authority_meeting_booking' AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key='authority_meeting_booking' AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('escalation_owner_approval',EXISTS(SELECT 1 FROM normalized_decisions WHERE normalized_key IN ('authority_escalation_rules','authority_owner_approval_required') AND normalized_disposition<>'unresolved'),false,coalesce((SELECT jsonb_agg(id ORDER BY id) FROM normalized_decisions WHERE normalized_key IN ('authority_escalation_rules','authority_owner_approval_required') AND normalized_disposition<>'unresolved'),'[]'::jsonb)),
      ('blocking_contradictions',NOT EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),EXISTS(SELECT 1 FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),coalesce((SELECT jsonb_agg(a.id ORDER BY a.id) FROM public.direct_hire_first_working_session_formation_agenda_items a LEFT JOIN latest_events e ON e.agenda_item_id=a.id WHERE a.formation_session_id=(SELECT formation_session_id FROM run) AND a.category='contradiction' AND a.risk='high' AND (e.id IS NULL OR e.resolution_state IN ('still_unresolved','deferred'))),'[]'::jsonb))
    ) value(key,satisfied,blocked,sources)
  )
  SELECT jsonb_build_object('contractVersion','direct-hire-telephone-bd-readiness-v1','ready',bool_and(satisfied AND NOT blocked),'categories',jsonb_object_agg(key,jsonb_build_object('state',CASE WHEN blocked THEN 'blocked' WHEN satisfied THEN 'satisfied' ELSE 'unresolved' END,'sourceIds',sources) ORDER BY key)) FROM states
$$;

CREATE FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_text text:=coalesce(NEW.decision_value->>'statement',''); v_disposition text; v_primary_disposition text;
BEGIN
  IF NEW.decision_scope<>'authority' OR NEW.decision_key LIKE 'authority\_%' ESCAPE '\' THEN RETURN NEW; END IF;
  v_disposition:=public.zeya_normalize_direct_hire_authority_disposition(NEW.disposition,v_text);
  v_primary_disposition:=CASE
    WHEN NEW.decision_key='pricing' AND v_text!~*'pric' THEN 'unresolved'
    WHEN NEW.decision_key='discounts' AND v_text!~*'discount' THEN 'unresolved'
    WHEN NEW.decision_key='negotiation' AND v_text!~*'negotiat' THEN 'unresolved'
    WHEN NEW.decision_key='promises_commitments' AND v_text!~*'(promise|commit|guarantee)' THEN 'unresolved'
    WHEN NEW.decision_key='meeting_booking' AND v_text!~*'(book|schedule).{0,20}meeting|meeting.{0,20}(book|schedule)' THEN 'unresolved'
    ELSE v_disposition END;
  INSERT INTO public.direct_hire_formation_decisions(formation_session_id,run_id,source_agenda_item_id,source_owner_turn_id,source_owner_evidence_id,decision_scope,decision_key,disposition,decision_value,noncanonical)
  SELECT NEW.formation_session_id,NEW.run_id,NEW.source_agenda_item_id,NEW.source_owner_turn_id,NEW.source_owner_evidence_id,'authority',candidate.key,candidate.disposition,NEW.decision_value,true
  FROM (VALUES
    (public.zeya_normalize_direct_hire_formation_decision_key(NEW.decision_key),v_primary_disposition),
    (CASE WHEN v_text~*'discount' THEN 'authority_discounts' END,CASE WHEN v_text~*'(escalat|approval).{0,30}discount|discount.{0,30}(escalat|approval)' THEN 'owner_approval_required' ELSE v_disposition END),
    (CASE WHEN v_text~*'negotiat' THEN 'authority_negotiation' END,CASE WHEN v_text~*'(may not|must not|cannot|can''t|do not|don''t).{0,20}negotiat' THEN 'prohibited' ELSE v_disposition END),
    (CASE WHEN v_text~*'(promise|commit|guarantee)' THEN 'authority_customer_commitments' END,CASE WHEN v_text~*'(may not|must not|cannot|can''t|do not|don''t).{0,30}(promise|commit|guarantee)' THEN 'prohibited' ELSE v_disposition END),
    (CASE WHEN v_text~*'(book|schedule).{0,20}meeting|meeting.{0,20}(book|schedule)' THEN 'authority_meeting_booking' END,CASE WHEN v_text~*'(may|can).{0,30}(book|schedule).{0,20}(qualified )?meeting' THEN 'allowed_within_bounds' ELSE v_disposition END),
    (CASE WHEN v_text~*'(owner approval|required approval)' THEN 'authority_owner_approval_required' END,'owner_approval_required'),
    (CASE WHEN v_text~*'escalat' THEN 'authority_escalation_rules' END,'owner_approval_required'),
    (CASE WHEN v_text~*'(prohibited claim|may not guarantee|must not claim)' THEN 'authority_prohibited_claims' END,'prohibited')
  ) candidate(key,disposition) WHERE candidate.key IS NOT NULL
  ON CONFLICT (source_owner_turn_id,decision_key) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_decision_cross_derivation AFTER INSERT ON public.direct_hire_formation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions();

CREATE FUNCTION public.zeya_enforce_direct_hire_required_agenda_defer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item public.direct_hire_first_working_session_formation_agenda_items%ROWTYPE;
BEGIN
  IF NEW.resolution_state<>'deferred' THEN RETURN NEW; END IF;
  SELECT * INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE id=NEW.agenda_item_id;
  IF v_item.blocking OR v_item.category='authority' OR v_item.constitutional_domain IN ('whatYouSell','whoItIsFor')
    OR (v_item.category='commercial' AND v_item.question_intent !~* '(geograph|exclusion|preferred opportunity)') THEN
    NEW.resolution_state:='still_unresolved';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_required_agenda_defer_gate BEFORE INSERT ON public.direct_hire_formation_agenda_resolution_events
  FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_direct_hire_required_agenda_defer();

CREATE FUNCTION public.zeya_gate_direct_hire_formation_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_readiness jsonb; v_missing text; v_item uuid; v_question text; v_sequence integer;
BEGIN
  IF NEW.status<>'completed' OR OLD.status='completed' THEN RETURN NEW; END IF;
  v_readiness:=public.zeya_direct_hire_formation_readiness(NEW.id);
  IF NOT (v_readiness->>'ready')::boolean THEN
    SELECT key INTO v_missing FROM jsonb_each(v_readiness->'categories') WHERE value->>'state'<>'satisfied'
      ORDER BY array_position(ARRAY['offer','target','immediate_bd_objective','qualification','meeting_objective','pricing_authority','negotiation_authority','commitment_authority','meeting_booking_authority','escalation_owner_approval','blocking_contradictions'],key) LIMIT 1;
    v_question:=CASE v_missing
      WHEN 'meeting_booking_authority' THEN 'May Zeya book a qualified meeting directly, or is owner approval required?'
      WHEN 'pricing_authority' THEN 'What pricing may Zeya discuss, and what requires owner approval?'
      WHEN 'negotiation_authority' THEN 'May Zeya negotiate, or must negotiation be escalated?'
      WHEN 'commitment_authority' THEN 'Which promises or commitments are permitted, approval-gated, or prohibited?'
      WHEN 'escalation_owner_approval' THEN 'What exact escalation and owner-approval rule must Zeya follow?'
      ELSE 'This required readiness point remains unresolved: '||replace(v_missing,'_',' ')||'. Please establish it explicitly.' END;
    SELECT id INTO v_item FROM public.direct_hire_first_working_session_formation_agenda_items WHERE formation_session_id=NEW.formation_session_id
      ORDER BY (category=CASE WHEN v_missing IN ('pricing_authority','negotiation_authority','commitment_authority','meeting_booking_authority','escalation_owner_approval') THEN 'authority' ELSE 'commercial' END) DESC,blocking DESC,rank LIMIT 1;
    SELECT coalesce(max(sequence),0)+1 INTO v_sequence FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id;
    IF NOT EXISTS(SELECT 1 FROM public.direct_hire_formation_conversation_turns WHERE run_id=NEW.id AND speaker='zeya' AND owner_safe_text=v_question) THEN
      INSERT INTO public.direct_hire_formation_conversation_turns(run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type) VALUES(NEW.id,v_sequence,v_item,'zeya',v_question,'primary_question');
    END IF;
    RETURN OLD;
  END IF;
  NEW.completion_contract_version:='direct-hire-telephone-bd-readiness-v1';
  NEW.completion_readiness_result:=v_readiness;
  NEW.completion_source_state_fingerprint:=public.zeya_direct_hire_formation_source_state_fingerprint(NEW.id);
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_completion_readiness_gate BEFORE UPDATE OF status ON public.direct_hire_formation_conversation_runs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_gate_direct_hire_formation_completion();

CREATE FUNCTION public.zeya_gate_direct_hire_working_session_text_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status<>'completed' AND EXISTS(
    SELECT 1 FROM public.direct_hire_formation_conversation_runs run
    WHERE run.direct_hire_working_session_id=NEW.id AND run.status<>'completed'
  ) THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_working_session_text_completion_gate BEFORE UPDATE OF status ON public.direct_hire_working_sessions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_gate_direct_hire_working_session_text_completion();

CREATE FUNCTION public.zeya_finalize_direct_hire_formation_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_handoff public.direct_hire_first_working_session_formation_handoffs%ROWTYPE; v_outcome jsonb; v_fingerprint text;
BEGIN
  IF NEW.status<>'completed' OR OLD.status='completed' THEN RETURN NEW; END IF;
  SELECT * INTO v_handoff FROM public.direct_hire_first_working_session_formation_handoffs WHERE id=NEW.formation_handoff_id;
  SELECT jsonb_build_object(
    'contractVersion','direct-hire-formation-outcome-v1','conversationRunId',NEW.id,'formationHandoffId',NEW.formation_handoff_id,
    'readiness',NEW.completion_readiness_result,
    'authority',(
      SELECT jsonb_object_agg(required.key,coalesce(effective.value,jsonb_build_object('disposition','unresolved','sourceDecisionId',NULL)) ORDER BY required.key)
      FROM (VALUES ('authority_pricing'),('authority_discounts'),('authority_negotiation'),('authority_customer_commitments'),('authority_meeting_booking'),('authority_owner_approval_required'),('authority_escalation_rules'),('authority_prohibited_claims')) required(key)
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('disposition',public.zeya_normalize_direct_hire_authority_disposition(d.disposition,d.decision_value->>'statement'),'value',d.decision_value,'sourceDecisionId',d.id) value
        FROM public.direct_hire_formation_decisions d WHERE d.run_id=NEW.id AND public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key)=required.key
        ORDER BY (d.decision_key=required.key) DESC,d.created_at DESC,d.id DESC LIMIT 1
      ) effective ON true
    ),
    'commercial',(
      SELECT jsonb_object_agg(required.key,coalesce(effective.value,jsonb_build_object('value',NULL,'sourceDecisionId',NULL)) ORDER BY required.key)
      FROM (VALUES ('immediate_bd_goal'),('primary_target_segment'),('qualification_threshold'),('meeting_objective'),('geography'),('explicit_exclusions'),('preferred_opportunity_type')) required(key)
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('value',d.decision_value,'sourceDecisionId',d.id) value
        FROM public.direct_hire_formation_decisions d WHERE d.run_id=NEW.id AND public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key)=required.key
        ORDER BY (d.decision_key=required.key) DESC,d.created_at DESC,d.id DESC LIMIT 1
      ) effective ON true
    ),
    'decisions',coalesce((SELECT jsonb_agg(jsonb_build_object('decisionId',effective.id,'key',effective.normalized_key,'disposition',effective.normalized_disposition,'value',effective.decision_value) ORDER BY effective.normalized_key) FROM (SELECT DISTINCT ON (public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key)) d.*,public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key) normalized_key,CASE WHEN d.decision_scope='authority' THEN public.zeya_normalize_direct_hire_authority_disposition(d.disposition,d.decision_value->>'statement') ELSE 'decided' END normalized_disposition FROM public.direct_hire_formation_decisions d WHERE d.run_id=NEW.id ORDER BY public.zeya_normalize_direct_hire_formation_decision_key(d.decision_key),d.created_at DESC,d.id DESC) effective),'[]'::jsonb),
    'deferredAgendaItemIds',coalesce((SELECT jsonb_agg(e.agenda_item_id ORDER BY e.agenda_item_id) FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=NEW.id AND e.resolution_state='deferred'),'[]'::jsonb),
    'sourceEvidenceIds',coalesce((SELECT jsonb_agg(source.id ORDER BY source.id) FROM (SELECT d.source_owner_evidence_id id FROM public.direct_hire_formation_decisions d WHERE d.run_id=NEW.id UNION SELECT e.evidence_id FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=NEW.id AND e.evidence_id IS NOT NULL) source),'[]'::jsonb),
    'sourceHypothesisIds',coalesce((SELECT jsonb_agg(h.id ORDER BY h.id) FROM public.hypotheses h WHERE h.owner_id=NEW.owner_id AND h.business_representation_id=NEW.business_representation_id AND NOT EXISTS(SELECT 1 FROM public.hypotheses successor WHERE successor.previous_hypothesis_id=h.id)),'[]'::jsonb),
    'sourceDecisionIds',coalesce((SELECT jsonb_agg(d.id ORDER BY d.id) FROM public.direct_hire_formation_decisions d WHERE d.run_id=NEW.id),'[]'::jsonb),
    'sourceResolutionEventIds',coalesce((SELECT jsonb_agg(e.id ORDER BY e.id) FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=NEW.id),'[]'::jsonb),
    'noncanonical',true
  ) INTO v_outcome;
  v_fingerprint:=encode(extensions.digest(convert_to(v_outcome::text||'|'||NEW.completion_source_state_fingerprint,'UTF8'),'sha256'),'hex');
  INSERT INTO public.direct_hire_formation_outcome_packages(formation_session_id,formation_handoff_id,conversation_run_id,direct_hire_working_session_id,owner_id,business_id,business_representation_id,preparation_snapshot_fingerprint,handoff_hypothesis_trace_fingerprint,completion_contract_version,readiness_result,outcome,source_state_fingerprint,outcome_fingerprint,noncanonical)
  VALUES(NEW.formation_session_id,NEW.formation_handoff_id,NEW.id,NEW.direct_hire_working_session_id,NEW.owner_id,NEW.business_id,NEW.business_representation_id,NEW.preparation_snapshot_fingerprint,NEW.hypothesis_trace_fingerprint,NEW.completion_contract_version,NEW.completion_readiness_result,v_outcome,NEW.completion_source_state_fingerprint,v_fingerprint,true)
  ON CONFLICT (conversation_run_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_outcome_finalize AFTER UPDATE OF status ON public.direct_hire_formation_conversation_runs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_finalize_direct_hire_formation_outcome();

CREATE FUNCTION public.zeya_preserve_direct_hire_formation_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.status='completed' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.completion_contract_version IS DISTINCT FROM OLD.completion_contract_version OR NEW.completion_readiness_result IS DISTINCT FROM OLD.completion_readiness_result
    OR NEW.completion_source_state_fingerprint IS DISTINCT FROM OLD.completion_source_state_fingerprint) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Formation text completion is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER direct_hire_formation_completion_immutable BEFORE UPDATE ON public.direct_hire_formation_conversation_runs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_preserve_direct_hire_formation_completion();

CREATE FUNCTION public.zeya_direct_hire_formation_outcome_is_current(p_owner_id uuid,p_outcome_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.direct_hire_formation_outcome_packages o WHERE o.id=p_outcome_id AND o.owner_id=p_owner_id
    AND o.source_state_fingerprint=public.zeya_direct_hire_formation_source_state_fingerprint(o.conversation_run_id))
$$;

CREATE FUNCTION public.zeya_prevent_direct_hire_formation_outcome_modification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Formation outcome package is immutable'; END; $$;
CREATE TRIGGER direct_hire_formation_outcome_immutable BEFORE UPDATE OR DELETE ON public.direct_hire_formation_outcome_packages
  FOR EACH ROW EXECUTE FUNCTION public.zeya_prevent_direct_hire_formation_outcome_modification();

ALTER TABLE public.direct_hire_formation_outcome_packages OWNER TO postgres;
ALTER FUNCTION public.zeya_normalize_direct_hire_formation_decision_key(text) OWNER TO postgres;
ALTER FUNCTION public.zeya_normalize_direct_hire_authority_disposition(text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_direct_hire_formation_source_state_fingerprint(uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_direct_hire_formation_readiness(uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_derive_direct_hire_formation_cross_decisions() OWNER TO postgres;
ALTER FUNCTION public.zeya_enforce_direct_hire_required_agenda_defer() OWNER TO postgres;
ALTER FUNCTION public.zeya_gate_direct_hire_formation_completion() OWNER TO postgres;
ALTER FUNCTION public.zeya_gate_direct_hire_working_session_text_completion() OWNER TO postgres;
ALTER FUNCTION public.zeya_finalize_direct_hire_formation_outcome() OWNER TO postgres;
ALTER FUNCTION public.zeya_preserve_direct_hire_formation_completion() OWNER TO postgres;
ALTER FUNCTION public.zeya_direct_hire_formation_outcome_is_current(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_prevent_direct_hire_formation_outcome_modification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_normalize_direct_hire_formation_decision_key(text),public.zeya_normalize_direct_hire_authority_disposition(text,text),public.zeya_direct_hire_formation_source_state_fingerprint(uuid),public.zeya_direct_hire_formation_readiness(uuid),public.zeya_derive_direct_hire_formation_cross_decisions(),public.zeya_enforce_direct_hire_required_agenda_defer(),public.zeya_gate_direct_hire_formation_completion(),public.zeya_gate_direct_hire_working_session_text_completion(),public.zeya_finalize_direct_hire_formation_outcome(),public.zeya_preserve_direct_hire_formation_completion(),public.zeya_direct_hire_formation_outcome_is_current(uuid,uuid),public.zeya_prevent_direct_hire_formation_outcome_modification() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_direct_hire_formation_outcome_is_current(uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
