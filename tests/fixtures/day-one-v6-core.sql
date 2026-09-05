\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password)
VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v6@example.test','x');
INSERT INTO public.businesses (id,user_id,business_name)
VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','V6 Local'),
       ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Legacy Local');
INSERT INTO public.business_representations (id,business_id,user_id)
VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
       ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
INSERT INTO public.direct_hire_onboarding_sessions
 (id,owner_id,business_id,business_representation_id,owner_relationship_name,website_url,phone_e164,growth_priority,onboarding_state,preparation_status,profile_business_name,induction_state)
VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Owner','https://example.test','+66800000000','Growth','employment_accepted','ready','V6 Local','preparation_pending');
INSERT INTO public.direct_hire_working_sessions
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,scheduled_at,scheduling_timezone,status,preparation_status,preparation_snapshot_fingerprint,preparation_contract_version)
VALUES ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',now()+interval '1 day','Asia/Bangkok','scheduled','ready','snapshot-v6','first-working-session-preparation-v6');
INSERT INTO public.hypotheses
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,constitutional_domain,hypothesis_version,epistemic_state,current_belief,confidence,representation_risk,risk_reason,evidence_cutoff_at,created_by_actor)
SELECT ('60000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',d,1,'unknown',NULL,'unknown','low',NULL,now(),'local-v6-test'
FROM unnest(ARRAY['whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription','authorityBoundaries','clarificationsNeeded']) WITH ORDINALITY x(d,n);
DO $$ DECLARE h text; ids uuid[]; BEGIN
 SELECT array_agg(id ORDER BY id), encode(extensions.digest(coalesce(string_agg(id::text||':'||hypothesis_version::text||':'||coalesce(request_trace_id,''),'|' ORDER BY id::text||':'||hypothesis_version::text||':'||coalesce(request_trace_id,'')),''),'sha256'),'hex') INTO ids,h FROM public.hypotheses;
 INSERT INTO public.direct_hire_first_working_session_briefs
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,direct_hire_working_session_id,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version,brief,source_hypothesis_ids)
 VALUES ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','snapshot-v6',h,'first-working-session-preparation-v6','{}',ids);
 PERFORM * FROM public.zeya_initiate_direct_hire_first_working_session_formation('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','snapshot-v6',h,jsonb_build_array(jsonb_build_object('agendaItemId','agenda_0123456789abcdef01234567','rank',1,'category','authority','constitutionalDomain','authorityBoundaries','risk','high','blocking',true,'resolutionStatus','unresolved','sourceBriefSections',jsonb_build_array('authorityGaps'),'sourceHypothesisIds','[]'::jsonb,'sourceEvidenceIds','[]'::jsonb,'questionIntent','Clarify authority','createdFromSnapshotFingerprint','snapshot-v6')));
 IF (SELECT prepared_context_mode::text FROM public.representation_formation_sessions WHERE business_representation_id='30000000-0000-0000-0000-000000000001') <> 'immutable_snapshot_v6' THEN RAISE EXCEPTION 'mode persistence failed'; END IF;
END $$;

INSERT INTO public.representation_formation_sessions(id,business_id,business_representation_id,owner_id,status,initiated_from,initiated_from_id,prepared_context_mode)
VALUES ('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','initiated','direct_hire_onboarding','90000000-0000-0000-0000-000000000002',NULL);
DO $$ BEGIN
 IF (SELECT prepared_context_mode FROM public.representation_formation_sessions WHERE id='80000000-0000-0000-0000-000000000002') IS NOT NULL THEN RAISE EXCEPTION 'legacy null failed'; END IF;
 BEGIN UPDATE public.representation_formation_sessions SET prepared_context_mode='immutable_snapshot_v6' WHERE id='80000000-0000-0000-0000-000000000002'; RAISE EXCEPTION 'null mode mutation allowed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%formation_prepared_context_mode_immutable%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.representation_formation_sessions SET prepared_context_mode=NULL WHERE business_representation_id='30000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'snapshot mode mutation allowed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%formation_prepared_context_mode_immutable%' THEN RAISE; END IF; END;
 UPDATE public.representation_formation_sessions SET preparation_opening_acknowledged=true WHERE id='80000000-0000-0000-0000-000000000002';
END $$;
DO $$ DECLARE f uuid; ids uuid[]; BEGIN
 SELECT id INTO f FROM public.representation_formation_sessions WHERE business_representation_id='30000000-0000-0000-0000-000000000001'; SELECT array_agg(id ORDER BY id) INTO ids FROM public.hypotheses;
 PERFORM * FROM public.zeya_create_formation_prepared_context_snapshot(f,'50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',ids,'first-working-session-preparation-v6','formation-reasoning-v1');
 BEGIN UPDATE public.direct_hire_formation_prepared_context SET reasoning_contract_version='x' WHERE formation_session_id=f; RAISE EXCEPTION 'snapshot update allowed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%formation_prepared_context_immutable%' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.direct_hire_formation_prepared_context WHERE formation_session_id=f; RAISE EXCEPTION 'snapshot delete allowed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%formation_prepared_context_immutable%' THEN RAISE; END IF; END;
 BEGIN PERFORM * FROM public.zeya_create_formation_prepared_context_snapshot(f,'50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',ids,'first-working-session-preparation-v6','formation-reasoning-v1'); RAISE EXCEPTION 'duplicate did not normalize'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%formation_prepared_context_already_bound%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.direct_hire_formation_prepared_context WHERE formation_session_id=f) <> 1 THEN RAISE EXCEPTION 'snapshot cardinality failed'; END IF;
END $$;
SELECT 'V6_CORE_MATRIX_PASS' result;
