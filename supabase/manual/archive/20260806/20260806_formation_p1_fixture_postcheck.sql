-- Formation P1 fixture postcheck (STRICTLY READ-ONLY).
WITH target AS (SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id,'mdubreu@gmail.com'::text owner_email,'zeya:preview:formation_p1:20260806'::text fixture_key), fixture AS (
  SELECT business.id business_id,representation.id representation_id,representation.current_phase,
    representation.current_version_id,formation.id formation_id,formation.status,
    formation.initiated_from,formation.initiated_from_id,formation.first_working_conversation_id
  FROM public.businesses AS business CROSS JOIN target
  JOIN public.business_representations AS representation ON representation.business_id=business.id AND representation.user_id=target.owner_id
  JOIN public.representation_formation_sessions AS formation ON formation.business_id=business.id AND formation.business_representation_id=representation.id AND formation.owner_id=target.owner_id
  WHERE business.user_id=target.owner_id AND business.business_profile->>'fixture_key'=target.fixture_key
)
SELECT fixture.*,
  (SELECT count(*) FROM public.representation_proposals AS proposal WHERE proposal.business_representation_id=fixture.representation_id)::bigint proposal_count,
  (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.business_representation_id=fixture.representation_id)::bigint evidence_count,
  (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.business_representation_id=fixture.representation_id AND evidence.source_formation_session_id=fixture.formation_id)::bigint correction_evidence_count,
  (SELECT count(*) FROM public.approval_decisions AS approval WHERE approval.business_representation_id=fixture.representation_id)::bigint approval_count,
  (SELECT count(*) FROM public.representation_versions AS version WHERE version.business_representation_id=fixture.representation_id)::bigint version_count,
  (SELECT count(*) FROM public.public_experience_sessions AS experience WHERE experience.business_representation_id=fixture.representation_id)::bigint public_experience_count,
  (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire WHERE direct_hire.business_representation_id=fixture.representation_id)::bigint direct_hire_count,
  (SELECT count(*) FROM public.voice_conversation_outputs AS output WHERE output.business_representation_id=fixture.representation_id)::bigint voice_output_count,
  (SELECT count(*) FROM public.dispatches AS dispatch CROSS JOIN target WHERE dispatch.user_id=target.owner_id)::bigint dispatch_count,
  fixture.current_phase='surface' AND fixture.current_version_id IS NULL
    AND fixture.status='working_conversation_pending' AND fixture.initiated_from='owner_request'
    AND fixture.initiated_from_id IS NULL AND fixture.first_working_conversation_id IS NULL
    AND (SELECT count(*) FROM fixture)=1
    AND (SELECT count(*) FROM auth.users AS auth_user CROSS JOIN target WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)=1
    AND NOT EXISTS (SELECT 1 FROM public.representation_proposals WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.evidence WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.approval_decisions WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.representation_versions WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.public_experience_sessions WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.direct_hire_onboarding_sessions WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.voice_conversation_outputs WHERE business_representation_id=fixture.representation_id)
    AND NOT EXISTS (SELECT 1 FROM public.dispatches AS dispatch CROSS JOIN target WHERE dispatch.user_id=target.owner_id)
    AS fixture_postcheck_pass
FROM fixture;
