BEGIN;

ALTER TABLE public.dispatches
  ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN business_representation_id uuid REFERENCES public.business_representations(id) ON DELETE CASCADE,
  ADD COLUMN mission_id uuid REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  ADD COLUMN execution_context_id uuid REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  ADD COLUMN representation_version_id uuid REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  ADD COLUMN mandate_outcome_package_id uuid REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  ADD COLUMN lead_id uuid REFERENCES public.mission_leads(id) ON DELETE RESTRICT,
  ADD COLUMN worker_role text,
  ADD COLUMN channel text,
  ADD COLUMN preparation_operation_id uuid,
  ADD COLUMN source_fingerprint text,
  ADD COLUMN execution_allowed boolean;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_p25_contract_check CHECK (
    execution_context_id IS NULL OR (
      owner_id IS NOT NULL AND user_id=owner_id AND business_representation_id IS NOT NULL AND mission_id IS NOT NULL
      AND representation_version_id IS NOT NULL AND mandate_outcome_package_id IS NOT NULL AND lead_id IS NOT NULL
      AND worker_role IS NOT NULL AND worker_role='outbound_business_development_voice_worker' AND channel IS NOT NULL AND channel='phone'
      AND preparation_operation_id IS NOT NULL AND source_fingerprint IS NOT NULL AND source_fingerprint~'^[0-9a-f]{64}$'
      AND execution_allowed IS NOT NULL
    )
  );
CREATE UNIQUE INDEX dispatches_p25_owner_operation_unique ON public.dispatches(owner_id,preparation_operation_id) WHERE preparation_operation_id IS NOT NULL;
CREATE UNIQUE INDEX dispatches_p25_context_unique ON public.dispatches(execution_context_id) WHERE execution_context_id IS NOT NULL;

ALTER TABLE public.worker_briefs
  ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN business_representation_id uuid REFERENCES public.business_representations(id) ON DELETE CASCADE,
  ADD COLUMN operating_mission_id uuid REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  ADD COLUMN execution_context_id uuid REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  ADD COLUMN representation_version_id uuid REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  ADD COLUMN mandate_outcome_package_id uuid REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  ADD COLUMN lead_id uuid REFERENCES public.mission_leads(id) ON DELETE RESTRICT,
  ADD COLUMN worker_role text,
  ADD COLUMN channel text,
  ADD COLUMN brief_payload jsonb,
  ADD COLUMN source_fingerprint text,
  ADD COLUMN execution_allowed boolean;

ALTER TABLE public.worker_briefs
  ADD CONSTRAINT worker_briefs_p25_contract_check CHECK (
    execution_context_id IS NULL OR (
      owner_id IS NOT NULL AND business_representation_id IS NOT NULL AND operating_mission_id IS NOT NULL
      AND representation_version_id IS NOT NULL AND mandate_outcome_package_id IS NOT NULL AND lead_id IS NOT NULL
      AND worker_role IS NOT NULL AND worker_role='outbound_business_development_voice_worker' AND channel IS NOT NULL AND channel='phone'
      AND brief_payload IS NOT NULL AND jsonb_typeof(brief_payload)='object'
      AND source_fingerprint IS NOT NULL AND source_fingerprint~'^[0-9a-f]{64}$'
      AND execution_allowed IS NOT NULL
    )
  );
CREATE UNIQUE INDEX worker_briefs_p25_context_unique ON public.worker_briefs(execution_context_id) WHERE execution_context_id IS NOT NULL;

CREATE FUNCTION public.zeya_p25_preserve_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_brief public.worker_briefs%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.worker_brief_id IS NOT NULL THEN
      SELECT brief.* INTO v_brief FROM public.worker_briefs brief WHERE brief.id=NEW.worker_brief_id;
    END IF;
    IF NEW.execution_context_id IS NOT NULL THEN
      IF v_brief.id IS NULL OR v_brief.execution_context_id IS DISTINCT FROM NEW.execution_context_id
        OR v_brief.operating_mission_id IS DISTINCT FROM NEW.mission_id OR v_brief.owner_id IS DISTINCT FROM NEW.owner_id
        OR v_brief.source_fingerprint IS DISTINCT FROM NEW.source_fingerprint
        OR v_brief.execution_allowed IS DISTINCT FROM NEW.execution_allowed
      THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed dispatch brief lineage is incomplete'; END IF;
    ELSIF v_brief.execution_context_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed worker brief requires governed dispatch';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.execution_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed dispatch is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.execution_context_id IS NOT NULL THEN
    IF NOT OLD.execution_allowed THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch execution is prohibited'; END IF;
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.business_representation_id IS DISTINCT FROM OLD.business_representation_id
      OR NEW.mission_id IS DISTINCT FROM OLD.mission_id OR NEW.execution_context_id IS DISTINCT FROM OLD.execution_context_id
      OR NEW.representation_version_id IS DISTINCT FROM OLD.representation_version_id
      OR NEW.mandate_outcome_package_id IS DISTINCT FROM OLD.mandate_outcome_package_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
      OR NEW.worker_role IS DISTINCT FROM OLD.worker_role OR NEW.channel IS DISTINCT FROM OLD.channel
      OR NEW.preparation_operation_id IS DISTINCT FROM OLD.preparation_operation_id
      OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint OR NEW.execution_allowed IS DISTINCT FROM OLD.execution_allowed
      OR NEW.worker_brief_id IS DISTINCT FROM OLD.worker_brief_id OR NEW.agent_brief IS DISTINCT FROM OLD.agent_brief
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed dispatch lineage is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispatches_p25_preserve BEFORE INSERT OR UPDATE OR DELETE ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p25_preserve_dispatch();

CREATE FUNCTION public.zeya_p25_immutable_worker_brief() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.execution_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed worker brief is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER worker_briefs_p25_immutable BEFORE UPDATE OR DELETE ON public.worker_briefs
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p25_immutable_worker_brief();

CREATE FUNCTION public.zeya_prepare_governed_dispatch(p_owner_id uuid,p_mission_id uuid,p_operation_id uuid)
RETURNS TABLE(dispatch_id text,worker_brief_id text,replayed boolean,status text,execution_allowed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_mission public.operating_missions%ROWTYPE; v_context public.mission_execution_contexts%ROWTYPE;
  v_rep public.business_representations%ROWTYPE; v_lead public.mission_leads%ROWTYPE;
  v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE; v_existing public.dispatches%ROWTYPE;
  v_existing_brief public.worker_briefs%ROWTYPE;
  v_dispatch_id text; v_brief_id text; v_worker_role text:='outbound_business_development_voice_worker';
  v_execution_allowed boolean; v_source_fingerprint text; v_brief jsonb; v_phone text; v_offer text; v_audience text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid dispatch'; END IF;

  SELECT mission.* INTO v_mission FROM public.operating_missions mission
  WHERE mission.id=p_mission_id AND mission.owner_id=p_owner_id FOR UPDATE;
  IF v_mission.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='mission not found'; END IF;
  IF v_mission.status<>'ready' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission is not ready for dispatch'; END IF;

  SELECT context.* INTO v_context FROM public.mission_execution_contexts context
  WHERE context.mission_id=v_mission.id AND context.owner_id=p_owner_id;
  SELECT representation.* INTO v_rep FROM public.business_representations representation
  WHERE representation.id=v_mission.business_representation_id AND representation.user_id=p_owner_id FOR SHARE;
  SELECT lead.* INTO v_lead FROM public.mission_leads lead
  WHERE lead.id=v_mission.lead_id AND lead.business_representation_id=v_mission.business_representation_id FOR SHARE;
  SELECT outcome.* INTO v_outcome FROM public.direct_hire_formation_outcome_packages outcome
  WHERE outcome.id=v_mission.mandate_outcome_package_id AND outcome.owner_id=p_owner_id
    AND outcome.business_representation_id=v_mission.business_representation_id;

  IF v_context.id IS NULL OR v_context.context_contract_version<>'operating-execution-context-v1'
    OR v_context.business_representation_id IS DISTINCT FROM v_mission.business_representation_id
    OR v_context.representation_version_id IS DISTINCT FROM v_mission.representation_version_id
    OR v_context.mandate_outcome_package_id IS DISTINCT FROM v_mission.mandate_outcome_package_id
    OR v_context.context#>>'{mission,missionId}' IS DISTINCT FROM v_mission.id::text
    OR v_context.context#>>'{target,leadId}' IS DISTINCT FROM v_mission.lead_id::text
    OR v_context.context#>>'{representation,versionId}' IS DISTINCT FROM v_mission.representation_version_id::text
    OR v_context.context->'constraints' IS DISTINCT FROM v_mission.constraints
    OR v_rep.id IS NULL OR v_rep.current_version_id IS DISTINCT FROM v_mission.representation_version_id
    OR v_lead.id IS NULL OR v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead)
    OR v_outcome.id IS NULL OR v_outcome.outcome_fingerprint IS DISTINCT FROM v_mission.mandate_fingerprint
    OR v_outcome.readiness_result->>'ready'<>'true'
    OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)
    OR v_context.context_fingerprint IS DISTINCT FROM encode(extensions.digest(convert_to(v_context.context::text,'UTF8'),'sha256'),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared mission lineage is stale'; END IF;

  IF v_mission.allowed_channel<>'phone' OR nullif(btrim(coalesce(v_context.context#>>'{target,phone}','')),'') IS NULL
    OR (v_mission.constraints ? 'doNotExecute' AND jsonb_typeof(v_mission.constraints->'doNotExecute')<>'boolean')
    OR (v_mission.constraints ? 'qaOnly' AND jsonb_typeof(v_mission.constraints->'qaOnly')<>'boolean')
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission constraints do not permit dispatch preparation'; END IF;

  v_offer:=nullif(btrim(coalesce(v_context.context#>>'{representation,values,whatYouSell,value}','')),'');
  v_audience:=nullif(btrim(coalesce(v_context.context#>>'{representation,values,whoItIsFor,value}','')),'');
  IF v_offer IS NULL OR v_audience IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='approved Representation values are incomplete';
  END IF;

  v_execution_allowed:=NOT coalesce((v_mission.constraints->>'doNotExecute')::boolean,false);
  v_source_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'missionId',v_mission.id,'executionContextId',v_context.id,'contextFingerprint',v_context.context_fingerprint,
    'representationVersionId',v_mission.representation_version_id,'mandateOutcomePackageId',v_mission.mandate_outcome_package_id,
    'leadId',v_mission.lead_id,'workerRole',v_worker_role,'channel',v_mission.allowed_channel,
    'executionAllowed',v_execution_allowed
  )::text,'UTF8'),'sha256'),'hex');

  SELECT dispatch.* INTO v_existing FROM public.dispatches dispatch
  WHERE dispatch.owner_id=p_owner_id AND dispatch.preparation_operation_id=p_operation_id;
  IF v_existing.id IS NOT NULL THEN
    SELECT brief.* INTO v_existing_brief FROM public.worker_briefs brief WHERE brief.id=v_existing.worker_brief_id;
    IF v_existing.mission_id IS DISTINCT FROM v_mission.id OR v_existing.execution_context_id IS DISTINCT FROM v_context.id
      OR v_existing.representation_version_id IS DISTINCT FROM v_mission.representation_version_id
      OR v_existing.mandate_outcome_package_id IS DISTINCT FROM v_mission.mandate_outcome_package_id
      OR v_existing.lead_id IS DISTINCT FROM v_mission.lead_id OR v_existing.worker_role IS DISTINCT FROM v_worker_role
      OR v_existing.channel IS DISTINCT FROM v_mission.allowed_channel OR v_existing.source_fingerprint IS DISTINCT FROM v_source_fingerprint
      OR v_existing.execution_allowed IS DISTINCT FROM v_execution_allowed OR v_existing.worker_brief_id IS NULL OR v_existing.status<>'draft'
      OR v_existing_brief.id IS NULL OR v_existing_brief.operating_mission_id IS DISTINCT FROM v_mission.id
      OR v_existing_brief.execution_context_id IS DISTINCT FROM v_context.id
      OR v_existing_brief.source_fingerprint IS DISTINCT FROM v_source_fingerprint
      OR v_existing_brief.execution_allowed IS DISTINCT FROM v_execution_allowed
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch operation conflicts'; END IF;
    v_dispatch_id:=v_existing.dispatch_id; v_brief_id:=v_existing.worker_brief_id;
    RETURN QUERY SELECT v_dispatch_id,v_brief_id,true,'draft'::text,v_execution_allowed; RETURN;
  END IF;

  v_dispatch_id:='p25_dispatch_'||replace(gen_random_uuid()::text,'-','');
  v_brief_id:='p25_brief_'||replace(gen_random_uuid()::text,'-','');
  v_phone:=v_context.context#>>'{target,phone}';
  v_brief:=jsonb_build_object(
    'contractVersion','governed-worker-brief-v1',
    'who',v_context.context->'target',
    'what',jsonb_build_object('offer',v_offer,'audience',v_audience),
    'why',jsonb_build_object('objective',v_context.context#>'{mission,objective}','qualificationGoal',v_context.context#>'{mission,qualificationGoal}'),
    'desiredNextStep',v_context.context#>'{mission,desiredNextStep}',
    'authority',v_context.context#>'{mandate,authority}',
    'constraints',v_context.context->'constraints',
    'dispatch',jsonb_build_object('workerRole',v_worker_role,'channel',v_mission.allowed_channel,'executionAllowed',v_execution_allowed)
  );

  INSERT INTO public.worker_briefs(id,mission_id,business_id,target_name,target_phone,objective,desired_outcome,company_context,lead_context,
    key_questions,objection_guidance,escalation_rules,tone_guidance,success_criteria,dynamic_variables,owner_id,business_representation_id,
    operating_mission_id,execution_context_id,representation_version_id,mandate_outcome_package_id,lead_id,worker_role,channel,brief_payload,
    source_fingerprint,execution_allowed)
  VALUES(v_brief_id,v_mission.id::text,v_mission.business_id,v_context.context#>>'{target,contactName}',v_phone,v_context.context#>>'{mission,objective}',
    v_context.context#>>'{mission,desiredNextStep}',v_offer,v_audience,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL,NULL,'{}'::jsonb,p_owner_id,
    v_mission.business_representation_id,v_mission.id,v_context.id,v_mission.representation_version_id,v_mission.mandate_outcome_package_id,
    v_mission.lead_id,v_worker_role,v_mission.allowed_channel,v_brief,v_source_fingerprint,v_execution_allowed);

  INSERT INTO public.dispatches(dispatch_id,user_id,visitor_name,phone_number,business_offer,target_buyer,agent_brief,status,source,metadata,
    worker_brief_id,owner_id,business_representation_id,mission_id,execution_context_id,representation_version_id,
    mandate_outcome_package_id,lead_id,worker_role,channel,preparation_operation_id,source_fingerprint,execution_allowed)
  VALUES(v_dispatch_id,p_owner_id,coalesce(v_context.context#>>'{target,contactName}',v_context.context#>>'{target,companyName}'),v_phone,
    v_offer,v_audience,v_brief,'draft','p25_governed_operating_mission',jsonb_build_object('qaOnly',coalesce((v_mission.constraints->>'qaOnly')::boolean,false)),
    v_brief_id,p_owner_id,v_mission.business_representation_id,v_mission.id,v_context.id,v_mission.representation_version_id,
    v_mission.mandate_outcome_package_id,v_mission.lead_id,v_worker_role,v_mission.allowed_channel,p_operation_id,v_source_fingerprint,v_execution_allowed);

  RETURN QUERY SELECT v_dispatch_id,v_brief_id,false,'draft'::text,v_execution_allowed;
END $$;

ALTER FUNCTION public.zeya_prepare_governed_dispatch(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_prepare_governed_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_prepare_governed_dispatch(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
