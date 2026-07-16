-- Read-only verification after the canonical insert-parity repair.
WITH f AS (
  SELECT p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid='public.zeya_promote_voice_conversation_candidate(uuid,public.conversation_candidate_promotion_target,uuid,jsonb,text,uuid,public.evidence_source_type)'::regprocedure
)
SELECT oid::regprocedure AS exact_signature,
  pg_get_userbyid(proowner) AS function_owner,
  prosecdef AS security_definer,
  proconfig AS function_configuration,
  proacl AS function_acl,
  has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon',oid,'EXECUTE') AS anon_execute,
  has_function_privilege('service_role',oid,'EXECUTE') AS service_role_execute,
  definition LIKE '%statement text; actor uuid; reason text;%' AS actor_is_uuid,
  definition LIKE '%actor:=auth.uid();%' AS actor_assignment_is_uuid,
  definition NOT LIKE '%auth.uid()::text%' AS actor_text_cast_absent,
  definition LIKE '%INSERT INTO public.evidence(business_representation_id,source_type,source_description,raw_statement,affected_domains,captured_by_actor)%' AS evidence_insert_matches_adapter,
  definition NOT LIKE '%INSERT INTO public.evidence(%statement_hash%' AS generated_hash_not_inserted,
  definition NOT LIKE '%INSERT INTO public.evidence(id,%' AS default_evidence_id_not_inserted,
  definition LIKE '%INSERT INTO public.observations(business_representation_id,evidence_id,interpreted_meaning,confidence_in_interpretation,affected_domains,affected_elements,created_by_actor)%' AS observation_insert_matches_adapter,
  definition LIKE '%INSERT INTO public.representation_proposals(business_representation_id,proposed_changes,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale)%' AS proposal_insert_matches_deployed_schema,
  definition NOT LIKE '%affected_element_ids,proposed_changes%' AS absent_proposal_array_insert,
  definition NOT LIKE '%supporting_observation_ids%' AS absent_supporting_observation_array_insert,
  definition NOT LIKE '%supporting_evidence_ids%' AS absent_supporting_evidence_array_insert,
  definition LIKE '%INSERT INTO public.proposal_evidence(proposal_id,evidence_id,business_representation_id)%' AS proposal_evidence_link_preserved,
  definition LIKE '%INSERT INTO public.proposal_observations(proposal_id,observation_id,business_representation_id)%' AS proposal_observation_link_preserved,
  definition LIKE '%INSERT INTO public.proposal_elements(proposal_id,element_id,business_representation_id)%' AS proposal_element_link_preserved,
  definition LIKE '%FOR UPDATE%' AS locking_preserved,
  definition LIKE '%candidate already promoted with different configuration%' AS idempotency_conflict_preserved,
  definition LIKE '%Evidence source turn indexes must be unique%' AS transcript_validation_preserved,
  md5(definition) AS definition_md5
FROM f;

SELECT a.attname AS column_name,
  pg_catalog.format_type(a.atttypid,a.atttypmod) AS exact_type,
  a.attnotnull AS not_null,a.attidentity AS identity_state,a.attgenerated AS generated_state,
  pg_get_expr(d.adbin,d.adrelid) AS exact_generation_expression
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname='evidence' AND a.attname='statement_hash'
  AND a.attnum>0 AND NOT a.attisdropped;

SELECT table_name,column_name,data_type,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated,generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('evidence','observations','representation_proposals','proposal_evidence','proposal_observations','proposal_elements')
ORDER BY table_name,ordinal_position;
