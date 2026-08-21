BEGIN;

CREATE TABLE public.conversation_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_output_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  canonical_version_id uuid NOT NULL REFERENCES public.representation_versions(id) ON DELETE RESTRICT,
  mission_id uuid NOT NULL REFERENCES public.operating_missions(id) ON DELETE RESTRICT,
  execution_context_id uuid NOT NULL REFERENCES public.mission_execution_contexts(id) ON DELETE RESTRICT,
  worker_brief_id text NOT NULL REFERENCES public.worker_briefs(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.mission_leads(id) ON DELETE RESTRICT,
  interpretation_schema_version text NOT NULL CHECK (interpretation_schema_version~'^conversation-interpretation-v[1-9][0-9]*$'),
  interpretation jsonb NOT NULL CHECK (jsonb_typeof(interpretation)='object'),
  interpretation_hash text NOT NULL CHECK (interpretation_hash~'^[0-9a-f]{64}$'),
  model_provider text NOT NULL CHECK (btrim(model_provider)<>''),
  model_name text NOT NULL CHECK (btrim(model_name)<>''),
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE(conversation_output_id,interpretation_schema_version),
  FOREIGN KEY (conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id)
    REFERENCES public.voice_conversation_outputs(id,tenant_user_id,business_id,business_representation_id,canonical_version_id) ON DELETE RESTRICT
);

CREATE INDEX conversation_interpretations_mission_idx ON public.conversation_interpretations(mission_id,created_at DESC);
ALTER TABLE public.conversation_interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_interpretations_owner_select ON public.conversation_interpretations
  FOR SELECT TO authenticated USING (tenant_user_id=auth.uid());
REVOKE ALL ON public.conversation_interpretations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.conversation_interpretations TO authenticated,service_role;

CREATE FUNCTION public.zeya_enforce_conversation_interpretation_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation interpretation is immutable';
END $$;
CREATE TRIGGER conversation_interpretations_immutable
  BEFORE UPDATE OR DELETE ON public.conversation_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_enforce_conversation_interpretation_immutability();

CREATE FUNCTION public.zeya_persist_conversation_interpretation(
  p_owner_id uuid,p_conversation_output_id uuid,p_schema_version text,p_interpretation jsonb,
  p_model_provider text,p_model_name text,p_model_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(interpretation_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_output public.voice_conversation_outputs%ROWTYPE;
  v_mission public.operating_missions%ROWTYPE;
  v_context public.mission_execution_contexts%ROWTYPE;
  v_brief public.worker_briefs%ROWTYPE;
  v_existing public.conversation_interpretations%ROWTYPE;
  v_created public.conversation_interpretations%ROWTYPE;
  v_hash text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_owner_id IS NULL OR p_conversation_output_id IS NULL OR p_schema_version!~'^conversation-interpretation-v[1-9][0-9]*$'
    OR jsonb_typeof(p_interpretation)<>'object' OR nullif(btrim(coalesce(p_model_provider,'')),'') IS NULL
    OR nullif(btrim(coalesce(p_model_name,'')),'') IS NULL OR jsonb_typeof(coalesce(p_model_metadata,'{}'::jsonb))<>'object'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid interpretation input'; END IF;

  SELECT * INTO v_output FROM public.voice_conversation_outputs
    WHERE id=p_conversation_output_id AND tenant_user_id=p_owner_id FOR SHARE;
  IF v_output.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='conversation output not found'; END IF;
  IF v_output.transcript_status<>'finalized' OR jsonb_array_length(v_output.transcript)=0
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation transcript is not finalized'; END IF;
  IF v_output.mission_id IS NULL OR v_output.mission_id!~'^[0-9a-fA-F-]{36}$' OR v_output.worker_brief_id IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation lineage is incomplete'; END IF;

  SELECT * INTO v_mission FROM public.operating_missions
    WHERE id=v_output.mission_id::uuid AND owner_id=p_owner_id AND business_id=v_output.business_id
      AND business_representation_id=v_output.business_representation_id;
  SELECT * INTO v_context FROM public.mission_execution_contexts
    WHERE mission_id=v_mission.id AND owner_id=p_owner_id AND representation_version_id=v_output.canonical_version_id;
  SELECT * INTO v_brief FROM public.worker_briefs
    WHERE id=v_output.worker_brief_id AND mission_id=v_output.mission_id AND business_id=v_output.business_id;
  IF v_mission.id IS NULL OR v_context.id IS NULL OR v_brief.id IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation lineage does not match mission'; END IF;

  IF p_interpretation->>'schemaVersion' IS DISTINCT FROM p_schema_version
    OR p_interpretation->>'conversationOutputId' IS DISTINCT FROM v_output.id::text
    OR p_interpretation->>'conversationId' IS DISTINCT FROM v_output.conversation_id
    OR p_interpretation->>'missionId' IS DISTINCT FROM v_mission.id::text
    OR p_interpretation->>'workerBriefId' IS DISTINCT FROM v_brief.id
    OR p_interpretation->>'leadId' IS DISTINCT FROM v_mission.lead_id::text
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='interpretation lineage conflicts'; END IF;

  v_hash:=encode(extensions.digest(pg_catalog.convert_to(p_interpretation::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_existing FROM public.conversation_interpretations
    WHERE conversation_output_id=v_output.id AND interpretation_schema_version=p_schema_version FOR SHARE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.interpretation IS DISTINCT FROM p_interpretation OR v_existing.interpretation_hash IS DISTINCT FROM v_hash
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='interpretation version conflicts'; END IF;
    RETURN QUERY SELECT v_existing.id,true; RETURN;
  END IF;

  INSERT INTO public.conversation_interpretations(
    conversation_output_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,
    mission_id,execution_context_id,worker_brief_id,lead_id,interpretation_schema_version,interpretation,
    interpretation_hash,model_provider,model_name,model_metadata
  ) VALUES (
    v_output.id,p_owner_id,v_output.business_id,v_output.business_representation_id,v_output.canonical_version_id,
    v_mission.id,v_context.id,v_brief.id,v_mission.lead_id,p_schema_version,p_interpretation,v_hash,
    btrim(p_model_provider),btrim(p_model_name),coalesce(p_model_metadata,'{}'::jsonb)
  ) RETURNING * INTO v_created;
  RETURN QUERY SELECT v_created.id,false;
END $$;

CREATE FUNCTION public.zeya_project_conversation_interpretation(p_owner_id uuid,p_interpretation_id uuid)
RETURNS TABLE(outcome_id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_i public.conversation_interpretations%ROWTYPE;
  v_existing public.mission_execution_outcomes%ROWTYPE;
  v_created public.mission_execution_outcomes%ROWTYPE;
  v_contact text; v_qualification text; v_followup boolean; v_escalation boolean;
  v_summary text; v_next text; v_conversation text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  SELECT * INTO v_i FROM public.conversation_interpretations
    WHERE id=p_interpretation_id AND tenant_user_id=p_owner_id FOR SHARE;
  IF v_i.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='conversation interpretation not found'; END IF;
  IF v_i.interpretation_schema_version<>'conversation-interpretation-v1'
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='interpretation version is not projectable'; END IF;

  v_contact:=CASE WHEN (v_i.interpretation#>>'{callResult,contacted}')::boolean THEN 'contacted' ELSE 'not_reached' END;
  v_qualification:=v_i.interpretation#>>'{qualification,result}';
  v_followup:=coalesce((v_i.interpretation#>>'{followUp,requested}')::boolean,false)
    OR coalesce((v_i.interpretation#>>'{followUp,agentCommittedToFollowUp}')::boolean,false);
  v_escalation:=coalesce((v_i.interpretation#>>'{ownerEscalation,required}')::boolean,false);
  v_summary:=nullif(btrim(v_i.interpretation->>'executiveSummary'),'');
  v_next:=nullif(btrim(v_i.interpretation#>>'{recommendedNextAction,action}'),'');
  v_conversation:=v_i.interpretation->>'conversationId';
  IF v_qualification IS NULL OR v_qualification NOT IN ('qualified','not_qualified','unknown') OR v_summary IS NULL OR v_conversation IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='interpretation cannot be projected'; END IF;

  SELECT * INTO v_existing FROM public.mission_execution_outcomes
    WHERE mission_id=v_i.mission_id AND execution_context_id=v_i.execution_context_id FOR SHARE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.result_operation_id IS DISTINCT FROM v_i.id OR v_existing.contact_result IS DISTINCT FROM v_contact
      OR v_existing.qualification_result IS DISTINCT FROM v_qualification OR v_existing.meeting_result IS DISTINCT FROM 'not_booked'
      OR v_existing.owner_escalation_required IS DISTINCT FROM v_escalation OR v_existing.follow_up_required IS DISTINCT FROM v_followup
      OR v_existing.summary IS DISTINCT FROM v_summary OR v_existing.next_action IS DISTINCT FROM v_next
      OR v_existing.source_conversation_id IS DISTINCT FROM v_conversation OR v_existing.source_job_id IS DISTINCT FROM v_i.worker_brief_id
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='mission outcome conflicts'; END IF;
    RETURN QUERY SELECT v_existing.id,true; RETURN;
  END IF;

  INSERT INTO public.mission_execution_outcomes(mission_id,execution_context_id,owner_id,result_operation_id,
    contact_result,qualification_result,meeting_result,owner_escalation_required,follow_up_required,summary,next_action,
    source_conversation_id,source_job_id)
  VALUES(v_i.mission_id,v_i.execution_context_id,p_owner_id,v_i.id,v_contact,v_qualification,'not_booked',v_escalation,
    v_followup,v_summary,v_next,v_conversation,v_i.worker_brief_id) RETURNING * INTO v_created;
  RETURN QUERY SELECT v_created.id,false;
END $$;

REVOKE ALL ON FUNCTION public.zeya_persist_conversation_interpretation(uuid,uuid,text,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_project_conversation_interpretation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_persist_conversation_interpretation(uuid,uuid,text,jsonb,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_project_conversation_interpretation(uuid,uuid) TO service_role;

COMMIT;
