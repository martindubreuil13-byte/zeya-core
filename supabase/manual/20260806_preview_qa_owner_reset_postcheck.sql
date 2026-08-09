-- Zeya Preview QA owner reset postcheck (STRICTLY READ-ONLY).
-- Confirm the SQL Editor project is hdjojgvvlojbhgidirht before use.

WITH target AS (
  SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id,
    'mdubreu@gmail.com'::text owner_email
), businesses AS (
  SELECT business.id FROM public.businesses AS business CROSS JOIN target
  WHERE business.user_id=target.owner_id
), representations AS (
  SELECT representation.id,representation.current_version_id
  FROM public.business_representations AS representation CROSS JOIN target
  WHERE representation.user_id=target.owner_id
), experiences AS (
  SELECT experience.id,experience.dispatch_id
  FROM public.public_experience_sessions AS experience CROSS JOIN target
  WHERE experience.tenant_user_id=target.owner_id
), target_business_history AS (
  SELECT business.id FROM businesses AS business
), totals AS (
  SELECT
    (SELECT count(*) FROM businesses)::bigint AS business_count,
    (SELECT count(*) FROM representations)::bigint AS representation_count,
    (SELECT count(*) FROM public.representation_versions AS version WHERE version.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS version_count,
    (SELECT count(*) FROM representations AS representation WHERE representation.current_version_id IS NOT NULL)::bigint AS canonical_pointer_count,
    (SELECT count(*) FROM public.representation_domains AS domain WHERE domain.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS domain_count,
    (SELECT count(*) FROM public.representation_elements AS element WHERE element.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS element_count,
    (SELECT count(*) FROM public.representation_formation_sessions AS formation CROSS JOIN target WHERE formation.owner_id=target.owner_id)::bigint AS formation_count,
    (SELECT count(*) FROM public.representation_proposals AS proposal WHERE proposal.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS proposal_count,
    (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS evidence_count,
    (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.source_formation_session_id IS NOT NULL AND evidence.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS correction_evidence_count,
    (SELECT count(*) FROM public.evidence AS evidence WHERE evidence.direct_hire_onboarding_session_id IS NOT NULL AND evidence.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS website_evidence_count,
    (SELECT count(*) FROM public.observations AS observation WHERE observation.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS observation_count,
    (SELECT count(*) FROM public.observations AS observation WHERE observation.website_observation_key IS NOT NULL AND observation.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS website_observation_count,
    (SELECT count(*) FROM public.approval_decisions AS approval WHERE approval.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS approval_count,
    (SELECT count(*) FROM public.confidence_assessments AS confidence WHERE confidence.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS confidence_count,
    (SELECT count(*) FROM public.audit_events AS audit WHERE audit.business_representation_id IN (SELECT representation.id FROM representations AS representation))::bigint AS audit_count,
    (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target WHERE direct_hire.owner_id=target.owner_id)::bigint AS direct_hire_count,
    (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target WHERE direct_hire.owner_id=target.owner_id AND (direct_hire.preparation_status='running' OR direct_hire.preparation_lease_expires_at>now()))::bigint AS active_preparation_count,
    (SELECT count(*) FROM experiences)::bigint AS public_experience_count,
    (SELECT count(*) FROM public.public_experience_test_records AS test_record WHERE test_record.public_experience_session_id IN (SELECT experience.id FROM experiences AS experience))::bigint AS experience_test_record_count,
    (SELECT count(*) FROM public.public_experience_representation_briefs AS brief WHERE brief.public_experience_session_id IN (SELECT experience.id FROM experiences AS experience))::bigint AS brief_count,
    (SELECT count(*) FROM public.public_experience_brief_responses AS response WHERE response.public_experience_session_id IN (SELECT experience.id FROM experiences AS experience))::bigint AS brief_response_count,
    (SELECT count(*) FROM public.voice_provider_webhook_receipts AS webhook WHERE webhook.public_experience_session_id IN (SELECT experience.id FROM experiences AS experience))::bigint AS webhook_count,
    (SELECT count(*) FROM public.voice_representation_lineage AS lineage CROSS JOIN target WHERE lineage.tenant_user_id=target.owner_id)::bigint AS voice_lineage_count,
    (SELECT count(*) FROM public.voice_conversation_outputs AS output CROSS JOIN target WHERE output.tenant_user_id=target.owner_id)::bigint AS voice_output_count,
    (SELECT count(*) FROM public.voice_conversation_candidates AS candidate CROSS JOIN target WHERE candidate.tenant_user_id=target.owner_id)::bigint AS voice_candidate_count,
    (SELECT count(*) FROM public.conversation_candidate_review_decisions AS review CROSS JOIN target WHERE review.tenant_user_id=target.owner_id)::bigint AS review_count,
    (SELECT count(*) FROM public.conversation_candidate_promotions AS promotion CROSS JOIN target WHERE promotion.tenant_user_id=target.owner_id)::bigint AS promotion_count,
    (SELECT count(*) FROM public.conversation_candidate_canonicalizations AS canonicalization CROSS JOIN target WHERE canonicalization.tenant_user_id=target.owner_id)::bigint AS canonicalization_count,
    (SELECT count(*) FROM public.memory_events AS memory WHERE memory.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS memory_event_count,
    (SELECT count(*) FROM public.call_outcomes AS outcome WHERE outcome.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS call_outcome_count,
    (SELECT count(*) FROM public.worker_briefs AS worker_brief WHERE worker_brief.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS worker_brief_count,
    (SELECT count(*) FROM public.brief_conversation_mappings AS mapping WHERE mapping.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS brief_mapping_count,
    (SELECT count(*) FROM public.dispatches AS dispatch CROSS JOIN target WHERE dispatch.user_id=target.owner_id)::bigint AS dispatch_count,
    (SELECT count(*) FROM public.dispatch_events AS dispatch_event CROSS JOIN target WHERE dispatch_event.user_id=target.owner_id)::bigint AS dispatch_event_count,
    (SELECT count(*) FROM public.mission_assignments AS assignment WHERE assignment.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS mission_assignment_count,
    (SELECT count(*) FROM public.mission_leads AS lead WHERE lead.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS mission_lead_count,
    (SELECT count(*) FROM public.sales_agents AS agent WHERE agent.business_id IN (SELECT business.id FROM target_business_history AS business))::bigint AS sales_agent_count,
    (SELECT count(*) FROM auth.users AS auth_user CROSS JOIN target WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)::bigint AS auth_identity_count,
    CASE WHEN current_setting('zeya.controlled_purge',true)='on' THEN 1 ELSE 0 END::bigint AS controlled_purge_active_count
)
SELECT totals.*,
  (to_jsonb(totals)-'auth_identity_count'-'controlled_purge_active_count') =
    jsonb_build_object(
      'business_count',0,'representation_count',0,'version_count',0,'canonical_pointer_count',0,
      'domain_count',0,'element_count',0,'formation_count',0,'proposal_count',0,
      'evidence_count',0,'correction_evidence_count',0,'website_evidence_count',0,
      'observation_count',0,'website_observation_count',0,'approval_count',0,
      'confidence_count',0,'audit_count',0,'direct_hire_count',0,'active_preparation_count',0,
      'public_experience_count',0,'experience_test_record_count',0,'brief_count',0,
      'brief_response_count',0,'webhook_count',0,'voice_lineage_count',0,'voice_output_count',0,
      'voice_candidate_count',0,'review_count',0,'promotion_count',0,'canonicalization_count',0
      ,'memory_event_count',0,'call_outcome_count',0,'worker_brief_count',0
      ,'brief_mapping_count',0,'dispatch_count',0,'dispatch_event_count',0,'mission_assignment_count',0
      ,'mission_lead_count',0,'sales_agent_count',0
    )
    AND totals.auth_identity_count=1
    AND totals.controlled_purge_active_count=0 AS post_purge_ready_for_reuse
FROM totals AS totals;

-- Optional legacy inventory. The reset conditionally deletes these when present.
SELECT optional.table_name,
  to_regclass('public.'||optional.table_name) IS NOT NULL AS relation_present,
  EXISTS (
    SELECT 1 FROM information_schema.columns AS column_info
    WHERE column_info.table_schema='public'
      AND column_info.table_name=optional.table_name
      AND column_info.column_name=optional.lineage_column
  ) AS expected_lineage_column_present
FROM (VALUES
  ('sessions','business_id'),
  ('messages','session_id'),
  ('knowledge_assets','business_id')
) AS optional(table_name,lineage_column)
ORDER BY optional.table_name;
