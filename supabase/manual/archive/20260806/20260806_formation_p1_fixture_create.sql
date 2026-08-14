-- Formation P1 controlled Preview fixture creation. Confirm project hdjojgvvlojbhgidirht.
BEGIN;
DO $fixture$
DECLARE
  v_owner_id constant uuid := 'da53cf7f-beb1-4168-a0cb-015610f092fc';
  v_owner_email constant text := 'mdubreu@gmail.com';
  v_fixture_key constant text := 'zeya:preview:formation_p1:20260806';
  v_business_id uuid;
  v_representation_id uuid;
  v_formation_id uuid;
  v_status public.formation_session_status;
  v_count bigint;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='privileged Preview SQL Editor required'; END IF;
  PERFORM 1 FROM auth.users AS auth_user WHERE auth_user.id=v_owner_id AND auth_user.email=v_owner_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact QA Auth identity not found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner_id::text,0));
  SELECT (SELECT count(*) FROM public.businesses WHERE user_id=v_owner_id)
    +(SELECT count(*) FROM public.business_representations WHERE user_id=v_owner_id)
    +(SELECT count(*) FROM public.representation_formation_sessions WHERE owner_id=v_owner_id)
    +(SELECT count(*) FROM public.direct_hire_onboarding_sessions WHERE owner_id=v_owner_id)
    +(SELECT count(*) FROM public.public_experience_sessions WHERE tenant_user_id=v_owner_id)
  INTO v_count;
  IF v_count<>0 THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='QA owner is not clean'; END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE business_profile->>'fixture_key'=v_fixture_key) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='Formation fixture marker already exists';
  END IF;
  INSERT INTO public.businesses(user_id,business_name,industry,business_profile)
  VALUES(v_owner_id,'ZEYA QA Formation P1 Fixture','Preview QA',jsonb_build_object('fixture_key',v_fixture_key))
  RETURNING id INTO v_business_id;
  INSERT INTO public.business_representations(business_id,user_id,current_phase,current_version_id)
  VALUES(v_business_id,v_owner_id,'surface'::public.representation_phase,NULL)
  RETURNING id INTO v_representation_id;
  PERFORM pg_catalog.set_config('request.jwt.claim.role','service_role',true);
  SELECT initiated.session_id,initiated.status INTO v_formation_id,v_status
  FROM public.zeya_initiate_formation_session(v_business_id,v_representation_id,v_owner_id,'owner_request'::public.formation_initiation_source,NULL) AS initiated;
  PERFORM public.zeya_advance_formation_status(v_formation_id,v_representation_id,'initiated','getting_familiar','{}'::jsonb);
  PERFORM public.zeya_advance_formation_status(v_formation_id,v_representation_id,'getting_familiar','working_conversation_pending','{}'::jsonb);
  SELECT formation.status INTO v_status FROM public.representation_formation_sessions AS formation WHERE formation.id=v_formation_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'working_conversation_pending'::public.formation_session_status
    OR EXISTS (SELECT 1 FROM public.representation_formation_sessions WHERE id=v_formation_id AND first_working_conversation_id IS NOT NULL)
    OR (SELECT count(*) FROM public.businesses WHERE id=v_business_id AND user_id=v_owner_id)<>1
    OR (SELECT count(*) FROM public.business_representations WHERE id=v_representation_id AND business_id=v_business_id AND user_id=v_owner_id AND current_phase='surface' AND current_version_id IS NULL)<>1
    OR (SELECT count(*) FROM public.representation_versions WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.representation_proposals WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.evidence WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.approval_decisions WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.direct_hire_onboarding_sessions WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.public_experience_sessions WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.voice_conversation_outputs WHERE business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.dispatches WHERE user_id=v_owner_id)<>0 THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='Formation fixture postcondition failed';
  END IF;
  RAISE NOTICE 'fixture_business_id=%',v_business_id;
  RAISE NOTICE 'fixture_representation_id=%',v_representation_id;
  RAISE NOTICE 'fixture_formation_id=%',v_formation_id;
END;
$fixture$;
SELECT business.id AS business_id,representation.id AS representation_id,
  formation.id AS formation_session_id,true AS fixture_created,
  formation.status='working_conversation_pending' AS status_ready,
  representation.current_version_id IS NULL AS canonical_absent
FROM public.businesses AS business
JOIN public.business_representations AS representation ON representation.business_id=business.id
JOIN public.representation_formation_sessions AS formation ON formation.business_representation_id=representation.id
WHERE business.user_id='da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid
  AND business.business_profile->>'fixture_key'='zeya:preview:formation_p1:20260806';
COMMIT;
