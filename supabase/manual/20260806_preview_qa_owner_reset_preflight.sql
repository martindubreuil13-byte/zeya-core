-- Zeya Preview QA owner reset preflight (STRICTLY READ-ONLY).
-- Confirm the SQL Editor project is hdjojgvvlojbhgidirht before use.
-- Target Auth identity is deliberately bound by both UUID and exact email.

WITH target AS (
  SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id,
    'mdubreu@gmail.com'::text AS owner_email
), auth_target AS (
  SELECT users.id, users.email
  FROM auth.users AS users CROSS JOIN target
  WHERE users.id = target.owner_id AND users.email = target.owner_email
), businesses AS (
  SELECT b.id FROM public.businesses b CROSS JOIN target WHERE b.user_id = target.owner_id
), representations AS (
  SELECT r.id, r.business_id, r.current_version_id
  FROM public.business_representations r CROSS JOIN target
  WHERE r.user_id = target.owner_id OR r.business_id IN (SELECT id FROM businesses)
), formations AS (
  SELECT f.id FROM public.representation_formation_sessions f CROSS JOIN target
  WHERE f.owner_id = target.owner_id OR f.business_id IN (SELECT id FROM businesses)
    OR f.business_representation_id IN (SELECT id FROM representations)
), proposals AS (
  SELECT p.id FROM public.representation_proposals p
  WHERE p.business_representation_id IN (SELECT id FROM representations)
     OR p.formation_session_id IN (SELECT id FROM formations)
), versions AS (
  SELECT v.id FROM public.representation_versions v
  WHERE v.business_representation_id IN (SELECT id FROM representations)
), direct_hire AS (
  SELECT d.id FROM public.direct_hire_onboarding_sessions d CROSS JOIN target
  WHERE d.owner_id = target.owner_id OR d.business_id IN (SELECT id FROM businesses)
     OR d.business_representation_id IN (SELECT id FROM representations)
), experiences AS (
  SELECT e.id, e.dispatch_id FROM public.public_experience_sessions e CROSS JOIN target
  WHERE e.tenant_user_id = target.owner_id OR e.business_id IN (SELECT id FROM businesses)
     OR e.business_representation_id IN (SELECT id FROM representations)
), voice_outputs AS (
  SELECT o.id, o.voice_context_id FROM public.voice_conversation_outputs o CROSS JOIN target
  WHERE o.tenant_user_id = target.owner_id OR o.business_id IN (SELECT id FROM businesses)
     OR o.business_representation_id IN (SELECT id FROM representations)
), voice_contexts AS (
  SELECT l.voice_context_id FROM public.voice_representation_lineage l CROSS JOIN target
  WHERE l.tenant_user_id = target.owner_id OR l.business_id IN (SELECT id FROM businesses)
     OR l.business_representation_id IN (SELECT id FROM representations)
), required_table_checks AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.'||table_name) IS NULL)::bigint
    AS missing_required_tables
  FROM (VALUES
    ('businesses'),('business_representations'),('representation_formation_sessions'),
    ('representation_proposals'),('proposal_elements'),('proposal_evidence'),
    ('proposal_observations'),('evidence'),('observations'),
    ('representation_versions'),('representation_domains'),('representation_elements'),
    ('approval_decisions'),('confidence_assessments'),('audit_events'),
    ('direct_hire_onboarding_sessions'),('public_experience_sessions'),
    ('public_experience_test_records'),('public_experience_representation_briefs'),
    ('public_experience_brief_responses'),('voice_provider_webhook_receipts'),
    ('voice_representation_lineage'),('voice_conversation_outputs'),
    ('voice_conversation_candidates'),('conversation_candidate_review_decisions'),
    ('conversation_candidate_promotions'),('conversation_candidate_canonicalizations'),
    ('dispatches'),('dispatch_events'),('call_outcomes'),
    ('memory_events'),('brief_conversation_mappings'),('worker_briefs'),
    ('mission_assignments'),('mission_leads'),('sales_agents')
  ) AS required(table_name)
), contract_checks AS (
  SELECT count(*) FILTER (WHERE NOT ok)::bigint AS missing_contracts
  FROM (VALUES
    (to_regclass('public.businesses') IS NOT NULL),
    (to_regclass('public.business_representations') IS NOT NULL),
    (to_regclass('public.representation_formation_sessions') IS NOT NULL),
    (to_regclass('public.representation_proposals') IS NOT NULL),
    (to_regclass('public.evidence') IS NOT NULL),
    (to_regclass('public.observations') IS NOT NULL),
    (to_regclass('public.direct_hire_onboarding_sessions') IS NOT NULL),
    (to_regclass('public.public_experience_sessions') IS NOT NULL),
    (to_regclass('public.voice_conversation_outputs') IS NOT NULL),
    (to_regclass('public.voice_representation_lineage') IS NOT NULL),
    (to_regclass('public.voice_conversation_candidates') IS NOT NULL),
    (to_regclass('public.conversation_candidate_review_decisions') IS NOT NULL),
    (to_regclass('public.conversation_candidate_promotions') IS NOT NULL),
    (to_regclass('public.conversation_candidate_canonicalizations') IS NOT NULL),
    (to_regclass('public.representation_versions') IS NOT NULL),
    (to_regclass('public.approval_decisions') IS NOT NULL),
    (to_regclass('public.confidence_assessments') IS NOT NULL),
    (to_regclass('public.audit_events') IS NOT NULL),
    (to_regclass('public.public_experience_test_records') IS NOT NULL),
    (to_regclass('public.public_experience_representation_briefs') IS NOT NULL),
    (to_regclass('public.public_experience_brief_responses') IS NOT NULL),
    (to_regclass('public.voice_provider_webhook_receipts') IS NOT NULL),
    (to_regclass('public.dispatches') IS NOT NULL),
    (to_regclass('public.dispatch_events') IS NOT NULL),
    (to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)') IS NOT NULL),
    (to_regprocedure('public.zeya_record_formation_owner_correction(uuid,uuid,uuid,uuid,text)') IS NOT NULL),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='source_formation_session_id')),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='source_formation_proposal_id')),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='source_correction_request_key')),
    (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='direct_hire_onboarding_session_id')),
    (EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='evidence_prevent_modification_trigger' AND NOT tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='audit_events_prevent_modification_trigger' AND NOT tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='confidence_assessments_prevent_modification_trigger' AND NOT tgisinternal)),
    ((SELECT count(DISTINCT p.proname)
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.prokind='f'
        AND p.proname IN (
          'evidence_prevent_modification',
          'audit_events_prevent_modification',
          'confidence_assessments_prevent_modification'
        )
        AND p.prosrc LIKE '%zeya.controlled_purge%')=3)
  ) AS checks(ok)
), conflicts AS (
  SELECT
    (SELECT count(*) FROM representations r JOIN public.businesses b ON b.id=r.business_id CROSS JOIN target WHERE b.user_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.representation_formation_sessions f CROSS JOIN target WHERE f.id IN (SELECT id FROM formations) AND f.owner_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.direct_hire_onboarding_sessions d CROSS JOIN target WHERE d.id IN (SELECT id FROM direct_hire) AND d.owner_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.voice_conversation_outputs o CROSS JOIN target WHERE o.id IN (SELECT id FROM voice_outputs) AND o.tenant_user_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.voice_representation_lineage l CROSS JOIN target WHERE l.voice_context_id IN (SELECT voice_context_id FROM voice_contexts) AND l.tenant_user_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.public_experience_sessions e CROSS JOIN target WHERE e.id IN (SELECT id FROM experiences) AND e.tenant_user_id IS DISTINCT FROM target.owner_id)::bigint
    + (SELECT count(*) FROM public.representation_proposals p WHERE p.id IN (SELECT id FROM proposals) AND p.business_representation_id NOT IN (SELECT id FROM representations))::bigint
    AS lineage_conflicts
), active AS (
  SELECT
    (SELECT count(*) FROM public.direct_hire_onboarding_sessions d WHERE d.id IN (SELECT id FROM direct_hire) AND (d.preparation_status='running' OR (d.preparation_lease_expires_at IS NOT NULL AND d.preparation_lease_expires_at > now())))::bigint
    + (SELECT count(*) FROM public.public_experience_sessions e WHERE e.id IN (SELECT id FROM experiences) AND e.state IN ('call_requested','call_correlation_pending','dispatch_resolution_pending','call_dispatched','call_active'))::bigint
    + (SELECT count(*) FROM public.voice_provider_webhook_receipts w WHERE w.public_experience_session_id IN (SELECT id FROM experiences) AND w.processing_state='processing')::bigint
    + (SELECT count(*) FROM public.dispatches d CROSS JOIN target WHERE d.user_id=target.owner_id AND d.status IN ('queued','calling'))::bigint
    AS active_work_conflicts
)
SELECT conflicts.lineage_conflicts, active.active_work_conflicts,
  required_table_checks.missing_required_tables,
  contract_checks.missing_contracts,
  (SELECT count(*) FROM businesses)::bigint AS target_business_count,
  (SELECT count(*) FROM representations)::bigint AS target_representation_count,
  (SELECT count(*) FROM formations)::bigint AS target_formation_count,
  (SELECT count(*) FROM versions)::bigint AS target_version_count,
  (SELECT count(*) FROM direct_hire)::bigint AS target_direct_hire_count,
  (SELECT count(*) FROM experiences)::bigint AS target_public_experience_count,
  (SELECT count(*) FROM public.evidence WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS target_evidence_count,
  (SELECT count(*) FROM public.observations WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS target_observation_count,
  (SELECT count(*) FROM proposals)::bigint AS target_proposal_count,
  (SELECT count(*) FROM public.audit_events WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS target_audit_count,
  (SELECT count(*) FROM auth_target)::bigint AS target_auth_user_count,
  0::bigint AS auth_user_would_be_deleted_count,
  conflicts.lineage_conflicts=0 AND active.active_work_conflicts=0
    AND required_table_checks.missing_required_tables=0
    AND contract_checks.missing_contracts=0 AND (SELECT count(*) FROM auth_target)=1 AS reset_ready
FROM conflicts CROSS JOIN active CROSS JOIN required_table_checks CROSS JOIN contract_checks;

-- Safe identifier inventory. Expected: every row resolves to the exact target lineage.
WITH target AS (SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id),
businesses AS (SELECT id FROM public.businesses CROSS JOIN target WHERE user_id=owner_id),
representations AS (SELECT id,business_id,current_version_id FROM public.business_representations CROSS JOIN target WHERE user_id=owner_id)
SELECT 'business' AS object_type, id AS object_id, NULL::uuid AS parent_id FROM businesses
UNION ALL SELECT 'representation', id, business_id FROM representations
UNION ALL SELECT 'formation', f.id, f.business_representation_id FROM public.representation_formation_sessions f CROSS JOIN target WHERE f.owner_id=target.owner_id
UNION ALL SELECT 'proposal', p.id, p.business_representation_id FROM public.representation_proposals p WHERE p.business_representation_id IN (SELECT id FROM representations)
UNION ALL SELECT 'version', v.id, v.business_representation_id FROM public.representation_versions v WHERE v.business_representation_id IN (SELECT id FROM representations)
UNION ALL SELECT 'direct_hire', d.id, d.business_representation_id FROM public.direct_hire_onboarding_sessions d CROSS JOIN target WHERE d.owner_id=target.owner_id
UNION ALL SELECT 'public_experience', e.id, e.business_representation_id FROM public.public_experience_sessions e CROSS JOIN target WHERE e.tenant_user_id=target.owner_id
UNION ALL SELECT 'voice_output', o.id, o.business_representation_id FROM public.voice_conversation_outputs o CROSS JOIN target WHERE o.tenant_user_id=target.owner_id
UNION ALL SELECT 'voice_context', l.voice_context_id, l.business_representation_id FROM public.voice_representation_lineage l CROSS JOIN target WHERE l.tenant_user_id=target.owner_id
UNION ALL SELECT 'dispatch', d.id, NULL::uuid FROM public.dispatches d CROSS JOIN target WHERE d.user_id=target.owner_id
ORDER BY object_type, object_id;

-- Detailed descendant counts. Expected: informational only; reset_ready above is the gate.
WITH target AS (SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id),
businesses AS (SELECT id FROM public.businesses CROSS JOIN target WHERE user_id=owner_id),
representations AS (SELECT id FROM public.business_representations CROSS JOIN target WHERE user_id=owner_id),
experiences AS (SELECT id FROM public.public_experience_sessions CROSS JOIN target WHERE tenant_user_id=owner_id)
SELECT
  (SELECT count(*) FROM public.representation_domains WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS domain_count,
  (SELECT count(*) FROM public.representation_elements WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS element_count,
  (SELECT count(*) FROM public.approval_decisions WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS approval_count,
  (SELECT count(*) FROM public.confidence_assessments WHERE business_representation_id IN (SELECT id FROM representations))::bigint AS confidence_count,
  (SELECT count(*) FROM public.voice_representation_lineage CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS voice_context_count,
  (SELECT count(*) FROM public.voice_conversation_outputs CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS voice_output_count,
  (SELECT count(*) FROM public.voice_conversation_candidates CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS voice_candidate_count,
  (SELECT count(*) FROM public.conversation_candidate_review_decisions CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS review_count,
  (SELECT count(*) FROM public.conversation_candidate_promotions CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS promotion_count,
  (SELECT count(*) FROM public.conversation_candidate_canonicalizations CROSS JOIN target WHERE tenant_user_id=owner_id)::bigint AS canonicalization_count,
  (SELECT count(*) FROM public.public_experience_test_records WHERE public_experience_session_id IN (SELECT id FROM experiences))::bigint AS experience_test_record_count,
  (SELECT count(*) FROM public.public_experience_representation_briefs WHERE public_experience_session_id IN (SELECT id FROM experiences))::bigint AS brief_count,
  (SELECT count(*) FROM public.public_experience_brief_responses WHERE public_experience_session_id IN (SELECT id FROM experiences))::bigint AS brief_response_count,
  (SELECT count(*) FROM public.voice_provider_webhook_receipts WHERE public_experience_session_id IN (SELECT id FROM experiences))::bigint AS webhook_count,
  (SELECT count(*) FROM public.memory_events WHERE business_id IN (SELECT id FROM businesses))::bigint AS memory_event_count,
  (SELECT count(*) FROM public.call_outcomes WHERE business_id IN (SELECT id FROM businesses))::bigint AS call_outcome_count,
  (SELECT count(*) FROM public.worker_briefs WHERE business_id IN (SELECT id FROM businesses))::bigint AS worker_brief_count,
  (SELECT count(*) FROM public.brief_conversation_mappings WHERE business_id IN (SELECT id FROM businesses))::bigint AS brief_mapping_count,
  (SELECT count(*) FROM public.dispatches CROSS JOIN target WHERE user_id=owner_id)::bigint AS dispatch_count,
  (SELECT count(*) FROM public.dispatch_events CROSS JOIN target WHERE user_id=owner_id)::bigint AS dispatch_event_count,
  (SELECT count(*) FROM public.mission_assignments WHERE business_id IN (SELECT id FROM businesses))::bigint AS mission_assignment_count,
  (SELECT count(*) FROM public.mission_leads WHERE business_id IN (SELECT id FROM businesses))::bigint AS mission_lead_count,
  (SELECT count(*) FROM public.sales_agents WHERE business_id IN (SELECT id FROM businesses))::bigint AS sales_agent_count;

-- Optional legacy inventory. These relations are not guaranteed by repository migrations.
SELECT optional.table_name,
  to_regclass('public.'||optional.table_name) IS NOT NULL AS relation_present,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=optional.table_name
      AND column_name=optional.lineage_column
  ) AS expected_lineage_column_present
FROM (VALUES
  ('sessions','business_id'),
  ('messages','session_id'),
  ('knowledge_assets','business_id')
) AS optional(table_name,lineage_column)
ORDER BY optional.table_name;

-- Dispatch identifier inventory; no phone, payload, content, or provider data is exposed.
SELECT id AS dispatch_row_id, dispatch_id, status, created_at
FROM public.dispatches
WHERE user_id='da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid
ORDER BY created_at, id;
