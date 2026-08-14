-- Exact-ID Formation P1 Preview fixture cleanup.
BEGIN;
DO $cleanup$
DECLARE
  v_owner_id constant uuid := 'da53cf7f-beb1-4168-a0cb-015610f092fc';
  v_owner_email constant text := 'mdubreu@gmail.com';
  v_fixture_key constant text := 'zeya:preview:formation_p1:20260806';
  v_business_id constant uuid := 'bab67c0d-8027-4315-8086-60a49679939d';
  v_representation_id constant uuid := '6caa5310-61d7-46cf-99b7-b5d915f0293f';
  v_formation_id constant uuid := 'ba339a69-35cc-4e98-b03b-2a2d4f8717b2';
  v_remaining bigint;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='privileged Preview SQL Editor required'; END IF;
  IF v_business_id IS NULL OR v_representation_id IS NULL OR v_formation_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='exact fixture IDs required'; END IF;
  PERFORM 1 FROM auth.users WHERE id=v_owner_id AND email=v_owner_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact QA Auth identity not found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner_id::text,0));
  IF (SELECT count(*) FROM public.businesses WHERE id=v_business_id AND user_id=v_owner_id AND business_profile->>'fixture_key'=v_fixture_key)<>1
    OR (SELECT count(*) FROM public.business_representations WHERE id=v_representation_id AND business_id=v_business_id AND user_id=v_owner_id)<>1
    OR (SELECT count(*) FROM public.representation_formation_sessions WHERE id=v_formation_id AND business_id=v_business_id AND business_representation_id=v_representation_id AND owner_id=v_owner_id)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='fixture lineage mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE user_id=v_owner_id AND id<>v_business_id)
    OR EXISTS (SELECT 1 FROM public.business_representations WHERE user_id=v_owner_id AND id<>v_representation_id)
    OR EXISTS (SELECT 1 FROM public.representation_formation_sessions WHERE owner_id=v_owner_id AND id<>v_formation_id)
    OR EXISTS (SELECT 1 FROM public.business_representations WHERE id=v_representation_id AND current_version_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.representation_versions WHERE business_representation_id=v_representation_id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='cleanup blocked by unrelated or canonical owner state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.public_experience_sessions WHERE business_representation_id=v_representation_id)
    OR EXISTS (SELECT 1 FROM public.direct_hire_onboarding_sessions WHERE business_representation_id=v_representation_id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='cleanup blocked by unexpected lifecycle lineage';
  END IF;
  PERFORM pg_catalog.set_config('zeya.controlled_purge','on',true);
  DELETE FROM public.conversation_candidate_canonicalizations WHERE business_representation_id=v_representation_id;
  DELETE FROM public.conversation_candidate_promotions WHERE business_representation_id=v_representation_id;
  DELETE FROM public.conversation_candidate_review_decisions WHERE business_representation_id=v_representation_id;
  DELETE FROM public.voice_conversation_candidates WHERE business_representation_id=v_representation_id;
  DELETE FROM public.proposal_elements WHERE business_representation_id=v_representation_id;
  DELETE FROM public.proposal_evidence WHERE business_representation_id=v_representation_id;
  DELETE FROM public.proposal_observations WHERE business_representation_id=v_representation_id;
  DELETE FROM public.approval_decisions WHERE business_representation_id=v_representation_id;
  DELETE FROM public.audit_events WHERE business_representation_id=v_representation_id;
  DELETE FROM public.confidence_assessments WHERE business_representation_id=v_representation_id;
  DELETE FROM public.evidence WHERE business_representation_id=v_representation_id;
  DELETE FROM public.observations WHERE business_representation_id=v_representation_id;
  DELETE FROM public.representation_proposals WHERE business_representation_id=v_representation_id;
  DELETE FROM public.representation_formation_sessions WHERE id=v_formation_id AND business_representation_id=v_representation_id;
  DELETE FROM public.voice_conversation_outputs WHERE business_representation_id=v_representation_id AND tenant_user_id=v_owner_id;
  DELETE FROM public.voice_representation_lineage WHERE business_representation_id=v_representation_id AND tenant_user_id=v_owner_id;
  DELETE FROM public.representation_elements WHERE business_representation_id=v_representation_id;
  DELETE FROM public.representation_domains WHERE business_representation_id=v_representation_id;
  DELETE FROM public.business_representations WHERE id=v_representation_id AND business_id=v_business_id AND user_id=v_owner_id;
  DELETE FROM public.businesses WHERE id=v_business_id AND user_id=v_owner_id;
  SELECT (SELECT count(*) FROM public.businesses WHERE id=v_business_id)
    +(SELECT count(*) FROM public.business_representations WHERE id=v_representation_id)
    +(SELECT count(*) FROM public.representation_formation_sessions WHERE id=v_formation_id)
    +(SELECT count(*) FROM public.representation_proposals WHERE business_representation_id=v_representation_id)
    +(SELECT count(*) FROM public.evidence WHERE business_representation_id=v_representation_id)
    +(SELECT count(*) FROM public.observations WHERE business_representation_id=v_representation_id)
    +(SELECT count(*) FROM public.voice_conversation_outputs WHERE business_representation_id=v_representation_id AND tenant_user_id=v_owner_id)
    +(SELECT count(*) FROM public.voice_representation_lineage WHERE business_representation_id=v_representation_id AND tenant_user_id=v_owner_id)
  INTO v_remaining;
  IF v_remaining<>0 OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner_id AND email=v_owner_email) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='fixture cleanup postcondition failed';
  END IF;
  PERFORM pg_catalog.set_config('zeya.controlled_purge','off',true);
END;
$cleanup$;
SELECT true AS cleanup_complete;
COMMIT;
