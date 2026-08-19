BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_prepare_operating_mission(p_owner_id uuid,p_mission_id uuid)
RETURNS TABLE(mission_id uuid,context_id uuid,replayed boolean,status text,execution_context jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_mission public.operating_missions%ROWTYPE; v_rep public.business_representations%ROWTYPE; v_lead public.mission_leads%ROWTYPE;
  v_version public.representation_versions%ROWTYPE; v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE;
  v_context_id uuid; v_existing_context jsonb; v_context_owner_id uuid; v_context_representation_id uuid;
  v_context_version_id uuid; v_context_mandate_id uuid; v_context jsonb; v_fingerprint text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_mission FROM public.operating_missions WHERE id=p_mission_id AND owner_id=p_owner_id FOR UPDATE;
  IF v_mission.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='mission not found'; END IF;
  SELECT * INTO v_rep FROM public.business_representations WHERE id=v_mission.business_representation_id AND user_id=p_owner_id FOR SHARE;
  SELECT * INTO v_lead FROM public.mission_leads WHERE id=v_mission.lead_id AND business_representation_id=v_rep.id FOR SHARE;
  SELECT * INTO v_version FROM public.representation_versions WHERE id=v_mission.representation_version_id AND business_representation_id=v_rep.id;
  SELECT * INTO v_outcome FROM public.direct_hire_formation_outcome_packages WHERE id=v_mission.mandate_outcome_package_id AND owner_id=p_owner_id AND business_representation_id=v_rep.id;
  IF v_rep.id IS NULL OR v_lead.id IS NULL OR v_version.id IS NULL OR v_outcome.id IS NULL
    OR v_rep.current_version_id IS DISTINCT FROM v_mission.representation_version_id
    OR v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead)
    OR v_mission.mandate_fingerprint IS DISTINCT FROM v_outcome.outcome_fingerprint
    OR v_outcome.readiness_result->>'ready'<>'true'
    OR NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission source lineage is stale'; END IF;
  SELECT c.id,c.context,c.owner_id,c.business_representation_id,c.representation_version_id,c.mandate_outcome_package_id
  INTO v_context_id,v_existing_context,v_context_owner_id,v_context_representation_id,v_context_version_id,v_context_mandate_id
  FROM public.mission_execution_contexts c WHERE c.mission_id=v_mission.id;
  IF v_context_id IS NOT NULL THEN
    IF v_mission.status<>'ready' OR v_context_owner_id<>p_owner_id
      OR v_context_representation_id<>v_mission.business_representation_id
      OR v_context_version_id<>v_mission.representation_version_id
      OR v_context_mandate_id<>v_mission.mandate_outcome_package_id
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared context lineage is incomplete'; END IF;
    RETURN QUERY SELECT p_mission_id,v_context_id,true,'ready'::text,v_existing_context; RETURN;
  END IF;
  IF v_mission.status<>'draft' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission is not preparable'; END IF;
  v_context:=jsonb_build_object(
    'contractVersion','operating-execution-context-v1',
    'target',jsonb_build_object('leadId',v_lead.id,'companyName',v_lead.company_name,'contactName',v_lead.contact_name,'phone',v_lead.phone,'email',v_lead.email,'source',v_lead.source,'notes',v_lead.notes),
    'representation',jsonb_build_object('businessRepresentationId',v_rep.id,'versionId',v_version.id,'values',v_version.element_values),
    'mission',jsonb_build_object('missionId',v_mission.id,'objective',v_mission.objective,'qualificationGoal',v_mission.qualification_goal,'desiredNextStep',v_mission.desired_next_step,'channel',v_mission.allowed_channel,'priority',v_mission.priority,'notes',v_mission.notes),
    'mandate',jsonb_build_object(
      'commercial',jsonb_build_object('immediateBdObjective',v_outcome.outcome#>'{commercial,immediate_bd_goal,value}','qualificationThreshold',v_outcome.outcome#>'{commercial,qualification_threshold,value}','meetingObjective',v_outcome.outcome#>'{commercial,meeting_objective,value}'),
      'authority',jsonb_build_object(
        'pricing',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_pricing,disposition}','value',v_outcome.outcome#>'{authority,authority_pricing,value}'),
        'discounts',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_discounts,disposition}','value',v_outcome.outcome#>'{authority,authority_discounts,value}'),
        'negotiation',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_negotiation,disposition}','value',v_outcome.outcome#>'{authority,authority_negotiation,value}'),
        'commitments',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_customer_commitments,disposition}','value',v_outcome.outcome#>'{authority,authority_customer_commitments,value}'),
        'meetingBooking',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_meeting_booking,disposition}','value',v_outcome.outcome#>'{authority,authority_meeting_booking,value}'),
        'ownerApproval',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_owner_approval_required,disposition}','value',v_outcome.outcome#>'{authority,authority_owner_approval_required,value}'),
        'escalation',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_escalation_rules,disposition}','value',v_outcome.outcome#>'{authority,authority_escalation_rules,value}'),
        'prohibitedClaims',jsonb_build_object('disposition',v_outcome.outcome#>>'{authority,authority_prohibited_claims,disposition}','value',v_outcome.outcome#>'{authority,authority_prohibited_claims,value}')
      )
    ),
    'constraints',v_mission.constraints
  );
  v_fingerprint:=encode(extensions.digest(convert_to(v_context::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.mission_execution_contexts AS inserted(mission_id,owner_id,business_representation_id,representation_version_id,mandate_outcome_package_id,context_contract_version,context,context_fingerprint)
  VALUES(v_mission.id,p_owner_id,v_rep.id,v_version.id,v_outcome.id,'operating-execution-context-v1',v_context,v_fingerprint) RETURNING inserted.id INTO v_context_id;
  UPDATE public.operating_missions SET status='ready',updated_at=pg_catalog.now() WHERE id=v_mission.id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='mission changed concurrently'; END IF;
  RETURN QUERY SELECT p_mission_id,v_context_id,false,'ready'::text,v_context;
END $$;

ALTER FUNCTION public.zeya_prepare_operating_mission(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_prepare_operating_mission(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_prepare_operating_mission(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
