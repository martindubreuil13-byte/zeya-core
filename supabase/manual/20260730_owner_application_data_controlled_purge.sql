BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_purge_owner_application_data(
  p_owner_id uuid,
  p_owner_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email text;
  v_business_ids uuid[] := ARRAY[]::uuid[];
  v_representation_ids uuid[] := ARRAY[]::uuid[];
  v_experience_session_ids uuid[] := ARRAY[]::uuid[];
  v_dispatch_ids uuid[] := ARRAY[]::uuid[];
  v_businesses_deleted integer := 0;
  v_representations_deleted integer := 0;
  v_versions_deleted integer := 0;
  v_experience_sessions_deleted integer := 0;
  v_evidence_deleted integer := 0;
  v_observations_deleted integer := 0;
  v_proposals_deleted integer := 0;
  v_confidence_assessments_deleted integer := 0;
  v_audit_events_deleted integer := 0;
  v_domains_deleted integer := 0;
  v_elements_deleted integer := 0;
  v_memory_events_deleted integer := 0;
  v_call_outcomes_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_voice_records_deleted integer := 0;
  v_worker_briefs_deleted integer := 0;
  v_mission_leads_deleted integer := 0;
  v_sales_agents_deleted integer := 0;
  v_remaining integer;
  v_representation record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'owner application-data purge not authorized';
  END IF;

  IF p_owner_id IS NULL OR p_owner_email IS NULL OR pg_catalog.btrim(p_owner_email) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'owner purge identity is incomplete';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 0)
  );

  SELECT users.email
  INTO v_auth_email
  FROM auth.users AS users
  WHERE users.id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND OR v_auth_email IS DISTINCT FROM p_owner_email THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ404',
      MESSAGE = 'owner identity not found';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(business.id ORDER BY business.id), ARRAY[]::uuid[])
  INTO v_business_ids
  FROM public.businesses AS business
  WHERE business.user_id = p_owner_id;

  SELECT COALESCE(pg_catalog.array_agg(representation.id ORDER BY representation.id), ARRAY[]::uuid[])
  INTO v_representation_ids
  FROM public.business_representations AS representation
  WHERE representation.business_id = ANY(v_business_ids)
    AND representation.user_id = p_owner_id;

  IF EXISTS (
    SELECT 1
    FROM public.business_representations AS representation
    WHERE representation.business_id = ANY(v_business_ids)
      AND representation.user_id IS DISTINCT FROM p_owner_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'owner purge lineage conflict';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(experience.id ORDER BY experience.id), ARRAY[]::uuid[])
  INTO v_experience_session_ids
  FROM public.public_experience_sessions AS experience
  WHERE experience.tenant_user_id = p_owner_id
    AND experience.business_id = ANY(v_business_ids)
    AND experience.business_representation_id = ANY(v_representation_ids);

  SELECT COALESCE(pg_catalog.array_agg(dispatch.id ORDER BY dispatch.id), ARRAY[]::uuid[])
  INTO v_dispatch_ids
  FROM public.dispatches AS dispatch
  WHERE dispatch.business_id = ANY(v_business_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_businesses_deleted
  FROM public.businesses AS business
  WHERE business.id = ANY(v_business_ids)
    AND business.user_id = p_owner_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_representations_deleted
  FROM public.business_representations AS representation
  WHERE representation.id = ANY(v_representation_ids)
    AND representation.business_id = ANY(v_business_ids)
    AND representation.user_id = p_owner_id;

  SELECT pg_catalog.count(*)::integer
  INTO v_versions_deleted
  FROM public.representation_versions AS version
  WHERE version.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_experience_sessions_deleted
  FROM public.public_experience_sessions AS experience
  WHERE experience.tenant_user_id = p_owner_id
    AND experience.business_id = ANY(v_business_ids)
    AND experience.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_evidence_deleted
  FROM public.evidence AS evidence
  WHERE evidence.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_observations_deleted
  FROM public.observations AS observation
  WHERE observation.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_proposals_deleted
  FROM public.representation_proposals AS proposal
  WHERE proposal.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_confidence_assessments_deleted
  FROM public.confidence_assessments AS assessment
  WHERE assessment.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_audit_events_deleted
  FROM public.audit_events AS event
  WHERE event.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_domains_deleted
  FROM public.representation_domains AS domain
  WHERE domain.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_elements_deleted
  FROM public.representation_elements AS element
  WHERE element.business_representation_id = ANY(v_representation_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_memory_events_deleted
  FROM public.memory_events AS event
  WHERE event.business_id = ANY(v_business_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_call_outcomes_deleted
  FROM public.call_outcomes AS outcome
  WHERE outcome.business_id = ANY(v_business_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_sessions_deleted
  FROM public.sessions AS session
  WHERE session.business_id = ANY(v_business_ids);

  SELECT (
    (SELECT pg_catalog.count(*) FROM public.voice_representation_lineage AS lineage
      WHERE lineage.tenant_user_id = p_owner_id
        AND lineage.business_id = ANY(v_business_ids)
        AND lineage.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_conversation_outputs AS output
      WHERE output.tenant_user_id = p_owner_id
        AND output.business_id = ANY(v_business_ids)
        AND output.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_conversation_candidates AS candidate
      WHERE candidate.tenant_user_id = p_owner_id
        AND candidate.business_id = ANY(v_business_ids)
        AND candidate.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_review_decisions AS decision
      WHERE decision.tenant_user_id = p_owner_id
        AND decision.business_id = ANY(v_business_ids)
        AND decision.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_promotions AS promotion
      WHERE promotion.tenant_user_id = p_owner_id
        AND promotion.business_id = ANY(v_business_ids)
        AND promotion.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_canonicalizations AS canonicalization
      WHERE canonicalization.tenant_user_id = p_owner_id
        AND canonicalization.business_id = ANY(v_business_ids)
        AND canonicalization.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_provider_webhook_receipts AS receipt
      WHERE receipt.public_experience_session_id IN (
        SELECT pg_catalog.unnest(v_experience_session_ids)
      ))
  )::integer
  INTO v_voice_records_deleted;

  SELECT pg_catalog.count(*)::integer
  INTO v_worker_briefs_deleted
  FROM public.worker_briefs AS brief
  WHERE brief.business_id = ANY(v_business_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_mission_leads_deleted
  FROM public.mission_leads AS lead
  WHERE lead.business_id = ANY(v_business_ids);

  SELECT pg_catalog.count(*)::integer
  INTO v_sales_agents_deleted
  FROM public.sales_agents AS agent
  WHERE agent.business_id = ANY(v_business_ids);

  FOR v_representation IN
    SELECT representation.id, representation.business_id
    FROM public.business_representations AS representation
    WHERE representation.id = ANY(v_representation_ids)
      AND representation.business_id = ANY(v_business_ids)
      AND representation.user_id = p_owner_id
    ORDER BY representation.id
  LOOP
    PERFORM public.zeya_purge_business_representation(
      v_representation.id,
      v_representation.business_id
    );
  END LOOP;

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'on', true);

  DELETE FROM public.public_experience_sessions AS experience
  WHERE experience.tenant_user_id = p_owner_id
    AND experience.business_id = ANY(v_business_ids)
    AND experience.business_representation_id = ANY(v_representation_ids);

  DELETE FROM public.call_outcomes AS outcome
  WHERE outcome.business_id = ANY(v_business_ids);

  DELETE FROM public.memory_events AS event
  WHERE event.business_id = ANY(v_business_ids);

  DELETE FROM public.brief_conversation_mappings AS mapping
  WHERE mapping.business_id = ANY(v_business_ids);

  DELETE FROM public.worker_briefs AS brief
  WHERE brief.business_id = ANY(v_business_ids);

  DELETE FROM public.sessions AS session
  WHERE session.business_id = ANY(v_business_ids);

  DELETE FROM public.mission_assignments AS assignment
  WHERE assignment.business_id = ANY(v_business_ids);

  DELETE FROM public.mission_leads AS lead
  WHERE lead.business_id = ANY(v_business_ids);

  DELETE FROM public.sales_agents AS agent
  WHERE agent.business_id = ANY(v_business_ids);

  DELETE FROM public.dispatches AS dispatch
  WHERE dispatch.business_id = ANY(v_business_ids);

  DELETE FROM public.knowledge_assets AS asset
  WHERE asset.business_id = ANY(v_business_ids);

  DELETE FROM public.business_representations AS representation
  WHERE representation.id = ANY(v_representation_ids)
    AND representation.business_id = ANY(v_business_ids)
    AND representation.user_id = p_owner_id;

  DELETE FROM public.businesses AS business
  WHERE business.id = ANY(v_business_ids)
    AND business.user_id = p_owner_id;

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);

  SELECT (
    (SELECT pg_catalog.count(*) FROM public.businesses AS business
      WHERE business.user_id = p_owner_id)
    + (SELECT pg_catalog.count(*) FROM public.business_representations AS representation
      WHERE representation.id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.representation_versions AS version
      WHERE version.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.representation_formation_sessions AS formation
      WHERE formation.owner_id = p_owner_id
         OR formation.business_id = ANY(v_business_ids)
         OR formation.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.public_experience_sessions AS experience
      WHERE experience.tenant_user_id = p_owner_id
         OR experience.business_id = ANY(v_business_ids)
         OR experience.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.public_experience_test_records AS test_record
      WHERE test_record.tenant_user_id = p_owner_id
         OR test_record.public_experience_session_id = ANY(v_experience_session_ids))
    + (SELECT pg_catalog.count(*) FROM public.public_experience_representation_briefs AS brief
      WHERE brief.public_experience_session_id = ANY(v_experience_session_ids))
    + (SELECT pg_catalog.count(*) FROM public.public_experience_brief_responses AS response
      WHERE response.public_experience_session_id = ANY(v_experience_session_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_provider_webhook_receipts AS receipt
      WHERE receipt.public_experience_session_id = ANY(v_experience_session_ids))
    + (SELECT pg_catalog.count(*) FROM public.evidence AS evidence
      WHERE evidence.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.observations AS observation
      WHERE observation.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.representation_proposals AS proposal
      WHERE proposal.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.proposal_elements AS proposal_element
      WHERE proposal_element.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.proposal_evidence AS proposal_evidence
      WHERE proposal_evidence.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.proposal_observations AS proposal_observation
      WHERE proposal_observation.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.approval_decisions AS decision
      WHERE decision.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.confidence_assessments AS assessment
      WHERE assessment.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.audit_events AS event
      WHERE event.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.representation_domains AS domain
      WHERE domain.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.representation_elements AS element
      WHERE element.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.memory_events AS event
      WHERE event.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.call_outcomes AS outcome
      WHERE outcome.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.sessions AS session
      WHERE session.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.worker_briefs AS brief
      WHERE brief.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.brief_conversation_mappings AS mapping
      WHERE mapping.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.mission_assignments AS assignment
      WHERE assignment.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.mission_leads AS lead
      WHERE lead.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.sales_agents AS agent
      WHERE agent.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.dispatches AS dispatch
      WHERE dispatch.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.dispatch_events AS event
      WHERE event.dispatch_id = ANY(v_dispatch_ids))
    + (SELECT pg_catalog.count(*) FROM public.knowledge_assets AS asset
      WHERE asset.business_id = ANY(v_business_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_representation_lineage AS lineage
      WHERE lineage.tenant_user_id = p_owner_id
         OR lineage.business_id = ANY(v_business_ids)
         OR lineage.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_conversation_outputs AS output
      WHERE output.tenant_user_id = p_owner_id
         OR output.business_id = ANY(v_business_ids)
         OR output.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.voice_conversation_candidates AS candidate
      WHERE candidate.tenant_user_id = p_owner_id
         OR candidate.business_id = ANY(v_business_ids)
         OR candidate.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_review_decisions AS decision
      WHERE decision.tenant_user_id = p_owner_id
         OR decision.business_id = ANY(v_business_ids)
         OR decision.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_promotions AS promotion
      WHERE promotion.tenant_user_id = p_owner_id
         OR promotion.business_id = ANY(v_business_ids)
         OR promotion.business_representation_id = ANY(v_representation_ids))
    + (SELECT pg_catalog.count(*) FROM public.conversation_candidate_canonicalizations AS canonicalization
      WHERE canonicalization.tenant_user_id = p_owner_id
         OR canonicalization.business_id = ANY(v_business_ids)
         OR canonicalization.business_representation_id = ANY(v_representation_ids))
  )::integer
  INTO v_remaining;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'owner application-data purge incomplete',
      DETAIL = pg_catalog.jsonb_build_object('remaining_records', v_remaining)::text;
  END IF;

  SELECT users.email
  INTO v_auth_email
  FROM auth.users AS users
  WHERE users.id = p_owner_id;

  IF NOT FOUND OR v_auth_email IS DISTINCT FROM p_owner_email THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PZ409',
      MESSAGE = 'owner authentication identity was not preserved';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'owner_id', p_owner_id,
    'email', p_owner_email,
    'businesses_deleted', v_businesses_deleted,
    'representations_deleted', v_representations_deleted,
    'versions_deleted', v_versions_deleted,
    'experience_sessions_deleted', v_experience_sessions_deleted,
    'evidence_deleted', v_evidence_deleted,
    'observations_deleted', v_observations_deleted,
    'proposals_deleted', v_proposals_deleted,
    'confidence_assessments_deleted', v_confidence_assessments_deleted,
    'audit_events_deleted', v_audit_events_deleted,
    'domains_deleted', v_domains_deleted,
    'elements_deleted', v_elements_deleted,
    'memory_events_deleted', v_memory_events_deleted,
    'call_outcomes_deleted', v_call_outcomes_deleted,
    'sessions_deleted', v_sessions_deleted,
    'voice_records_deleted', v_voice_records_deleted,
    'worker_briefs_deleted', v_worker_briefs_deleted,
    'mission_leads_deleted', v_mission_leads_deleted,
    'sales_agents_deleted', v_sales_agents_deleted,
    'auth_user_preserved', true,
    'post_purge_business_count', 0,
    'post_purge_representation_count', 0
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);
    RAISE;
END;
$$;

ALTER FUNCTION public.zeya_purge_owner_application_data(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_purge_owner_application_data(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_owner_application_data(uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
