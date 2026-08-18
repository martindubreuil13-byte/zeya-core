BEGIN;

ALTER TABLE public.mission_leads
  ADD COLUMN IF NOT EXISTS business_representation_id uuid REFERENCES public.business_representations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ingestion_operation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS mission_leads_representation_ingestion_unique
  ON public.mission_leads(business_representation_id,ingestion_operation_id) WHERE ingestion_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mission_leads_id_representation_unique
  ON public.mission_leads(id,business_representation_id);
CREATE UNIQUE INDEX IF NOT EXISTS representation_versions_id_representation_p24_unique
  ON public.representation_versions(id,business_representation_id);
CREATE UNIQUE INDEX IF NOT EXISTS formation_outcomes_id_owner_representation_p24_unique
  ON public.direct_hire_formation_outcome_packages(id,owner_id,business_representation_id);

CREATE TABLE public.operating_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.mission_leads(id) ON DELETE RESTRICT,
  representation_version_id uuid NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  mandate_outcome_package_id uuid NOT NULL REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  mandate_fingerprint text NOT NULL CHECK (mandate_fingerprint~'^[0-9a-f]{64}$'),
  lead_fingerprint text NOT NULL CHECK (lead_fingerprint~'^[0-9a-f]{64}$'),
  creation_operation_id uuid NOT NULL,
  objective text NOT NULL CHECK (btrim(objective)<>''),
  qualification_goal text NOT NULL CHECK (btrim(qualification_goal)<>''),
  desired_next_step text NOT NULL CHECK (btrim(desired_next_step)<>''),
  allowed_channel text NOT NULL CHECK (allowed_channel IN ('phone','email','research')),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(constraints)='object'),
  notes text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','in_progress','completed','failed','deferred','cancelled')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE(owner_id,creation_operation_id),
  FOREIGN KEY (lead_id,business_representation_id) REFERENCES public.mission_leads(id,business_representation_id) ON DELETE RESTRICT,
  FOREIGN KEY (representation_version_id,business_representation_id) REFERENCES public.representation_versions(id,business_representation_id) ON DELETE RESTRICT,
  FOREIGN KEY (mandate_outcome_package_id,owner_id,business_representation_id) REFERENCES public.direct_hire_formation_outcome_packages(id,owner_id,business_representation_id) ON DELETE RESTRICT
);

CREATE TABLE public.mission_execution_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL UNIQUE REFERENCES public.operating_missions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  representation_version_id uuid NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  mandate_outcome_package_id uuid NOT NULL REFERENCES public.direct_hire_formation_outcome_packages(id) ON DELETE RESTRICT,
  context_contract_version text NOT NULL CHECK (context_contract_version='operating-execution-context-v1'),
  context jsonb NOT NULL CHECK (jsonb_typeof(context)='object'),
  context_fingerprint text NOT NULL CHECK (context_fingerprint~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.mission_execution_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  execution_context_id uuid NOT NULL REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  result_operation_id uuid NOT NULL,
  contact_result text NOT NULL CHECK (contact_result IN ('contacted','not_reached')),
  qualification_result text NOT NULL CHECK (qualification_result IN ('qualified','not_qualified','unknown')),
  meeting_result text NOT NULL CHECK (meeting_result IN ('booked','not_booked')),
  owner_escalation_required boolean NOT NULL,
  follow_up_required boolean NOT NULL,
  summary text NOT NULL CHECK (btrim(summary)<>''),
  next_action text,
  source_conversation_id text,
  source_job_id text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE(owner_id,result_operation_id), UNIQUE(mission_id,execution_context_id)
);

CREATE INDEX operating_missions_owner_status_idx ON public.operating_missions(owner_id,status,created_at DESC);
CREATE INDEX operating_missions_lead_idx ON public.operating_missions(lead_id);
ALTER TABLE public.operating_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_execution_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_execution_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY operating_missions_owner_select ON public.operating_missions FOR SELECT USING (owner_id=auth.uid());
CREATE POLICY mission_execution_contexts_owner_select ON public.mission_execution_contexts FOR SELECT USING (owner_id=auth.uid());
CREATE POLICY mission_execution_outcomes_owner_select ON public.mission_execution_outcomes FOR SELECT USING (owner_id=auth.uid());

CREATE FUNCTION public.zeya_p24_lead_fingerprint(p_lead public.mission_leads)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'companyName',p_lead.company_name,'contactName',p_lead.contact_name,'phone',p_lead.phone,
    'email',p_lead.email,'website',p_lead.website,'source',p_lead.source,'notes',p_lead.notes
  )::text,'UTF8'),'sha256'),'hex')
$$;

CREATE FUNCTION public.zeya_create_operating_lead(
  p_owner_id uuid,p_business_representation_id uuid,p_operation_id uuid,p_company_name text,
  p_contact_name text,p_phone text,p_email text,p_source text,p_notes text
) RETURNS TABLE(lead_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rep public.business_representations%ROWTYPE; v_lead public.mission_leads%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_operation_id IS NULL OR nullif(btrim(coalesce(p_company_name,'')),'') IS NULL
    OR (nullif(btrim(coalesce(p_phone,'')),'') IS NULL AND nullif(btrim(coalesce(p_email,'')),'') IS NULL)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid lead'; END IF;
  SELECT * INTO v_rep FROM public.business_representations WHERE id=p_business_representation_id AND user_id=p_owner_id;
  IF v_rep.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='representation not found'; END IF;
  SELECT * INTO v_lead FROM public.mission_leads WHERE business_representation_id=v_rep.id AND ingestion_operation_id=p_operation_id;
  IF v_lead.id IS NOT NULL THEN
    IF v_lead.company_name IS DISTINCT FROM btrim(p_company_name) OR v_lead.contact_name IS DISTINCT FROM nullif(btrim(coalesce(p_contact_name,'')),'')
      OR v_lead.phone IS DISTINCT FROM nullif(btrim(coalesce(p_phone,'')),'') OR v_lead.email IS DISTINCT FROM nullif(btrim(coalesce(p_email,'')),'')
      OR v_lead.source IS DISTINCT FROM coalesce(nullif(btrim(coalesce(p_source,'')),''),'manual') OR v_lead.notes IS DISTINCT FROM nullif(btrim(coalesce(p_notes,'')),'')
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='lead operation conflicts'; END IF;
    RETURN QUERY SELECT v_lead.id,true; RETURN;
  END IF;
  INSERT INTO public.mission_leads(business_id,business_representation_id,ingestion_operation_id,company_name,contact_name,phone,email,source,notes,status)
  VALUES(v_rep.business_id,v_rep.id,p_operation_id,btrim(p_company_name),nullif(btrim(coalesce(p_contact_name,'')),''),nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_email,'')),''),coalesce(nullif(btrim(coalesce(p_source,'')),''),'manual'),nullif(btrim(coalesce(p_notes,'')),''),'new')
  RETURNING * INTO v_lead;
  RETURN QUERY SELECT v_lead.id,false;
END $$;

CREATE FUNCTION public.zeya_create_operating_mission(
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
    AND public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,o.id) ORDER BY o.created_at DESC,o.id DESC LIMIT 1;
  IF v_outcome.id IS NULL OR v_outcome.readiness_result->>'ready'<>'true' THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed mandate is not current'; END IF;
  INSERT INTO public.operating_missions AS inserted(owner_id,business_id,business_representation_id,lead_id,representation_version_id,mandate_outcome_package_id,mandate_fingerprint,lead_fingerprint,creation_operation_id,objective,qualification_goal,desired_next_step,allowed_channel,constraints,notes,priority)
  VALUES(p_owner_id,v_rep.business_id,v_rep.id,v_lead.id,v_rep.current_version_id,v_outcome.id,v_outcome.outcome_fingerprint,public.zeya_p24_lead_fingerprint(v_lead),p_operation_id,btrim(p_objective),btrim(p_qualification_goal),btrim(p_desired_next_step),p_allowed_channel,coalesce(p_constraints,'{}'::jsonb),nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_priority,'normal'))
  RETURNING inserted.id,inserted.status INTO v_existing.id,v_existing.status;
  RETURN QUERY SELECT v_existing.id,false,v_existing.status;
END $$;

CREATE FUNCTION public.zeya_prepare_operating_mission(p_owner_id uuid,p_mission_id uuid)
RETURNS TABLE(mission_id uuid,context_id uuid,replayed boolean,status text,execution_context jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_mission public.operating_missions%ROWTYPE; v_rep public.business_representations%ROWTYPE; v_lead public.mission_leads%ROWTYPE;
  v_version public.representation_versions%ROWTYPE; v_outcome public.direct_hire_formation_outcome_packages%ROWTYPE;
  v_stored public.mission_execution_contexts%ROWTYPE; v_context jsonb; v_fingerprint text;
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
  SELECT * INTO v_stored FROM public.mission_execution_contexts WHERE mission_id=v_mission.id;
  IF v_stored.id IS NOT NULL THEN
    IF v_mission.status<>'ready' OR v_stored.owner_id<>p_owner_id
      OR v_stored.business_representation_id<>v_mission.business_representation_id
      OR v_stored.representation_version_id<>v_mission.representation_version_id
      OR v_stored.mandate_outcome_package_id<>v_mission.mandate_outcome_package_id
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prepared context lineage is incomplete'; END IF;
    RETURN QUERY SELECT v_mission.id,v_stored.id,true,'ready'::text,v_stored.context; RETURN;
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
  INSERT INTO public.mission_execution_contexts(mission_id,owner_id,business_representation_id,representation_version_id,mandate_outcome_package_id,context_contract_version,context,context_fingerprint)
  VALUES(v_mission.id,p_owner_id,v_rep.id,v_version.id,v_outcome.id,'operating-execution-context-v1',v_context,v_fingerprint) RETURNING * INTO v_stored;
  UPDATE public.operating_missions SET status='ready',updated_at=pg_catalog.now() WHERE id=v_mission.id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='mission changed concurrently'; END IF;
  RETURN QUERY SELECT v_mission.id,v_stored.id,false,'ready'::text,v_context;
END $$;

CREATE FUNCTION public.zeya_p24_immutable_execution_context() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution contexts are immutable'; END $$;
CREATE TRIGGER mission_execution_contexts_immutable BEFORE UPDATE OR DELETE ON public.mission_execution_contexts
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p24_immutable_execution_context();

CREATE FUNCTION public.zeya_p24_preserve_mission_sources() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.business_representation_id IS DISTINCT FROM OLD.business_representation_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
    OR NEW.representation_version_id IS DISTINCT FROM OLD.representation_version_id OR NEW.mandate_outcome_package_id IS DISTINCT FROM OLD.mandate_outcome_package_id
    OR NEW.mandate_fingerprint IS DISTINCT FROM OLD.mandate_fingerprint OR NEW.lead_fingerprint IS DISTINCT FROM OLD.lead_fingerprint
    OR NEW.creation_operation_id IS DISTINCT FROM OLD.creation_operation_id OR NEW.objective IS DISTINCT FROM OLD.objective
    OR NEW.qualification_goal IS DISTINCT FROM OLD.qualification_goal OR NEW.desired_next_step IS DISTINCT FROM OLD.desired_next_step
    OR NEW.allowed_channel IS DISTINCT FROM OLD.allowed_channel OR NEW.constraints IS DISTINCT FROM OLD.constraints
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='mission source and execution contract are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operating_missions_source_immutable BEFORE UPDATE ON public.operating_missions
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p24_preserve_mission_sources();

ALTER FUNCTION public.zeya_create_operating_lead(uuid,uuid,uuid,text,text,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text) OWNER TO postgres;
ALTER FUNCTION public.zeya_prepare_operating_mission(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_create_operating_lead(uuid,uuid,uuid,text,text,text,text,text,text),public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text),public.zeya_prepare_operating_mission(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_create_operating_lead(uuid,uuid,uuid,text,text,text,text,text,text),public.zeya_create_operating_mission(uuid,uuid,uuid,text,text,text,text,jsonb,text,text),public.zeya_prepare_operating_mission(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
