\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

-- Reproduces Martin's exact pinned QA graph shape for the one-time reset RPC.
-- The reset RPC hardcodes these exact owner/business/representation ids, so
-- local verification must use the same ids (safe: disposable local DB only).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password)
VALUES ('332d2299-0657-4d90-b43b-bda03bff6175','00000000-0000-0000-0000-000000000000','authenticated','authenticated','martin@mindrasolutions.com','x')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.businesses (id,user_id,business_name)
VALUES ('049d1a9c-c0dc-4113-ab31-44633e5a4141','332d2299-0657-4d90-b43b-bda03bff6175','Martin QA Business');

INSERT INTO public.business_representations (id,business_id,user_id)
VALUES ('886b773d-5c26-42e1-8089-17ae3c28fa96','049d1a9c-c0dc-4113-ab31-44633e5a4141','332d2299-0657-4d90-b43b-bda03bff6175');

INSERT INTO public.direct_hire_onboarding_sessions
 (id,owner_id,business_id,business_representation_id,owner_relationship_name,website_url,phone_e164,growth_priority,onboarding_state,preparation_status,profile_business_name,induction_state)
VALUES ('ba000000-0000-0000-0000-000000000001','332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','Owner','https://mindrasolutions.com','+66800000009','Growth','employment_accepted','ready','Martin QA Business','preparation_pending');

INSERT INTO public.direct_hire_working_sessions
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,scheduled_at,scheduling_timezone,status,preparation_status,preparation_snapshot_fingerprint,preparation_contract_version)
VALUES ('15000000-0000-0000-0000-000000000001','332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','ba000000-0000-0000-0000-000000000001',now()+interval '1 day','Asia/Bangkok','scheduled','ready','snapshot-martin-qa','first-working-session-preparation-v6');

INSERT INTO public.evidence (id,business_representation_id,direct_hire_onboarding_session_id,source_type,raw_statement,statement_hash,captured_by_actor)
VALUES ('e5000000-0000-0000-0000-000000000001','886b773d-5c26-42e1-8089-17ae3c28fa96','ba000000-0000-0000-0000-000000000001','direct_hire_induction','Owner supplied business context','e5000000-0000-0000-0000-000000000001','local-qa-reset-test');

INSERT INTO public.observations (id,business_representation_id,evidence_id,interpreted_meaning,confidence_in_interpretation,supporting_evidence_ids,created_by_actor)
VALUES ('0b000000-0000-0000-0000-000000000001','886b773d-5c26-42e1-8089-17ae3c28fa96','e5000000-0000-0000-0000-000000000001','A QA observation',80,ARRAY['e5000000-0000-0000-0000-000000000001']::uuid[],'local-qa-reset-test');

INSERT INTO public.hypotheses
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,constitutional_domain,hypothesis_version,epistemic_state,current_belief,confidence,representation_risk,risk_reason,evidence_cutoff_at,created_by_actor,request_trace_id)
SELECT ('d6000000-0000-0000-0000-00000000000'||n)::uuid,'332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','ba000000-0000-0000-0000-000000000001',d,1,'unknown',NULL,'unknown','low',NULL,now(),'local-qa-reset-test','trace-martin-qa'
FROM unnest(ARRAY['whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription','authorityBoundaries','clarificationsNeeded']) WITH ORDINALITY x(d,n);

INSERT INTO public.direct_hire_first_working_session_briefs
 (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,direct_hire_working_session_id,source_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version,brief,source_hypothesis_ids,current)
VALUES ('b7000000-0000-0000-0000-000000000001','332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','ba000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','snapshot-martin-qa','trace-martin-qa','first-working-session-preparation-v6','{}','{}',true);

-- Formation: immutable_snapshot_v6 mode, with a real prepared-context
-- snapshot, handoff, agenda item, and one governed conversation turn.
INSERT INTO public.representation_formation_sessions
 (id,business_id,business_representation_id,owner_id,status,initiated_from,initiated_from_id,prepared_context_mode)
VALUES ('f0000000-0000-0000-0000-000000000001','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','332d2299-0657-4d90-b43b-bda03bff6175','working_conversation_pending','direct_hire_onboarding','ba000000-0000-0000-0000-000000000001','immutable_snapshot_v6');

UPDATE public.direct_hire_working_sessions SET formation_session_id='f0000000-0000-0000-0000-000000000001' WHERE id='15000000-0000-0000-0000-000000000001';
UPDATE public.direct_hire_onboarding_sessions SET formation_session_id='f0000000-0000-0000-0000-000000000001' WHERE id='ba000000-0000-0000-0000-000000000001';

INSERT INTO public.direct_hire_first_working_session_formation_handoffs
 (id,formation_session_id,direct_hire_working_session_id,direct_hire_onboarding_session_id,business_representation_id,owner_id,business_id,preparation_brief_id,preparation_snapshot_fingerprint,hypothesis_trace_fingerprint,preparation_contract_version,handoff_source,handed_off_by_actor)
VALUES ('a9000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','886b773d-5c26-42e1-8089-17ae3c28fa96','332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','b7000000-0000-0000-0000-000000000001','snapshot-martin-qa','trace-martin-qa','first-working-session-preparation-v6','direct_hire_first_working_session','service_role');

INSERT INTO public.direct_hire_first_working_session_formation_agenda_items
 (id,formation_handoff_id,formation_session_id,agenda_item_id,rank,category,constitutional_domain,risk,blocking,resolution_status,source_brief_sections,question_intent,created_from_snapshot_fingerprint)
VALUES ('ad000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','agenda_bbbbbbbbbbbbbbbbbbbbbbbb',1,'authority','authorityBoundaries','high',true,'unresolved',ARRAY['authorityGaps'],'QA agenda item','snapshot-martin-qa');

INSERT INTO public.direct_hire_formation_prepared_context
 (formation_session_id,direct_hire_working_session_id,business_representation_id,preparation_brief_id,hypothesis_snapshot_ids,preparation_contract_version,reasoning_contract_version)
SELECT 'f0000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','886b773d-5c26-42e1-8089-17ae3c28fa96','b7000000-0000-0000-0000-000000000001',array_agg(id ORDER BY id),'first-working-session-preparation-v6','1.1-source-semantics'
FROM public.hypotheses WHERE business_representation_id='886b773d-5c26-42e1-8089-17ae3c28fa96';

INSERT INTO public.direct_hire_formation_conversation_runs
 (id,formation_session_id,formation_handoff_id,direct_hire_working_session_id,owner_id,business_id,business_representation_id,preparation_snapshot_fingerprint,hypothesis_trace_fingerprint,status)
VALUES ('c8000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','332d2299-0657-4d90-b43b-bda03bff6175','049d1a9c-c0dc-4113-ab31-44633e5a4141','886b773d-5c26-42e1-8089-17ae3c28fa96','snapshot-martin-qa','trace-martin-qa','active');

INSERT INTO public.direct_hire_formation_conversation_turns
 (id,run_id,sequence,agenda_item_id,speaker,owner_safe_text,turn_type)
VALUES ('c9000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001',1,'ad000000-0000-0000-0000-000000000001','zeya','QA turn text','primary_question');

SELECT 'ONE_TIME_MARTIN_QA_RESET_FIXTURE_PASS' result;
