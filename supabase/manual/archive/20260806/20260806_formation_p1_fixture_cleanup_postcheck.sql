-- Formation P1 fixture cleanup postcheck (STRICTLY READ-ONLY).
WITH target AS (SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id,'mdubreu@gmail.com'::text owner_email), counts AS (
  SELECT
    (SELECT count(*) FROM public.businesses AS business CROSS JOIN target WHERE business.user_id=target.owner_id)::bigint business_count,
    (SELECT count(*) FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id)::bigint representation_count,
    (SELECT count(*) FROM public.representation_formation_sessions AS formation CROSS JOIN target WHERE formation.owner_id=target.owner_id)::bigint formation_count,
    (SELECT count(*) FROM public.representation_versions AS version WHERE version.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint version_count,
    (SELECT count(*) FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id AND representation.current_version_id IS NOT NULL)::bigint canonical_pointer_count,
    (SELECT count(*) FROM public.representation_proposals AS proposal WHERE proposal.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint proposal_count,
    (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint evidence_count,
    (SELECT count(*) FROM public.observations AS observation WHERE observation.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint observation_count,
    (SELECT count(*) FROM public.approval_decisions AS approval WHERE approval.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint approval_count,
    (SELECT count(*) FROM public.audit_events AS audit WHERE audit.business_representation_id IN (SELECT representation.id FROM public.business_representations AS representation CROSS JOIN target WHERE representation.user_id=target.owner_id))::bigint audit_count,
    (SELECT count(*) FROM auth.users AS auth_user CROSS JOIN target WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)::bigint auth_identity_count
)
SELECT counts.*,to_jsonb(counts)-'auth_identity_count'=jsonb_build_object('business_count',0,'representation_count',0,'formation_count',0,'version_count',0,'canonical_pointer_count',0,'proposal_count',0,'evidence_count',0,'observation_count',0,'approval_count',0,'audit_count',0)
  AND counts.auth_identity_count=1 AS ready_for_reuse
FROM counts;
