-- Phase 5B-B post-deployment verification. Returns no rows only when all checks pass.
WITH checks(name, ok) AS (VALUES
 ('table_exists',to_regclass('public.conversation_candidate_canonicalizations') IS NOT NULL),
 ('required_columns',(SELECT count(*)=18 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversation_candidate_canonicalizations' AND column_name=ANY(ARRAY['id','promotion_id','review_decision_id','candidate_id','conversation_output_id','voice_context_id','tenant_user_id','business_id','business_representation_id','baseline_canonical_version_id','representation_proposal_id','approval_decision_id','canonical_version_id','confidence_assessment_id','actor_user_id','request_key','request_payload','request_hash']))),
 ('constraints_present',(SELECT count(*)>=20 FROM pg_constraint WHERE conrelid='public.conversation_candidate_canonicalizations'::regclass)),
 ('immutable_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.conversation_candidate_canonicalizations'::regclass AND tgname='zeya_conversation_candidate_canonicalization_immutability' AND NOT tgisinternal)),
 ('rls_enabled',(SELECT relrowsecurity FROM pg_class WHERE oid='public.conversation_candidate_canonicalizations'::regclass)),
 ('tenant_select_policy',EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversation_candidate_canonicalizations' AND roles='{authenticated}' AND cmd='SELECT' AND qual LIKE '%auth.uid()%')),
 ('direct_writes_blocked',NOT has_table_privilege('authenticated','public.conversation_candidate_canonicalizations','INSERT,UPDATE,DELETE') AND NOT has_table_privilege('service_role','public.conversation_candidate_canonicalizations','INSERT,UPDATE,DELETE')),
 ('orchestrator_exists',to_regprocedure('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)') IS NOT NULL),
 ('orchestrator_owner_postgres',(SELECT pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid='public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure)),
 ('orchestrator_service_only',has_function_privilege('service_role','public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)','EXECUTE') AND NOT has_function_privilege('anon','public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)','EXECUTE')),
 ('internal_core_postgres_only',NOT has_function_privilege('service_role','public.zeya_promote_voice_conversation_candidate_internal(uuid,uuid,conversation_candidate_promotion_target,uuid,jsonb,text,uuid,evidence_source_type)','EXECUTE')),
 ('shared_core_reference',(SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) LIKE '%zeya_promote_voice_conversation_candidate_internal%')),
 ('atomic_writer_reference',(SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) LIKE '%zeya_create_canonical_version_atomic%')),
 ('stale_baseline_guard',(SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) LIKE '%canonical baseline changed%')),
 ('confidence_insert',(SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) LIKE '%INSERT INTO public.confidence_assessments%')),
 ('provenance_insert',(SELECT pg_get_functiondef('public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text)'::regprocedure) LIKE '%INSERT INTO public.conversation_candidate_canonicalizations%')),
 ('controlled_purge',(SELECT pg_get_functiondef('public.zeya_purge_business_representation(uuid,uuid)'::regprocedure) LIKE '%conversation_candidate_canonicalizations%'))
) SELECT name AS failed_check FROM checks WHERE NOT ok;

