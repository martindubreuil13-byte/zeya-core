BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_interpretations_p29b_lineage_unique
  ON public.conversation_interpretations(id,tenant_user_id,business_id,business_representation_id,lead_id,conversation_output_id,mission_id);
CREATE UNIQUE INDEX IF NOT EXISTS prospect_leads_p29b_lineage_unique
  ON public.mission_leads(id,business_id,business_representation_id);

CREATE TABLE public.prospect_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL,
  source_interpretation_id uuid NOT NULL,
  source_conversation_output_id uuid NOT NULL,
  source_mission_id uuid NOT NULL,
  observation_schema_version text NOT NULL CHECK(observation_schema_version='prospect-observation-v1'),
  source_key text NOT NULL CHECK(source_key~'^[a-z][a-z0-9_.:-]{0,159}$'),
  kind text NOT NULL CHECK(kind IN ('need','pain','interest','objection','qualification','authority','budget','timing','channel','preference','follow_up_request','clarification','other')),
  slot text NOT NULL CHECK(slot~'^[a-z][a-z0-9_.:-]{0,119}$'),
  claim text NOT NULL CHECK(btrim(claim)<>'' AND char_length(claim)<=1000),
  value jsonb,
  polarity text NOT NULL CHECK(polarity IN ('affirmed','denied','unknown')),
  basis text NOT NULL CHECK(basis IN ('explicit_statement','supported_inference')),
  confidence numeric(4,3) NOT NULL CHECK(confidence>=0 AND confidence<=1),
  uncertainty jsonb CHECK(uncertainty IS NULL OR (jsonb_typeof(uncertainty)='object' AND uncertainty->>'kind' IN ('asr','ambiguous','incomplete','inference'))),
  content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE(lead_id,source_interpretation_id,source_key),
  UNIQUE(id,owner_id,business_id,business_representation_id,lead_id),
  FOREIGN KEY(lead_id,business_id,business_representation_id)
    REFERENCES public.mission_leads(id,business_id,business_representation_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_interpretation_id,owner_id,business_id,business_representation_id,lead_id,source_conversation_output_id,source_mission_id)
    REFERENCES public.conversation_interpretations(id,tenant_user_id,business_id,business_representation_id,lead_id,conversation_output_id,mission_id) ON DELETE RESTRICT
);
CREATE INDEX prospect_observations_lead_observed_idx ON public.prospect_observations(lead_id,observed_at DESC);
CREATE INDEX prospect_observations_lead_slot_idx ON public.prospect_observations(lead_id,slot,observed_at DESC);

CREATE TABLE public.prospect_observation_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL,
  subject_observation_id uuid NOT NULL,
  object_observation_id uuid NOT NULL,
  relation text NOT NULL CHECK(relation IN ('supersedes','contradicts','resolves_uncertainty','invalidates')),
  rationale text NOT NULL CHECK(btrim(rationale)<>'' AND char_length(rationale)<=1000),
  source_interpretation_id uuid REFERENCES public.conversation_interpretations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK(subject_observation_id<>object_observation_id),
  UNIQUE(subject_observation_id,object_observation_id,relation),
  FOREIGN KEY(subject_observation_id,owner_id,business_id,business_representation_id,lead_id)
    REFERENCES public.prospect_observations(id,owner_id,business_id,business_representation_id,lead_id) ON DELETE RESTRICT,
  FOREIGN KEY(object_observation_id,owner_id,business_id,business_representation_id,lead_id)
    REFERENCES public.prospect_observations(id,owner_id,business_id,business_representation_id,lead_id) ON DELETE RESTRICT
);
CREATE INDEX prospect_observation_relations_lead_idx ON public.prospect_observation_relations(lead_id,created_at DESC);

ALTER TABLE public.prospect_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_observation_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY prospect_observations_owner_select ON public.prospect_observations FOR SELECT TO authenticated USING(owner_id=auth.uid());
CREATE POLICY prospect_observation_relations_owner_select ON public.prospect_observation_relations FOR SELECT TO authenticated USING(owner_id=auth.uid());
REVOKE ALL ON public.prospect_observations,public.prospect_observation_relations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.prospect_observations,public.prospect_observation_relations TO authenticated;
GRANT ALL ON public.prospect_observations,public.prospect_observation_relations TO service_role;

CREATE FUNCTION public.zeya_p29b_immutable_prospect_memory() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='prospect memory is immutable';
END $$;
CREATE TRIGGER prospect_observations_immutable BEFORE UPDATE OR DELETE ON public.prospect_observations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p29b_immutable_prospect_memory();
CREATE TRIGGER prospect_observation_relations_immutable BEFORE UPDATE OR DELETE ON public.prospect_observation_relations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p29b_immutable_prospect_memory();

CREATE FUNCTION public.zeya_project_prospect_observations(p_owner_id uuid,p_interpretation_id uuid,p_observations jsonb)
RETURNS TABLE(observation_count integer,inserted_count integer,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.conversation_interpretations%ROWTYPE; o public.voice_conversation_outputs%ROWTYPE;
  item jsonb; existing public.prospect_observations%ROWTYPE; expected_hash text; total integer:=0; inserted integer:=0; prior integer:=0;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_owner_id IS NULL OR p_interpretation_id IS NULL OR jsonb_typeof(p_observations)<>'array' OR jsonb_array_length(p_observations)>40
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid prospect observation projection'; END IF;
  SELECT * INTO i FROM public.conversation_interpretations WHERE id=p_interpretation_id AND tenant_user_id=p_owner_id FOR SHARE;
  IF i.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='conversation interpretation not found'; END IF;
  SELECT * INTO o FROM public.voice_conversation_outputs WHERE id=i.conversation_output_id AND tenant_user_id=p_owner_id
    AND business_id=i.business_id AND business_representation_id=i.business_representation_id AND mission_id=i.mission_id::text FOR SHARE;
  IF o.id IS NULL OR i.interpretation->>'leadId' IS DISTINCT FROM i.lead_id::text
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation lineage conflicts'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_observations))<>(SELECT count(DISTINCT value->>'sourceKey') FROM jsonb_array_elements(p_observations))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate prospect observation source key'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_observations) LOOP
    total:=total+1;
    IF jsonb_typeof(item)<>'object' OR item->>'schemaVersion'<>'prospect-observation-v1'
      OR coalesce(item->>'sourceKey','')!~'^[a-z][a-z0-9_.:-]{0,159}$'
      OR item->>'kind' NOT IN ('need','pain','interest','objection','qualification','authority','budget','timing','channel','preference','follow_up_request','clarification','other')
      OR coalesce(item->>'slot','')!~'^[a-z][a-z0-9_.:-]{0,119}$' OR nullif(btrim(coalesce(item->>'claim','')),'') IS NULL
      OR char_length(item->>'claim')>1000 OR item->>'claim'~*'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}' OR item->>'polarity' NOT IN ('affirmed','denied','unknown')
      OR item->>'basis' NOT IN ('explicit_statement','supported_inference')
      OR (item->>'confidence') IS NULL OR (item->>'confidence')::numeric<0 OR (item->>'confidence')::numeric>1
      OR (item ? 'uncertainty' AND item->'uncertainty'<>'null'::jsonb AND (jsonb_typeof(item->'uncertainty')<>'object' OR item#>>'{uncertainty,kind}' NOT IN ('asr','ambiguous','incomplete','inference')))
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid prospect observation'; END IF;
    expected_hash:=encode(extensions.digest(pg_catalog.convert_to((item-'sourceKey'-'schemaVersion')::text,'UTF8'),'sha256'),'hex');
    SELECT * INTO existing FROM public.prospect_observations
      WHERE lead_id=i.lead_id AND source_interpretation_id=i.id AND source_key=item->>'sourceKey' FOR SHARE;
    IF existing.id IS NOT NULL AND existing.content_hash IS DISTINCT FROM expected_hash
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation projection conflicts'; END IF;
  END LOOP;
  SELECT count(*) INTO prior FROM public.prospect_observations WHERE source_interpretation_id=i.id;
  IF prior>0 AND prior<>total THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation projection is incomplete'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_observations) LOOP
    expected_hash:=encode(extensions.digest(pg_catalog.convert_to((item-'sourceKey'-'schemaVersion')::text,'UTF8'),'sha256'),'hex');
    INSERT INTO public.prospect_observations(owner_id,business_id,business_representation_id,lead_id,source_interpretation_id,
      source_conversation_output_id,source_mission_id,observation_schema_version,source_key,kind,slot,claim,value,polarity,basis,
      confidence,uncertainty,content_hash,observed_at)
    VALUES(i.tenant_user_id,i.business_id,i.business_representation_id,i.lead_id,i.id,i.conversation_output_id,i.mission_id,
      'prospect-observation-v1',item->>'sourceKey',item->>'kind',item->>'slot',btrim(item->>'claim'),item->'value',item->>'polarity',
      item->>'basis',(item->>'confidence')::numeric,item->'uncertainty',expected_hash,coalesce(o.completed_at,o.captured_at,o.created_at))
    ON CONFLICT(lead_id,source_interpretation_id,source_key) DO NOTHING;
    IF FOUND THEN inserted:=inserted+1; END IF;
  END LOOP;
  RETURN QUERY SELECT total,inserted,inserted=0;
END $$;

CREATE FUNCTION public.zeya_persist_prospect_observation_relation(p_owner_id uuid,p_subject_id uuid,p_object_id uuid,p_relation text,p_rationale text,p_source_interpretation_id uuid DEFAULT NULL)
RETURNS TABLE(relation_id uuid,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.prospect_observations%ROWTYPE; o public.prospect_observations%ROWTYPE; r public.prospect_observation_relations%ROWTYPE; rid uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized'; END IF;
  IF p_subject_id=p_object_id OR p_relation NOT IN ('supersedes','contradicts','resolves_uncertainty','invalidates') OR nullif(btrim(coalesce(p_rationale,'')),'') IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid prospect observation relation'; END IF;
  SELECT * INTO s FROM public.prospect_observations WHERE id=p_subject_id AND owner_id=p_owner_id FOR SHARE;
  SELECT * INTO o FROM public.prospect_observations WHERE id=p_object_id AND owner_id=p_owner_id FOR SHARE;
  IF s.id IS NULL OR o.id IS NULL OR s.lead_id<>o.lead_id OR s.business_id<>o.business_id OR s.business_representation_id<>o.business_representation_id
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation relation lineage conflicts'; END IF;
  IF p_relation IN ('supersedes','resolves_uncertainty') AND (s.slot<>o.slot OR s.basis<>'explicit_statement' OR s.uncertainty IS NOT NULL)
    OR p_relation='resolves_uncertainty' AND o.uncertainty IS NULL
    OR p_relation='contradicts' AND s.slot<>o.slot
    OR p_source_interpretation_id IS NOT NULL AND (p_source_interpretation_id<>s.source_interpretation_id OR NOT EXISTS(SELECT 1 FROM public.conversation_interpretations i WHERE i.id=p_source_interpretation_id AND i.tenant_user_id=p_owner_id))
  THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation relation is not supported'; END IF;
  SELECT * INTO r FROM public.prospect_observation_relations WHERE subject_observation_id=s.id AND object_observation_id=o.id AND relation=p_relation FOR SHARE;
  IF r.id IS NOT NULL THEN
    IF r.rationale<>btrim(p_rationale) OR r.source_interpretation_id IS DISTINCT FROM p_source_interpretation_id
    THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='prospect observation relation conflicts'; END IF;
    RETURN QUERY SELECT r.id,true; RETURN;
  END IF;
  INSERT INTO public.prospect_observation_relations(owner_id,business_id,business_representation_id,lead_id,subject_observation_id,object_observation_id,relation,rationale,source_interpretation_id)
  VALUES(p_owner_id,s.business_id,s.business_representation_id,s.lead_id,s.id,o.id,p_relation,btrim(p_rationale),p_source_interpretation_id) RETURNING id INTO rid;
  RETURN QUERY SELECT rid,false;
END $$;

REVOKE ALL ON FUNCTION public.zeya_project_prospect_observations(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.zeya_persist_prospect_observation_relation(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_project_prospect_observations(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.zeya_persist_prospect_observation_relation(uuid,uuid,uuid,text,text,uuid) TO service_role;

-- Extend existing immutable governed triggers only for the established, service-role-only controlled purge transaction.
CREATE OR REPLACE FUNCTION public.zeya_enforce_conversation_interpretation_immutability() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='conversation interpretation is immutable';
END $$;
CREATE OR REPLACE FUNCTION public.zeya_p24_immutable_execution_context() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution contexts are immutable';
END $$;
CREATE OR REPLACE FUNCTION public.zeya_p25_preserve_dispatch() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_brief public.worker_briefs%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.worker_brief_id IS NOT NULL THEN SELECT brief.* INTO v_brief FROM public.worker_briefs brief WHERE brief.id=NEW.worker_brief_id; END IF;
    IF NEW.execution_context_id IS NOT NULL THEN
      IF v_brief.id IS NULL OR v_brief.execution_context_id IS DISTINCT FROM NEW.execution_context_id OR v_brief.operating_mission_id IS DISTINCT FROM NEW.mission_id
        OR v_brief.owner_id IS DISTINCT FROM NEW.owner_id OR v_brief.source_fingerprint IS DISTINCT FROM NEW.source_fingerprint OR v_brief.execution_allowed IS DISTINCT FROM NEW.execution_allowed
      THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed dispatch brief lineage is incomplete'; END IF;
    ELSIF v_brief.execution_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed worker brief requires governed dispatch'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN IF OLD.execution_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed dispatch is immutable'; END IF; RETURN OLD; END IF;
  IF OLD.execution_context_id IS NOT NULL AND (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.business_representation_id IS DISTINCT FROM OLD.business_representation_id
    OR NEW.mission_id IS DISTINCT FROM OLD.mission_id OR NEW.execution_context_id IS DISTINCT FROM OLD.execution_context_id OR NEW.representation_version_id IS DISTINCT FROM OLD.representation_version_id
    OR NEW.mandate_outcome_package_id IS DISTINCT FROM OLD.mandate_outcome_package_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.worker_role IS DISTINCT FROM OLD.worker_role
    OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.preparation_operation_id IS DISTINCT FROM OLD.preparation_operation_id OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.execution_allowed IS DISTINCT FROM OLD.execution_allowed OR NEW.worker_brief_id IS DISTINCT FROM OLD.worker_brief_id OR NEW.agent_brief IS DISTINCT FROM OLD.agent_brief)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed dispatch lineage is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.zeya_p25_immutable_worker_brief() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF OLD.execution_context_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='governed worker brief is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.zeya_p26_preserve_authorization() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id OR NEW.worker_brief_id<>OLD.worker_brief_id
    OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id OR NEW.representation_version_id<>OLD.representation_version_id
    OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id OR NEW.authorization_operation_id<>OLD.authorization_operation_id
    OR NEW.source_fingerprint<>OLD.source_fingerprint OR NEW.authorized_channel<>OLD.authorized_channel OR NEW.authorized_worker_role<>OLD.authorized_worker_role
    OR NEW.purpose<>OLD.purpose OR NEW.created_at<>OLD.created_at OR OLD.status='consumed' OR (OLD.status='authorized' AND (NEW.status<>'consumed' OR NEW.consumed_at IS NULL))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution authorization is immutable'; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.zeya_p26_preserve_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.authorization_id<>OLD.authorization_id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id
    OR NEW.worker_brief_id<>OLD.worker_brief_id OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id
    OR NEW.representation_version_id<>OLD.representation_version_id OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id
    OR NEW.execution_operation_id<>OLD.execution_operation_id OR NEW.source_fingerprint<>OLD.source_fingerprint OR NEW.target_fingerprint<>OLD.target_fingerprint
    OR NEW.provider<>OLD.provider OR NEW.claimed_at<>OLD.claimed_at OR OLD.status IN ('dispatched','failed')
    OR (OLD.status='claimed' AND NEW.status NOT IN ('dispatched','failed'))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution attempt is immutable'; END IF; RETURN NEW;
END $$;

ALTER FUNCTION public.zeya_purge_business_representation(uuid,uuid) RENAME TO zeya_purge_business_representation_pre_p29b;
CREATE FUNCTION public.zeya_purge_business_representation(p_business_representation_id uuid,p_expected_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual uuid; result jsonb; deleted jsonb:='{}'::jsonb; n integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='purge not authorized'; END IF;
  SELECT business_id INTO actual FROM public.business_representations WHERE id=p_business_representation_id FOR UPDATE;
  IF actual IS NULL OR actual<>p_expected_business_id THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='representation not found'; END IF;
  PERFORM pg_catalog.set_config('zeya.controlled_purge','on',true);
  DELETE FROM public.prospect_observation_relations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('prospect_observation_relations',n);
  DELETE FROM public.prospect_observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('prospect_observations',n);
  DELETE FROM public.mission_execution_outcomes WHERE mission_id IN (SELECT id FROM public.operating_missions WHERE business_representation_id=p_business_representation_id); GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('mission_execution_outcomes',n);
  DELETE FROM public.conversation_interpretations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('conversation_interpretations',n);
  DELETE FROM public.governed_execution_attempts WHERE mission_id IN (SELECT id FROM public.operating_missions WHERE business_representation_id=p_business_representation_id); GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('governed_execution_attempts',n);
  DELETE FROM public.governed_execution_authorizations WHERE mission_id IN (SELECT id FROM public.operating_missions WHERE business_representation_id=p_business_representation_id); GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('governed_execution_authorizations',n);
  DELETE FROM public.brief_conversation_mappings WHERE business_id=p_expected_business_id AND mission_id IN (SELECT id::text FROM public.operating_missions WHERE business_representation_id=p_business_representation_id);
  DELETE FROM public.dispatches WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('dispatches',n);
  DELETE FROM public.worker_briefs WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('worker_briefs',n);
  DELETE FROM public.mission_execution_contexts WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('mission_execution_contexts',n);
  DELETE FROM public.operating_missions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('operating_missions',n);
  DELETE FROM public.mission_leads WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('mission_leads',n);
  result:=public.zeya_purge_business_representation_pre_p29b(p_business_representation_id,p_expected_business_id);
  PERFORM pg_catalog.set_config('zeya.controlled_purge','off',true);
  RETURN result||jsonb_build_object('p29bDeleted',deleted);
EXCEPTION WHEN OTHERS THEN PERFORM pg_catalog.set_config('zeya.controlled_purge','off',true); RAISE;
END $$;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation_pre_p29b(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) TO service_role;

COMMIT;
