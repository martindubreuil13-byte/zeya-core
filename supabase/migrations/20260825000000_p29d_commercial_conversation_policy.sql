BEGIN;

CREATE FUNCTION public.zeya_prepare_governed_dispatch_v3(p_owner_id uuid,p_mission_id uuid,p_operation_id uuid,p_worker jsonb,p_conversation_policy jsonb,p_capabilities jsonb,p_opening_contract jsonb)
RETURNS TABLE(dispatch_id text,worker_brief_id text,replayed boolean,status text,execution_allowed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.operating_missions%ROWTYPE; c public.mission_execution_contexts%ROWTYPE; r public.business_representations%ROWTYPE;
  l public.mission_leads%ROWTYPE; o public.direct_hire_formation_outcome_packages%ROWTYPE; d public.dispatches%ROWTYPE; b public.worker_briefs%ROWTYPE;
  did text; bid text; role text:='outbound_business_development_voice_worker'; allowed boolean; fp text; brief jsonb; phone text; offer text; audience text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid dispatch'; END IF;
  IF p_worker#>>'{schemaVersion}'<>'dispatched-worker-identity-v1' OR p_worker#>>'{workerRole}'<>'outbound_business_development_caller'
    OR p_worker#>>'{provider}'<>'elevenlabs' OR nullif(btrim(coalesce(p_worker#>>'{spokenName}','')),'') IS NULL
    OR nullif(btrim(coalesce(p_worker#>>'{providerAgentIdentity}','')),'') IS NULL OR nullif(btrim(coalesce(p_worker#>>'{providerBranchIdentity}','')),'') IS NULL
    OR p_conversation_policy#>>'{schemaVersion}'<>'commercial-conversation-policy-v1' OR p_conversation_policy#>>'{role}'<>'business_representative'
    OR p_capabilities#>>'{schemaVersion}'<>'governed-commercial-capabilities-v1' OR p_capabilities#>>'{scheduling}'<>'false' OR p_capabilities#>>'{email}'<>'false' OR p_capabilities#>>'{reminders}'<>'false'
    OR p_opening_contract#>>'{schemaVersion}'<>'governed-commercial-opening-v1' OR p_opening_contract#>>'{owner}'<>'provider_first_message'
    OR p_opening_contract#>>'{variable}'<>'opening' OR p_opening_contract#>>'{introductionAlreadySpoken}'<>'true'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid governed worker configuration'; END IF;
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
    OR c.context_fingerprint IS DISTINCT FROM encode(extensions.digest(convert_to(c.context::text,'UTF8'),'sha256'),'hex') OR NOT public.zeya_p29c_context_memory_is_current(p_owner_id,c.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared mission lineage is stale'; END IF;
  IF m.allowed_channel<>'phone' OR nullif(btrim(coalesce(c.context#>>'{target,phone}','')),'') IS NULL
    OR (m.constraints?'doNotExecute' AND jsonb_typeof(m.constraints->'doNotExecute')<>'boolean') OR (m.constraints?'qaOnly' AND jsonb_typeof(m.constraints->'qaOnly')<>'boolean')
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission constraints do not permit dispatch preparation'; END IF;
  offer:=nullif(btrim(coalesce(c.context#>>'{representation,values,whatYouSell,value}','')),''); audience:=nullif(btrim(coalesce(c.context#>>'{representation,values,whoItIsFor,value}','')),'');
  IF offer IS NULL OR audience IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='approved Representation values are incomplete'; END IF;
  allowed:=NOT coalesce((m.constraints->>'doNotExecute')::boolean,false);
  fp:=encode(extensions.digest(convert_to(jsonb_build_object('missionId',m.id,'executionContextId',c.id,'contextFingerprint',c.context_fingerprint,'representationVersionId',m.representation_version_id,'mandateOutcomePackageId',m.mandate_outcome_package_id,'leadId',m.lead_id,'workerRole',role,'channel',m.allowed_channel,'executionAllowed',allowed,'worker',p_worker,'conversationPolicy',p_conversation_policy,'capabilities',p_capabilities,'openingContract',p_opening_contract)::text,'UTF8'),'sha256'),'hex');
  SELECT x.* INTO d FROM public.dispatches x WHERE x.owner_id=p_owner_id AND x.preparation_operation_id=p_operation_id;
  IF d.id IS NOT NULL THEN
    SELECT x.* INTO b FROM public.worker_briefs x WHERE x.id=d.worker_brief_id;
    IF d.mission_id IS DISTINCT FROM m.id OR d.execution_context_id IS DISTINCT FROM c.id OR d.source_fingerprint IS DISTINCT FROM fp OR d.status<>'draft'
      OR b.id IS NULL OR b.execution_context_id IS DISTINCT FROM c.id OR b.source_fingerprint IS DISTINCT FROM fp OR b.brief_payload#>>'{contractVersion}'<>'governed-worker-brief-v3'
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch operation conflicts'; END IF;
    RETURN QUERY SELECT d.dispatch_id,d.worker_brief_id,true,'draft'::text,d.execution_allowed; RETURN;
  END IF;
  did:='p25_dispatch_'||replace(gen_random_uuid()::text,'-',''); bid:='p25_brief_'||replace(gen_random_uuid()::text,'-',''); phone:=c.context#>>'{target,phone}';
  brief:=jsonb_build_object('contractVersion','governed-worker-brief-v3','worker',p_worker,
    'business',jsonb_build_object('representation',jsonb_build_object('offer',offer,'audience',audience)),
    'prospect',jsonb_build_object('identity',c.context->'target','context',c.context->'prospectContext'),
    'mission',jsonb_build_object('objective',c.context#>'{mission,objective}','qualificationGoal',c.context#>'{mission,qualificationGoal}','desiredNextStep',c.context#>'{mission,desiredNextStep}'),
    'authority',c.context#>'{mandate,authority}','capabilities',p_capabilities,'conversationPolicy',p_conversation_policy,'openingContract',p_opening_contract,
    'constraints',c.context->'constraints','dispatch',jsonb_build_object('workerRole',role,'channel',m.allowed_channel,'executionAllowed',allowed));
  INSERT INTO public.worker_briefs(id,mission_id,business_id,target_name,target_phone,objective,desired_outcome,company_context,lead_context,key_questions,objection_guidance,escalation_rules,tone_guidance,success_criteria,dynamic_variables,owner_id,business_representation_id,operating_mission_id,execution_context_id,representation_version_id,mandate_outcome_package_id,lead_id,worker_role,channel,brief_payload,source_fingerprint,execution_allowed)
  VALUES(bid,m.id::text,m.business_id,c.context#>>'{target,contactName}',phone,c.context#>>'{mission,objective}',c.context#>>'{mission,desiredNextStep}',offer,audience,'[]','[]','[]',NULL,NULL,'{}',p_owner_id,m.business_representation_id,m.id,c.id,m.representation_version_id,m.mandate_outcome_package_id,m.lead_id,role,m.allowed_channel,brief,fp,allowed);
  INSERT INTO public.dispatches(dispatch_id,user_id,visitor_name,phone_number,business_offer,target_buyer,agent_brief,status,source,metadata,worker_brief_id,owner_id,business_representation_id,mission_id,execution_context_id,representation_version_id,mandate_outcome_package_id,lead_id,worker_role,channel,preparation_operation_id,source_fingerprint,execution_allowed)
  VALUES(did,p_owner_id,coalesce(c.context#>>'{target,contactName}',c.context#>>'{target,companyName}'),phone,offer,audience,brief,'draft','p29d_governed_operating_mission',jsonb_build_object('qaOnly',coalesce((m.constraints->>'qaOnly')::boolean,false)),bid,p_owner_id,m.business_representation_id,m.id,c.id,m.representation_version_id,m.mandate_outcome_package_id,m.lead_id,role,m.allowed_channel,p_operation_id,fp,allowed);
  RETURN QUERY SELECT did,bid,false,'draft'::text,allowed;
END $$;
REVOKE ALL ON FUNCTION public.zeya_prepare_governed_dispatch_v3(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_prepare_governed_dispatch_v3(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
