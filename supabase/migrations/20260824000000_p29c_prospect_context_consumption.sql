BEGIN;

ALTER TABLE public.mission_execution_contexts DROP CONSTRAINT mission_execution_contexts_context_contract_version_check;
ALTER TABLE public.mission_execution_contexts ADD CONSTRAINT mission_execution_contexts_context_contract_version_check
  CHECK(context_contract_version IN ('operating-execution-context-v1','operating-execution-context-v2'));

CREATE FUNCTION public.zeya_p29c_prospect_memory_fingerprint(p_owner_id uuid,p_lead_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_lead public.mission_leads%ROWTYPE; v_source jsonb;
BEGIN
  SELECT l.* INTO v_lead FROM public.mission_leads l JOIN public.business_representations r ON r.id=l.business_representation_id
  WHERE l.id=p_lead_id AND r.user_id=p_owner_id;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='lead not found'; END IF;
  SELECT jsonb_build_object(
    'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.prospect_observations o WHERE o.owner_id=p_owner_id AND o.lead_id=p_lead_id),'[]'::jsonb),
    'relations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.prospect_observation_relations r WHERE r.owner_id=p_owner_id AND r.lead_id=p_lead_id),'[]'::jsonb),
    'outcomes',coalesce((SELECT jsonb_agg(jsonb_build_object('outcome',to_jsonb(x),'interpretation',i.interpretation) ORDER BY x.id)
      FROM public.mission_execution_outcomes x JOIN public.operating_missions m ON m.id=x.mission_id
      LEFT JOIN public.conversation_interpretations i ON i.id=x.result_operation_id AND i.tenant_user_id=p_owner_id
      WHERE x.owner_id=p_owner_id AND m.lead_id=p_lead_id),'[]'::jsonb)
  ) INTO v_source;
  RETURN encode(extensions.digest(convert_to(v_source::text,'UTF8'),'sha256'),'hex');
END $$;
REVOKE ALL ON FUNCTION public.zeya_p29c_prospect_memory_fingerprint(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_p29c_prospect_memory_fingerprint(uuid,uuid) TO service_role;

CREATE FUNCTION public.zeya_prepare_operating_mission_v2(p_owner_id uuid,p_mission_id uuid,p_prospect_context jsonb,p_prospect_source_fingerprint text)
RETURNS TABLE(mission_id uuid,context_id uuid,replayed boolean,status text,execution_context jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_mission public.operating_missions%ROWTYPE; v_rep public.business_representations%ROWTYPE; v_lead public.mission_leads%ROWTYPE;
  v_version public.representation_versions%ROWTYPE; v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE;
  v_context_id uuid; v_existing_context jsonb; v_context_owner_id uuid; v_context_representation_id uuid;
  v_context_version_id uuid; v_context_mandate_id uuid; v_context jsonb; v_fingerprint text; v_current_memory_fingerprint text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_mission FROM public.operating_missions WHERE id=p_mission_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_mission.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='mission not found'; END IF;
  SELECT * INTO v_rep FROM public.business_representations WHERE id=v_mission.business_representation_id AND user_id=p_owner_id FOR SHARE;
  SELECT * INTO v_lead FROM public.mission_leads WHERE id=v_mission.lead_id AND business_representation_id=v_rep.id FOR SHARE;
  SELECT * INTO v_version FROM public.representation_versions WHERE id=v_mission.representation_version_id AND business_representation_id=v_rep.id;
  SELECT * INTO v_outcome FROM public.direct_hire_formation_outcome_packages WHERE id=v_mission.mandate_outcome_package_id AND owner_id=p_owner_id AND business_representation_id=v_rep.id;
  IF v_rep.id IS NULL OR v_lead.id IS NULL OR v_version.id IS NULL OR v_outcome.id IS NULL OR v_rep.current_version_id IS DISTINCT FROM v_mission.representation_version_id
    OR v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead) OR v_mission.mandate_fingerprint IS DISTINCT FROM v_outcome.outcome_fingerprint
    OR v_outcome.readiness_result->>'ready'<>'true' OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission source lineage is stale'; END IF;
  IF p_prospect_context#>>'{schemaVersion}'<>'prospect-context-v1' OR p_prospect_context#>>'{leadId}'<>v_lead.id::text
    OR p_prospect_context#>>'{provenance,projectionVersion}'<>'prospect-context-projection-v1'
    OR p_prospect_context#>>'{provenance,sourceFingerprint}' IS DISTINCT FROM p_prospect_source_fingerprint
    OR p_prospect_source_fingerprint!~'^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid prospect context'; END IF;
  v_current_memory_fingerprint:=public.zeya_p29c_prospect_memory_fingerprint(p_owner_id,v_lead.id);
  IF v_current_memory_fingerprint IS DISTINCT FROM p_prospect_source_fingerprint THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect context is stale'; END IF;
  SELECT c.id,c.context,c.owner_id,c.business_representation_id,c.representation_version_id,c.mandate_outcome_package_id
  INTO v_context_id,v_existing_context,v_context_owner_id,v_context_representation_id,v_context_version_id,v_context_mandate_id
  FROM public.mission_execution_contexts c WHERE c.mission_id=v_mission.id;
  IF v_context_id IS NOT NULL THEN
    IF v_mission.status<>'ready' OR v_context_owner_id<>p_owner_id OR v_context_representation_id<>v_mission.business_representation_id
      OR v_context_version_id<>v_mission.representation_version_id OR v_context_mandate_id<>v_mission.mandate_outcome_package_id
      OR v_existing_context->'prospectContext' IS DISTINCT FROM p_prospect_context
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared context lineage is incomplete'; END IF;
    RETURN QUERY SELECT p_mission_id,v_context_id,true,'ready'::text,v_existing_context; RETURN;
  END IF;
  IF v_mission.status<>'draft' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission is not preparable'; END IF;
  v_context:=jsonb_build_object(
    'contractVersion','operating-execution-context-v2',
    'target',jsonb_build_object('leadId',v_lead.id,'companyName',v_lead.company_name,'contactName',v_lead.contact_name,'phone',v_lead.phone,'email',v_lead.email,'source',v_lead.source,'notes',v_lead.notes),
    'representation',jsonb_build_object('businessRepresentationId',v_rep.id,'versionId',v_version.id,'values',v_version.element_values),
    'mission',jsonb_build_object('missionId',v_mission.id,'objective',v_mission.objective,'qualificationGoal',v_mission.qualification_goal,'desiredNextStep',v_mission.desired_next_step,'channel',v_mission.allowed_channel,'priority',v_mission.priority,'notes',v_mission.notes),
    'mandate',jsonb_build_object('commercial',jsonb_build_object('immediateBdObjective',v_outcome.outcome#>'{commercial,immediate_bd_goal,value}','qualificationThreshold',v_outcome.outcome#>'{commercial,qualification_threshold,value}','meetingObjective',v_outcome.outcome#>'{commercial,meeting_objective,value}'),'authority',jsonb_build_object(
      'pricing',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_pricing,disposition}','value',v_outcome.outcome#>'{authority,authority_pricing,value}'),
      'discounts',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_discounts,disposition}','value',v_outcome.outcome#>'{authority,authority_discounts,value}'),
      'negotiation',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_negotiation,disposition}','value',v_outcome.outcome#>'{authority,authority_negotiation,value}'),
      'commitments',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_customer_commitments,disposition}','value',v_outcome.outcome#>'{authority,authority_customer_commitments,value}'),
      'meetingBooking',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_meeting_booking,disposition}','value',v_outcome.outcome#>'{authority,authority_meeting_booking,value}'),
      'ownerApproval',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_owner_approval_required,disposition}','value',v_outcome.outcome#>'{authority,authority_owner_approval_required,value}'),
      'escalation',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_escalation_rules,disposition}','value',v_outcome.outcome#>'{authority,authority_escalation_rules,value}'),
      'prohibitedClaims',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_prohibited_claims,disposition}','value',v_outcome.outcome#>'{authority,authority_prohibited_claims,value}'))),
    'prospectContext',p_prospect_context,'constraints',v_mission.constraints);
  v_fingerprint:=encode(extensions.digest(convert_to(v_context::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.mission_execution_contexts AS inserted(mission_id,owner_id,business_representation_id,representation_version_id,mandate_outcome_package_id,context_contract_version,context,context_fingerprint)
  VALUES(v_mission.id,p_owner_id,v_rep.id,v_version.id,v_outcome.id,'operating-execution-context-v2',v_context,v_fingerprint) RETURNING inserted.id INTO v_context_id;
  UPDATE public.operating_missions SET status='ready',updated_at=pg_catalog.now() WHERE id=v_mission.id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='mission changed concurrently'; END IF;
  RETURN QUERY SELECT p_mission_id,v_context_id,false,'ready'::text,v_context;
END $$;
REVOKE ALL ON FUNCTION public.zeya_prepare_operating_mission_v2(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_prepare_operating_mission_v2(uuid,uuid,jsonb,text) TO service_role;

-- V2 currentness is checked at every pre-provider governance boundary.
CREATE FUNCTION public.zeya_p29c_context_memory_is_current(p_owner_id uuid,p_context_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN c.context_contract_version='operating-execution-context-v1' THEN true
    WHEN c.context_contract_version='operating-execution-context-v2' THEN
      c.context#>>'{prospectContext,provenance,sourceFingerprint}'=public.zeya_p29c_prospect_memory_fingerprint(p_owner_id,m.lead_id)
    ELSE false END
  FROM public.mission_execution_contexts c JOIN public.operating_missions m ON m.id=c.mission_id
  WHERE c.id=p_context_id AND c.owner_id=p_owner_id AND m.owner_id=p_owner_id
$$;
REVOKE ALL ON FUNCTION public.zeya_p29c_context_memory_is_current(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_p29c_context_memory_is_current(uuid,uuid) TO service_role;

CREATE FUNCTION public.zeya_prepare_governed_dispatch_v2(p_owner_id uuid,p_mission_id uuid,p_operation_id uuid)
RETURNS TABLE(dispatch_id text,worker_brief_id text,replayed boolean,status text,execution_allowed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.operating_missions%ROWTYPE; c public.mission_execution_contexts%ROWTYPE; r public.business_representations%ROWTYPE;
  l public.mission_leads%ROWTYPE; o public.direct_hire_formation_outcome_packages%ROWTYPE; d public.dispatches%ROWTYPE; b public.worker_briefs%ROWTYPE;
  did text; bid text; role text:='outbound_business_development_voice_worker'; allowed boolean; fp text; brief jsonb; phone text; offer text; audience text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid dispatch'; END IF;
  SELECT x.* INTO m FROM public.operating_missions x WHERE x.id=p_mission_id AND x.owner_id=p_owner_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='mission not found'; END IF;
  IF m.status<>'ready' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission is not ready for dispatch'; END IF;
  SELECT x.* INTO c FROM public.mission_execution_contexts x WHERE x.mission_id=m.id AND x.owner_id=p_owner_id;
  SELECT x.* INTO r FROM public.business_representations x WHERE x.id=m.business_representation_id AND x.user_id=p_owner_id FOR SHARE;
  SELECT x.* INTO l FROM public.mission_leads x WHERE x.id=m.lead_id AND x.business_representation_id=m.business_representation_id FOR SHARE;
  SELECT x.* INTO o FROM public.direct_hire_formation_outcome_packages x WHERE x.id=m.mandate_outcome_package_id AND x.owner_id=p_owner_id AND x.business_representation_id=m.business_representation_id;
  IF c.id IS NULL OR c.context_contract_version<>'operating-execution-context-v2' OR c.business_representation_id IS DISTINCT FROM m.business_representation_id
    OR c.representation_version_id IS DISTINCT FROM m.representation_version_id OR c.mandate_outcome_package_id IS DISTINCT FROM m.mandate_outcome_package_id
    OR c.context#>>'{mission,missionId}' IS DISTINCT FROM m.id::text OR c.context#>>'{target,leadId}' IS DISTINCT FROM m.lead_id::text
    OR c.context#>>'{representation,versionId}' IS DISTINCT FROM m.representation_version_id::text OR c.context->'constraints' IS DISTINCT FROM m.constraints
    OR r.id IS NULL OR r.current_version_id IS DISTINCT FROM m.representation_version_id OR l.id IS NULL OR m.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(l)
    OR o.id IS NULL OR o.outcome_fingerprint IS DISTINCT FROM m.mandate_fingerprint OR o.readiness_result->>'ready'<>'true'
    OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,o.id)
    OR c.context_fingerprint IS DISTINCT FROM encode(extensions.digest(convert_to(c.context::text,'UTF8'),'sha256'),'hex')
    OR NOT public.zeya_p29c_context_memory_is_current(p_owner_id,c.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared mission lineage is stale'; END IF;
  IF m.allowed_channel<>'phone' OR nullif(btrim(coalesce(c.context#>>'{target,phone}','')),'') IS NULL
    OR (m.constraints?'doNotExecute' AND jsonb_typeof(m.constraints->'doNotExecute')<>'boolean') OR (m.constraints?'qaOnly' AND jsonb_typeof(m.constraints->'qaOnly')<>'boolean')
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission constraints do not permit dispatch preparation'; END IF;
  offer:=nullif(btrim(coalesce(c.context#>>'{representation,values,whatYouSell,value}','')),''); audience:=nullif(btrim(coalesce(c.context#>>'{representation,values,whoItIsFor,value}','')),'');
  IF offer IS NULL OR audience IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='approved Representation values are incomplete'; END IF;
  allowed:=NOT coalesce((m.constraints->>'doNotExecute')::boolean,false);
  fp:=encode(extensions.digest(convert_to(jsonb_build_object('missionId',m.id,'executionContextId',c.id,'contextFingerprint',c.context_fingerprint,'representationVersionId',m.representation_version_id,'mandateOutcomePackageId',m.mandate_outcome_package_id,'leadId',m.lead_id,'workerRole',role,'channel',m.allowed_channel,'executionAllowed',allowed)::text,'UTF8'),'sha256'),'hex');
  SELECT x.* INTO d FROM public.dispatches x WHERE x.owner_id=p_owner_id AND x.preparation_operation_id=p_operation_id;
  IF d.id IS NOT NULL THEN
    SELECT x.* INTO b FROM public.worker_briefs x WHERE x.id=d.worker_brief_id;
    IF d.mission_id IS DISTINCT FROM m.id OR d.execution_context_id IS DISTINCT FROM c.id OR d.source_fingerprint IS DISTINCT FROM fp OR d.status<>'draft'
      OR b.id IS NULL OR b.execution_context_id IS DISTINCT FROM c.id OR b.source_fingerprint IS DISTINCT FROM fp
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch operation conflicts'; END IF;
    RETURN QUERY SELECT d.dispatch_id,d.worker_brief_id,true,'draft'::text,d.execution_allowed; RETURN;
  END IF;
  did:='p25_dispatch_'||replace(gen_random_uuid()::text,'-',''); bid:='p25_brief_'||replace(gen_random_uuid()::text,'-',''); phone:=c.context#>>'{target,phone}';
  brief:=jsonb_build_object('contractVersion','governed-worker-brief-v2','business',jsonb_build_object('representation',jsonb_build_object('offer',offer,'audience',audience)),
    'prospect',jsonb_build_object('identity',c.context->'target','context',c.context->'prospectContext'),
    'mission',jsonb_build_object('objective',c.context#>'{mission,objective}','qualificationGoal',c.context#>'{mission,qualificationGoal}','desiredNextStep',c.context#>'{mission,desiredNextStep}'),
    'authority',c.context#>'{mandate,authority}','constraints',c.context->'constraints','dispatch',jsonb_build_object('workerRole',role,'channel',m.allowed_channel,'executionAllowed',allowed));
  INSERT INTO public.worker_briefs(id,mission_id,business_id,target_name,target_phone,objective,desired_outcome,company_context,lead_context,key_questions,objection_guidance,escalation_rules,tone_guidance,success_criteria,dynamic_variables,owner_id,business_representation_id,operating_mission_id,execution_context_id,representation_version_id,mandate_outcome_package_id,lead_id,worker_role,channel,brief_payload,source_fingerprint,execution_allowed)
  VALUES(bid,m.id::text,m.business_id,c.context#>>'{target,contactName}',phone,c.context#>>'{mission,objective}',c.context#>>'{mission,desiredNextStep}',offer,audience,'[]','[]','[]',NULL,NULL,'{}',p_owner_id,m.business_representation_id,m.id,c.id,m.representation_version_id,m.mandate_outcome_package_id,m.lead_id,role,m.allowed_channel,brief,fp,allowed);
  INSERT INTO public.dispatches(dispatch_id,user_id,visitor_name,phone_number,business_offer,target_buyer,agent_brief,status,source,metadata,worker_brief_id,owner_id,business_representation_id,mission_id,execution_context_id,representation_version_id,mandate_outcome_package_id,lead_id,worker_role,channel,preparation_operation_id,source_fingerprint,execution_allowed)
  VALUES(did,p_owner_id,coalesce(c.context#>>'{target,contactName}',c.context#>>'{target,companyName}'),phone,offer,audience,brief,'draft','p29c_governed_operating_mission',jsonb_build_object('qaOnly',coalesce((m.constraints->>'qaOnly')::boolean,false)),bid,p_owner_id,m.business_representation_id,m.id,c.id,m.representation_version_id,m.mandate_outcome_package_id,m.lead_id,role,m.allowed_channel,p_operation_id,fp,allowed);
  RETURN QUERY SELECT did,bid,false,'draft'::text,allowed;
END $$;
REVOKE ALL ON FUNCTION public.zeya_prepare_governed_dispatch_v2(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_prepare_governed_dispatch_v2(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.zeya_p26_dispatch_is_current(p_owner_id uuid,p_dispatch_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dispatches%ROWTYPE; b public.worker_briefs%ROWTYPE; m public.operating_missions%ROWTYPE; c public.mission_execution_contexts%ROWTYPE;
  r public.business_representations%ROWTYPE; l public.mission_leads%ROWTYPE; o public.direct_hire_formation_outcome_packages%ROWTYPE;
BEGIN
  SELECT x.* INTO d FROM public.dispatches x WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id;
  IF d.id IS NULL OR d.execution_context_id IS NULL OR d.status<>'draft' OR d.execution_allowed IS DISTINCT FROM false OR d.worker_role<>'outbound_business_development_voice_worker' OR d.channel<>'phone' THEN RETURN false; END IF;
  SELECT x.* INTO b FROM public.worker_briefs x WHERE x.id=d.worker_brief_id AND x.owner_id=p_owner_id; SELECT x.* INTO m FROM public.operating_missions x WHERE x.id=d.mission_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO c FROM public.mission_execution_contexts x WHERE x.id=d.execution_context_id AND x.owner_id=p_owner_id; SELECT x.* INTO r FROM public.business_representations x WHERE x.id=d.business_representation_id AND x.user_id=p_owner_id;
  SELECT x.* INTO l FROM public.mission_leads x WHERE x.id=d.lead_id AND x.business_representation_id=d.business_representation_id; SELECT x.* INTO o FROM public.direct_hire_formation_outcome_packages x WHERE x.id=d.mandate_outcome_package_id AND x.owner_id=p_owner_id;
  RETURN b.id IS NOT NULL AND b.execution_allowed IS DISTINCT FROM true AND b.source_fingerprint=d.source_fingerprint AND b.operating_mission_id=d.mission_id AND b.execution_context_id=d.execution_context_id
    AND b.representation_version_id=d.representation_version_id AND b.mandate_outcome_package_id=d.mandate_outcome_package_id AND b.lead_id=d.lead_id
    AND m.id IS NOT NULL AND m.status='ready' AND m.representation_version_id=d.representation_version_id AND m.mandate_outcome_package_id=d.mandate_outcome_package_id AND m.lead_id=d.lead_id
    AND c.id IS NOT NULL AND c.context_contract_version IN ('operating-execution-context-v1','operating-execution-context-v2')
    AND c.context_fingerprint=encode(extensions.digest(convert_to(c.context::text,'UTF8'),'sha256'),'hex') AND public.zeya_p29c_context_memory_is_current(p_owner_id,c.id)
    AND r.id IS NOT NULL AND r.current_version_id=d.representation_version_id AND l.id IS NOT NULL AND m.lead_fingerprint=public.zeya_p24_lead_fingerprint(l)
    AND o.id IS NOT NULL AND o.outcome_fingerprint=m.mandate_fingerprint AND o.readiness_result->>'ready'='true' AND public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,o.id)
    AND coalesce(b.brief_payload#>>'{authority,pricing,disposition}','')='owner_approval_required' AND coalesce(b.brief_payload#>>'{authority,discounts,disposition}','')='owner_approval_required'
    AND coalesce(b.brief_payload#>>'{authority,negotiation,disposition}','')='prohibited' AND coalesce(b.brief_payload#>>'{authority,commitments,disposition}','')='prohibited'
    AND coalesce(b.brief_payload#>>'{authority,meetingBooking,disposition}','')='allowed_within_bounds' AND coalesce(b.brief_payload#>>'{authority,escalation,disposition}','')='owner_approval_required'
    AND nullif(btrim(coalesce(c.context#>>'{mandate,commercial,qualificationThreshold}','')),'') IS NOT NULL AND nullif(btrim(coalesce(c.context#>>'{mandate,commercial,meetingObjective}','')),'') IS NOT NULL;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
