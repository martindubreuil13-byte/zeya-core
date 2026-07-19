-- Phase 5B-B preflight. Must return one row with every boolean true.
SELECT
  to_regclass('public.voice_conversation_candidates') IS NOT NULL AS candidates_present,
  to_regclass('public.conversation_candidate_promotions') IS NOT NULL AS promotions_present,
  to_regclass('public.representation_proposals') IS NOT NULL AS proposals_present,
  to_regclass('public.approval_decisions') IS NOT NULL AS approvals_present,
  to_regclass('public.representation_versions') IS NOT NULL AS versions_present,
  to_regclass('public.confidence_assessments') IS NOT NULL AS confidence_present,
  to_regprocedure('public.zeya_promote_voice_conversation_candidate_internal(uuid,uuid,conversation_candidate_promotion_target,uuid,jsonb,text,uuid,evidence_source_type)') IS NOT NULL AS shared_core_present,
  to_regprocedure('public.zeya_create_canonical_version_atomic(uuid,uuid,uuid,jsonb,smallint,uuid,uuid)') IS NOT NULL AS atomic_writer_present,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='approval_decisions' AND column_name='approver_user_id' AND data_type='uuid') AS deployed_approval_contract,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='confidence_assessments' AND column_name='confidence_band') AS deployed_confidence_contract,
  NOT EXISTS (SELECT 1 FROM public.voice_conversation_candidates c JOIN public.business_representations br ON br.id=c.business_representation_id WHERE c.business_id<>br.business_id OR c.tenant_user_id<>br.user_id) AS candidate_tenants_consistent;

