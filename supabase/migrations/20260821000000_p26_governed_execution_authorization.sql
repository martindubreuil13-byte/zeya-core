BEGIN;

CREATE TABLE public.governed_execution_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dispatch_id text NOT NULL REFERENCES public.dispatches(dispatch_id) ON DELETE RESTRICT,
  worker_brief_id text NOT NULL REFERENCES public.worker_briefs(id) ON DELETE RESTRICT,
  mission_id uuid NOT NULL REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  execution_context_id uuid NOT NULL REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  representation_version_id uuid NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  mandate_outcome_package_id uuid NOT NULL REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.mission_leads(id) ON DELETE RESTRICT,
  authorization_operation_id uuid NOT NULL, source_fingerprint text NOT NULL CHECK(source_fingerprint~'^[0-9a-f]{64}$'),
  authorized_channel text NOT NULL CHECK(authorized_channel='phone'),
  authorized_worker_role text NOT NULL CHECK(authorized_worker_role='outbound_business_development_voice_worker'),
  purpose text NOT NULL CHECK(purpose='controlled_preview_voice_qa'),
  status text NOT NULL DEFAULT 'authorized' CHECK(status IN ('authorized','consumed')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),consumed_at timestamptz,
  UNIQUE(owner_id,authorization_operation_id),UNIQUE(dispatch_id)
);

CREATE TABLE public.governed_execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),authorization_id uuid NOT NULL UNIQUE REFERENCES public.governed_execution_authorizations(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,dispatch_id text NOT NULL REFERENCES public.dispatches(dispatch_id) ON DELETE RESTRICT,
  worker_brief_id text NOT NULL REFERENCES public.worker_briefs(id) ON DELETE RESTRICT,mission_id uuid NOT NULL REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  execution_context_id uuid NOT NULL REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  representation_version_id uuid NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  mandate_outcome_package_id uuid NOT NULL REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.mission_leads(id) ON DELETE RESTRICT,execution_operation_id uuid NOT NULL,
  source_fingerprint text NOT NULL CHECK(source_fingerprint~'^[0-9a-f]{64}$'),target_fingerprint text NOT NULL CHECK(target_fingerprint~'^[0-9a-f]{64}$'),provider text NOT NULL CHECK(provider='elevenlabs'),
  status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','dispatched','failed')),
  provider_call_id text,conversation_id text,error_code text,claimed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  started_at timestamptz,completed_at timestamptz,UNIQUE(owner_id,execution_operation_id)
);

ALTER TABLE public.governed_execution_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governed_execution_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY governed_execution_authorizations_owner_select ON public.governed_execution_authorizations FOR SELECT USING(owner_id=auth.uid());
CREATE POLICY governed_execution_attempts_owner_select ON public.governed_execution_attempts FOR SELECT USING(owner_id=auth.uid());
REVOKE ALL ON public.governed_execution_authorizations,public.governed_execution_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.governed_execution_authorizations,public.governed_execution_attempts TO authenticated;
GRANT ALL ON public.governed_execution_authorizations,public.governed_execution_attempts TO service_role;

CREATE FUNCTION public.zeya_p26_dispatch_is_current(p_owner_id uuid,p_dispatch_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dispatches%ROWTYPE; b public.worker_briefs%ROWTYPE; m public.operating_missions%ROWTYPE;
  c public.mission_execution_contexts%ROWTYPE; r public.business_representations%ROWTYPE;
  l public.mission_leads%ROWTYPE; o public.direct_hire_formation_outcome_packages%ROWTYPE;
BEGIN
  SELECT x.* INTO d FROM public.dispatches x WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id;
  IF d.id IS NULL OR d.execution_context_id IS NULL OR d.status<>'draft' OR d.execution_allowed IS DISTINCT FROM false
    OR d.worker_role<>'outbound_business_development_voice_worker' OR d.channel<>'phone' THEN RETURN false; END IF;
  SELECT x.* INTO b FROM public.worker_briefs x WHERE x.id=d.worker_brief_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO m FROM public.operating_missions x WHERE x.id=d.mission_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO c FROM public.mission_execution_contexts x WHERE x.id=d.execution_context_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO r FROM public.business_representations x WHERE x.id=d.business_representation_id AND x.user_id=p_owner_id;
  SELECT x.* INTO l FROM public.mission_leads x WHERE x.id=d.lead_id AND x.business_representation_id=d.business_representation_id;
  SELECT x.* INTO o FROM public.direct_hire_formation_outcome_packages x WHERE x.id=d.mandate_outcome_package_id AND x.owner_id=p_owner_id;
  RETURN b.id IS NOT NULL AND b.execution_allowed IS DISTINCT FROM true AND b.source_fingerprint=d.source_fingerprint
    AND b.operating_mission_id=d.mission_id AND b.execution_context_id=d.execution_context_id
    AND b.representation_version_id=d.representation_version_id AND b.mandate_outcome_package_id=d.mandate_outcome_package_id AND b.lead_id=d.lead_id
    AND m.id IS NOT NULL AND m.status='ready' AND m.representation_version_id=d.representation_version_id
    AND m.mandate_outcome_package_id=d.mandate_outcome_package_id AND m.lead_id=d.lead_id
    AND c.id IS NOT NULL AND c.context_contract_version='operating-execution-context-v1'
    AND c.context_fingerprint=encode(extensions.digest(convert_to(c.context::text,'UTF8'),'sha256'),'hex')
    AND r.id IS NOT NULL AND r.current_version_id=d.representation_version_id
    AND l.id IS NOT NULL AND m.lead_fingerprint=public.zeya_p24_lead_fingerprint(l)
    AND o.id IS NOT NULL AND o.outcome_fingerprint=m.mandate_fingerprint AND o.readiness_result->>'ready'='true'
    AND public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,o.id)
    AND coalesce(b.brief_payload#>>'{authority,pricing,disposition}','')='owner_approval_required'
    AND coalesce(b.brief_payload#>>'{authority,discounts,disposition}','')='owner_approval_required'
    AND coalesce(b.brief_payload#>>'{authority,negotiation,disposition}','')='prohibited'
    AND coalesce(b.brief_payload#>>'{authority,commitments,disposition}','')='prohibited'
    AND coalesce(b.brief_payload#>>'{authority,meetingBooking,disposition}','')='allowed_within_bounds'
    AND coalesce(b.brief_payload#>>'{authority,escalation,disposition}','')='owner_approval_required'
    AND nullif(btrim(coalesce(c.context#>>'{mandate,commercial,qualificationThreshold}','')),'') IS NOT NULL
    AND nullif(btrim(coalesce(c.context#>>'{mandate,commercial,meetingObjective}','')),'') IS NOT NULL;
END $$;

CREATE FUNCTION public.zeya_authorize_governed_execution(p_owner_id uuid,p_dispatch_id text,p_operation_id uuid,p_purpose text)
RETURNS TABLE(authorization_id uuid,replayed boolean,status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dispatches%ROWTYPE; a public.governed_execution_authorizations%ROWTYPE; fp text; aid uuid; astat text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL OR p_purpose<>'controlled_preview_voice_qa' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid execution authorization'; END IF;
  SELECT x.* INTO d FROM public.dispatches x WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='dispatch not found'; END IF;
  IF NOT public.zeya_p26_dispatch_is_current(p_owner_id,p_dispatch_id) THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed dispatch lineage is stale'; END IF;
  IF EXISTS(SELECT 1 FROM public.voice_conversation_outputs x WHERE x.mission_id=d.mission_id::text)
    OR EXISTS(SELECT 1 FROM public.mission_execution_outcomes x WHERE x.mission_id=d.mission_id)
    OR EXISTS(SELECT 1 FROM public.dispatch_events x WHERE x.dispatch_id=d.dispatch_id)
    OR EXISTS(SELECT 1 FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=d.worker_brief_id) OR d.call_outcome_id IS NOT NULL
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch already has execution artifacts'; END IF;
  fp:=encode(extensions.digest(convert_to(d.source_fingerprint||'|'||p_purpose,'UTF8'),'sha256'),'hex');
  SELECT x.* INTO a FROM public.governed_execution_authorizations x WHERE x.owner_id=p_owner_id AND x.authorization_operation_id=p_operation_id;
  IF a.id IS NOT NULL THEN
    IF a.dispatch_id<>p_dispatch_id OR a.purpose<>p_purpose OR a.source_fingerprint<>fp THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='authorization operation conflicts'; END IF;
    aid:=a.id; astat:=a.status; RETURN QUERY SELECT aid,true,astat; RETURN;
  END IF;
  INSERT INTO public.governed_execution_authorizations(owner_id,dispatch_id,worker_brief_id,mission_id,execution_context_id,representation_version_id,
    mandate_outcome_package_id,lead_id,authorization_operation_id,source_fingerprint,authorized_channel,authorized_worker_role,purpose)
  VALUES(p_owner_id,d.dispatch_id,d.worker_brief_id,d.mission_id,d.execution_context_id,d.representation_version_id,d.mandate_outcome_package_id,
    d.lead_id,p_operation_id,fp,d.channel,d.worker_role,p_purpose) RETURNING id INTO aid;
  RETURN QUERY SELECT aid,false,'authorized'::text;
END $$;

CREATE FUNCTION public.zeya_claim_governed_execution(p_owner_id uuid,p_dispatch_id text,p_authorization_id uuid,p_operation_id uuid,p_target_fingerprint text)
RETURNS TABLE(attempt_id uuid,claimed boolean,replayed boolean,status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dispatches%ROWTYPE; a public.governed_execution_authorizations%ROWTYPE; e public.governed_execution_attempts%ROWTYPE; fp text; eid uuid; estat text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL OR p_target_fingerprint!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid execution'; END IF;
  SELECT x.* INTO a FROM public.governed_execution_authorizations x WHERE x.id=p_authorization_id AND x.owner_id=p_owner_id FOR UPDATE;
  IF a.id IS NULL OR a.dispatch_id<>p_dispatch_id THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='authorization not found'; END IF;
  SELECT x.* INTO e FROM public.governed_execution_attempts x WHERE x.owner_id=p_owner_id AND x.execution_operation_id=p_operation_id;
  IF e.id IS NOT NULL THEN
    IF e.authorization_id<>a.id OR e.dispatch_id<>p_dispatch_id OR e.target_fingerprint<>p_target_fingerprint THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='execution operation conflicts'; END IF;
    eid:=e.id; estat:=e.status; RETURN QUERY SELECT eid,false,true,estat; RETURN;
  END IF;
  IF a.status<>'authorized' OR NOT public.zeya_p26_dispatch_is_current(p_owner_id,p_dispatch_id) THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='execution authorization is not usable'; END IF;
  SELECT x.* INTO d FROM public.dispatches x WHERE x.dispatch_id=p_dispatch_id;
  IF EXISTS(SELECT 1 FROM public.voice_conversation_outputs x WHERE x.mission_id=d.mission_id::text)
    OR EXISTS(SELECT 1 FROM public.mission_execution_outcomes x WHERE x.mission_id=d.mission_id)
    OR EXISTS(SELECT 1 FROM public.dispatch_events x WHERE x.dispatch_id=d.dispatch_id)
    OR EXISTS(SELECT 1 FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=d.worker_brief_id) OR d.call_outcome_id IS NOT NULL
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch already has execution artifacts'; END IF;
  fp:=encode(extensions.digest(convert_to(a.source_fingerprint||'|'||p_operation_id::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.governed_execution_attempts(authorization_id,owner_id,dispatch_id,worker_brief_id,mission_id,execution_context_id,
    representation_version_id,mandate_outcome_package_id,lead_id,execution_operation_id,source_fingerprint,target_fingerprint,provider)
  VALUES(a.id,p_owner_id,d.dispatch_id,d.worker_brief_id,d.mission_id,d.execution_context_id,d.representation_version_id,
    d.mandate_outcome_package_id,d.lead_id,p_operation_id,fp,p_target_fingerprint,'elevenlabs') RETURNING id INTO eid;
  UPDATE public.governed_execution_authorizations x SET status='consumed',consumed_at=pg_catalog.now() WHERE x.id=a.id AND x.status='authorized';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='authorization changed concurrently'; END IF;
  RETURN QUERY SELECT eid,true,false,'claimed'::text;
END $$;

CREATE FUNCTION public.zeya_complete_governed_execution(p_owner_id uuid,p_attempt_id uuid,p_status text,p_provider_call_id text,p_conversation_id text,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role()<>'service_role' OR p_status NOT IN ('dispatched','failed') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  UPDATE public.governed_execution_attempts x SET status=p_status,provider_call_id=nullif(p_provider_call_id,''),conversation_id=nullif(p_conversation_id,''),
    error_code=nullif(p_error_code,''),started_at=coalesce(x.started_at,pg_catalog.now()),completed_at=CASE WHEN p_status='failed' THEN pg_catalog.now() ELSE NULL END
  WHERE x.id=p_attempt_id AND x.owner_id=p_owner_id AND x.status='claimed';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='execution attempt is not completable'; END IF;
END $$;

CREATE FUNCTION public.zeya_validate_governed_execution_claim(p_owner_id uuid,p_worker_brief_id text,p_authorization_id uuid,p_attempt_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.governed_execution_attempts e JOIN public.governed_execution_authorizations a ON a.id=e.authorization_id
    WHERE e.id=p_attempt_id AND e.authorization_id=p_authorization_id AND e.owner_id=p_owner_id AND e.worker_brief_id=p_worker_brief_id
      AND e.status='claimed' AND a.status='consumed' AND public.zeya_p26_dispatch_is_current(p_owner_id,e.dispatch_id))
$$;

CREATE FUNCTION public.zeya_p26_preserve_authorization() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id OR NEW.worker_brief_id<>OLD.worker_brief_id
    OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id OR NEW.representation_version_id<>OLD.representation_version_id
    OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id
    OR NEW.authorization_operation_id<>OLD.authorization_operation_id OR NEW.source_fingerprint<>OLD.source_fingerprint
    OR NEW.authorized_channel<>OLD.authorized_channel OR NEW.authorized_worker_role<>OLD.authorized_worker_role OR NEW.purpose<>OLD.purpose
    OR NOT(OLD.status='authorized' AND NEW.status='consumed' AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution authorization is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER governed_execution_authorization_preserve BEFORE UPDATE OR DELETE ON public.governed_execution_authorizations FOR EACH ROW EXECUTE FUNCTION public.zeya_p26_preserve_authorization();
CREATE FUNCTION public.zeya_p26_preserve_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.authorization_id<>OLD.authorization_id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id
    OR NEW.worker_brief_id<>OLD.worker_brief_id OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id
    OR NEW.representation_version_id<>OLD.representation_version_id OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id
    OR NEW.execution_operation_id<>OLD.execution_operation_id OR NEW.source_fingerprint<>OLD.source_fingerprint OR NEW.target_fingerprint<>OLD.target_fingerprint OR NEW.provider<>OLD.provider
    OR OLD.status<>'claimed' OR NEW.status NOT IN ('dispatched','failed') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution attempt is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER governed_execution_attempt_preserve BEFORE UPDATE OR DELETE ON public.governed_execution_attempts FOR EACH ROW EXECUTE FUNCTION public.zeya_p26_preserve_attempt();

ALTER FUNCTION public.zeya_authorize_governed_execution(uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_claim_governed_execution(uuid,text,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_validate_governed_execution_claim(uuid,text,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.zeya_p26_dispatch_is_current(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_authorize_governed_execution(uuid,text,uuid,text),public.zeya_claim_governed_execution(uuid,text,uuid,uuid,text),public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text),public.zeya_validate_governed_execution_claim(uuid,text,uuid,uuid),public.zeya_p26_dispatch_is_current(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_authorize_governed_execution(uuid,text,uuid,text),public.zeya_claim_governed_execution(uuid,text,uuid,uuid,text),public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text),public.zeya_validate_governed_execution_claim(uuid,text,uuid,uuid),public.zeya_p26_dispatch_is_current(uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
