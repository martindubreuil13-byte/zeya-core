BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_create_operating_mission(
  p_owner_id uuid,p_lead_id uuid,p_operation_id uuid,p_objective text,p_qualification_goal text,
  p_desired_next_step text,p_allowed_channel text,p_constraints jsonb,p_notes text,p_priority text
) RETURNS TABLE(mission_id uuid,replayed boolean,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_lead public.mission_leads%ROWTYPE; v_rep public.business_representations%ROWTYPE;
  v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE; v_existing public.operating_missions%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL OR nullif(btrim(coalesce(p_objective,'')),'') IS NULL OR nullif(btrim(coalesce(p_qualification_goal,'')),'') IS NULL
    OR nullif(btrim(coalesce(p_desired_next_step,'')),'') IS NULL OR p_allowed_channel NOT IN ('phone','email','research')
    OR coalesce(jsonb_typeof(p_constraints),'object')<>'object' OR coalesce(p_priority,'normal') NOT IN ('low','normal','high')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid mission'; END IF;
  SELECT * INTO v_existing FROM public.operating_missions WHERE owner_id=p_owner_id AND creation_operation_id=p_operation_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.lead_id<>p_lead_id OR v_existing.objective<>btrim(p_objective) OR v_existing.qualification_goal<>btrim(p_qualification_goal)
      OR v_existing.desired_next_step<>btrim(p_desired_next_step) OR v_existing.allowed_channel<>p_allowed_channel
      OR v_existing.constraints IS DISTINCT FROM coalesce(p_constraints,'{}'::jsonb) OR v_existing.notes IS DISTINCT FROM nullif(btrim(coalesce(p_notes,'')),'') OR v_existing.priority<>coalesce(p_priority,'normal')
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission operation conflicts'; END IF;
    RETURN QUERY SELECT v_existing.id,true,v_existing.status; RETURN;
  END IF;
  SELECT * INTO v_lead FROM public.mission_leads WHERE id=p_lead_id;
  SELECT * INTO v_rep FROM public.business_representations WHERE id=v_lead.business_representation_id AND user_id=p_owner_id FOR SHARE;
  IF v_lead.id IS NULL OR v_rep.id IS NULL OR v_rep.current_version_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='lead or canonical representation is not ready'; END IF;
  SELECT * INTO v_outcome FROM public.direct_hire_formation_outcome_packages o WHERE o.owner_id=p_owner_id AND o.business_representation_id=v_rep.id
    AND public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,o.id) ORDER BY o.finalized_at DESC,o.id DESC LIMIT 1;
  IF v_outcome.id IS NULL OR v_outcome.readiness_result->>'ready'<>'true' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed mandate is not current'; END IF;
  INSERT INTO public.operating_missions AS inserted(owner_id,business_id,business_representation_id,lead_id,representation_version_id,mandate_outcome_package_id,mandate_fingerprint,lead_fingerprint,creation_operation_id,objective,qualification_goal,desired_next_step,allowed_channel,constraints,notes,priority)
  VALUES(p_owner_id,v_rep.business_id,v_rep.id,v_lead.id,v_rep.current_version_id,v_outcome.id,v_outcome.outcome_fingerprint,public.zeya_p24_lead_fingerprint(v_lead),p_operation_id,btrim(p_objective),btrim(p_qualification_goal),btrim(p_desired_next_step),p_allowed_channel,coalesce(p_constraints,'{}'::jsonb),nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_priority,'normal'))
  RETURNING inserted.id,inserted.status INTO v_existing.id,v_existing.status;
  RETURN QUERY SELECT v_existing.id,false,v_existing.status;
END $$;

ALTER FUNCTION public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
