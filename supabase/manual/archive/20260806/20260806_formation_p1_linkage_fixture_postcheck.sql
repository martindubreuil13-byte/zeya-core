-- Formation P1 governed-linkage fixture postcheck (STRICTLY READ-ONLY).
WITH target AS (
  SELECT
    'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id,
    'mdubreu@gmail.com'::text AS owner_email,
    'bab67c0d-8027-4315-8086-60a49679939d'::uuid AS business_id,
    '6caa5310-61d7-46cf-99b7-b5d915f0293f'::uuid AS representation_id,
    'ba339a69-35cc-4e98-b03b-2a2d4f8717b2'::uuid AS formation_id,
    'f1060800-0000-4000-8000-000000000001'::uuid AS voice_context_id,
    'zeya:preview:formation_p1:linkage:20260806'::text AS linkage_fixture_key
), fixture AS (
  SELECT formation.status AS formation_status,
    formation.first_working_conversation_id AS linked_output_id,
    output.transcript_status AS output_transcript_status,
    output.completed_at IS NOT NULL AS output_completion_timestamp_present,
    output.representation_context_mode,
    output.canonical_version_id
  FROM target
  JOIN public.representation_formation_sessions AS formation
    ON formation.id=target.formation_id
      AND formation.business_id=target.business_id
      AND formation.business_representation_id=target.representation_id
      AND formation.owner_id=target.owner_id
  JOIN public.voice_conversation_outputs AS output
    ON output.id=formation.first_working_conversation_id
      AND output.voice_context_id=target.voice_context_id
      AND output.tenant_user_id=target.owner_id
      AND output.business_id=target.business_id
      AND output.business_representation_id=target.representation_id
      AND output.safe_metadata->>'fixture_key'=target.linkage_fixture_key
), counts AS (
  SELECT
    (SELECT count(*) FROM public.representation_proposals AS proposal CROSS JOIN target
      WHERE proposal.business_representation_id=target.representation_id)::bigint AS proposal_count,
    (SELECT count(*) FROM public.evidence AS evidence CROSS JOIN target
      WHERE evidence.business_representation_id=target.representation_id)::bigint AS evidence_count,
    (SELECT count(*) FROM public.approval_decisions AS approval CROSS JOIN target
      WHERE approval.business_representation_id=target.representation_id)::bigint AS approval_count,
    (SELECT count(*) FROM public.representation_versions AS version CROSS JOIN target
      WHERE version.business_representation_id=target.representation_id)::bigint AS version_count,
    (SELECT count(*) FROM public.business_representations AS representation CROSS JOIN target
      WHERE representation.id=target.representation_id
        AND representation.current_version_id IS NOT NULL)::bigint AS canonical_pointer_count,
    (SELECT count(*) FROM auth.users AS auth_user CROSS JOIN target
      WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)::bigint
      AS exact_auth_identity_count,
    (SELECT count(*) FROM public.voice_representation_lineage AS lineage CROSS JOIN target
      WHERE lineage.voice_context_id=target.voice_context_id
        AND lineage.tenant_user_id=target.owner_id
        AND lineage.business_id=target.business_id
        AND lineage.business_representation_id=target.representation_id
        AND lineage.canonical_version_id IS NULL
        AND lineage.representation_context_mode='pre_canonical'
        AND lineage.provisional_mode
        AND cardinality(lineage.authorized_element_keys)=0
        AND lineage.provider_call_id IS NULL)::bigint AS exact_lineage_count,
    (SELECT count(*) FROM public.public_experience_sessions AS experience CROSS JOIN target
      WHERE experience.business_representation_id=target.representation_id)::bigint
      AS public_experience_count,
    (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target
      WHERE direct_hire.business_representation_id=target.representation_id)::bigint
      AS direct_hire_count,
    (SELECT count(*) FROM public.dispatches AS dispatch CROSS JOIN target
      WHERE dispatch.user_id=target.owner_id)::bigint AS dispatch_count
)
SELECT fixture.formation_status,fixture.linked_output_id,
  fixture.output_transcript_status,fixture.output_completion_timestamp_present,
  fixture.representation_context_mode,fixture.canonical_version_id,
  counts.proposal_count,counts.evidence_count,counts.approval_count,
  counts.version_count,counts.canonical_pointer_count,
  (SELECT count(*) FROM fixture)=1
    AND fixture.formation_status='working_conversation_linked'
    AND fixture.linked_output_id IS NOT NULL
    AND fixture.output_transcript_status='finalized'
    AND fixture.output_completion_timestamp_present
    AND fixture.representation_context_mode='pre_canonical'
    AND fixture.canonical_version_id IS NULL
    AND counts.proposal_count=0 AND counts.evidence_count=0
    AND counts.approval_count=0 AND counts.version_count=0
    AND counts.canonical_pointer_count=0
    AND counts.exact_auth_identity_count=1 AND counts.exact_lineage_count=1
    AND counts.public_experience_count=0 AND counts.direct_hire_count=0
    AND counts.dispatch_count=0
    AS linkage_postcheck_pass
FROM fixture CROSS JOIN counts;
