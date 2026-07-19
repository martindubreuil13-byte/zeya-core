-- Phase 5B-B rollback. Removes only 5B-B objects and restores the prior purge body.
BEGIN;
DROP FUNCTION IF EXISTS public.zeya_promote_voice_candidate_to_canonical(uuid,uuid,uuid,jsonb,text,uuid,jsonb,smallint,text);
DROP TABLE IF EXISTS public.conversation_candidate_canonicalizations;
DROP FUNCTION IF EXISTS public.zeya_enforce_conversation_candidate_canonicalization_immutability();
DROP INDEX IF EXISTS public.confidence_assessments_canonicalization_identity_idx;
DROP INDEX IF EXISTS public.approval_decisions_canonicalization_identity_idx;
DROP INDEX IF EXISTS public.representation_proposals_id_representation_idx;

CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation(p_business_representation_id uuid,p_expected_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','auth','pg_temp' AS $$
DECLARE actual_business_id uuid; deleted jsonb:='{}'::jsonb; n integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='purge not authorized'; END IF;
 SELECT business_id INTO actual_business_id FROM public.business_representations WHERE id=p_business_representation_id FOR UPDATE;
 IF actual_business_id IS NULL OR actual_business_id<>p_expected_business_id THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='representation not found'; END IF;
 PERFORM set_config('zeya.controlled_purge','on',true);
 DELETE FROM public.audit_events WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('audit_events',n);
 DELETE FROM public.confidence_assessments WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('confidence_assessments',n);
 DELETE FROM public.conversation_candidate_promotions WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('conversation_candidate_promotions',n);
 DELETE FROM public.conversation_candidate_review_decisions WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('conversation_candidate_review_decisions',n);
 DELETE FROM public.voice_conversation_candidates WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_conversation_candidates',n);
 DELETE FROM public.voice_conversation_outputs WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_conversation_outputs',n);
 DELETE FROM public.voice_representation_lineage WHERE business_representation_id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('voice_representation_lineage',n);
 UPDATE public.business_representations SET current_version_id=NULL WHERE id=p_business_representation_id AND business_id=p_expected_business_id;
 UPDATE public.representation_elements SET current_value_version_id=NULL WHERE business_representation_id=p_business_representation_id;
 DELETE FROM public.representation_versions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_versions',n);
 DELETE FROM public.approval_decisions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('approval_decisions',n);
 DELETE FROM public.proposal_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_elements',n);
 DELETE FROM public.proposal_evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_evidence',n);
 DELETE FROM public.proposal_observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('proposal_observations',n);
 DELETE FROM public.representation_proposals WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_proposals',n);
 DELETE FROM public.observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('observations',n);
 DELETE FROM public.evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('evidence',n);
 DELETE FROM public.representation_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_elements',n);
 DELETE FROM public.representation_domains WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('representation_domains',n);
 DELETE FROM public.business_representations WHERE id=p_business_representation_id AND business_id=p_expected_business_id; GET DIAGNOSTICS n=ROW_COUNT; deleted=deleted||jsonb_build_object('business_representations',n);
 PERFORM set_config('zeya.controlled_purge','off',true);
 RETURN jsonb_build_object('businessRepresentationId',p_business_representation_id,'businessId',p_expected_business_id,'deleted',deleted);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('zeya.controlled_purge','off',true); RAISE;
END; $$;
ALTER FUNCTION public.zeya_purge_business_representation(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
