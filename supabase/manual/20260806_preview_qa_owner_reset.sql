-- Zeya Preview-only controlled QA-owner reset.
-- Confirm the SQL Editor project is hdjojgvvlojbhgidirht before use.
-- This transaction preserves auth.users and deletes only the exact UUID/email-bound owner's application data.

BEGIN;

DO $reset$
DECLARE
  v_owner_id constant uuid := 'da53cf7f-beb1-4168-a0cb-015610f092fc';
  v_owner_email constant text := 'mdubreu@gmail.com';
  v_business_ids uuid[];
  v_representation_ids uuid[];
  v_formation_ids uuid[];
  v_proposal_ids uuid[];
  v_version_ids uuid[];
  v_direct_hire_ids uuid[];
  v_experience_ids uuid[];
  v_dispatch_ids text[];
  v_legacy_session_ids text[] := ARRAY[]::text[];
  v_remaining bigint;
  v_missing_required bigint;
BEGIN
  IF current_user NOT IN ('postgres','service_role')
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Preview QA reset not authorized';
  END IF;

  PERFORM 1 FROM auth.users WHERE id=v_owner_id AND email=v_owner_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='exact Preview QA Auth identity not found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner_id::text,0));

  SELECT count(*) FILTER (WHERE to_regclass('public.'||required.table_name) IS NULL)
  INTO v_missing_required
  FROM (VALUES
    ('businesses'),('business_representations'),('representation_formation_sessions'),
    ('representation_proposals'),('proposal_elements'),('proposal_evidence'),
    ('proposal_observations'),('evidence'),('observations'),('representation_versions'),
    ('representation_domains'),('representation_elements'),('approval_decisions'),
    ('confidence_assessments'),('audit_events'),('direct_hire_onboarding_sessions'),
    ('public_experience_sessions'),('public_experience_test_records'),
    ('public_experience_representation_briefs'),('public_experience_brief_responses'),
    ('voice_provider_webhook_receipts'),('voice_representation_lineage'),
    ('voice_conversation_outputs'),('voice_conversation_candidates'),
    ('conversation_candidate_review_decisions'),('conversation_candidate_promotions'),
    ('conversation_candidate_canonicalizations'),('dispatches'),('dispatch_events'),
    ('call_outcomes'),('memory_events'),('brief_conversation_mappings'),('worker_briefs'),
    ('mission_assignments'),('mission_leads'),('sales_agents')
  ) AS required(table_name);
  IF v_missing_required<>0 THEN
    RAISE EXCEPTION USING ERRCODE='42P01', MESSAGE='Preview QA reset required table missing';
  END IF;

  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_business_ids FROM public.businesses WHERE user_id=v_owner_id;
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_representation_ids FROM public.business_representations WHERE user_id=v_owner_id AND business_id=ANY(v_business_ids);
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_formation_ids FROM public.representation_formation_sessions WHERE owner_id=v_owner_id AND business_id=ANY(v_business_ids) AND business_representation_id=ANY(v_representation_ids);
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_proposal_ids FROM public.representation_proposals WHERE business_representation_id=ANY(v_representation_ids);
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_version_ids FROM public.representation_versions WHERE business_representation_id=ANY(v_representation_ids);
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_direct_hire_ids FROM public.direct_hire_onboarding_sessions WHERE owner_id=v_owner_id AND business_id=ANY(v_business_ids) AND business_representation_id=ANY(v_representation_ids);
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO v_experience_ids FROM public.public_experience_sessions WHERE tenant_user_id=v_owner_id AND business_id=ANY(v_business_ids) AND business_representation_id=ANY(v_representation_ids);
  SELECT coalesce(array_agg(dispatch_id ORDER BY dispatch_id),ARRAY[]::text[]) INTO v_dispatch_ids FROM public.dispatches WHERE user_id=v_owner_id;

  IF EXISTS (SELECT 1 FROM public.business_representations WHERE business_id=ANY(v_business_ids) AND user_id IS DISTINCT FROM v_owner_id)
    OR EXISTS (SELECT 1 FROM public.representation_formation_sessions WHERE (business_id=ANY(v_business_ids) OR business_representation_id=ANY(v_representation_ids)) AND owner_id IS DISTINCT FROM v_owner_id)
    OR EXISTS (SELECT 1 FROM public.direct_hire_onboarding_sessions WHERE (business_id=ANY(v_business_ids) OR business_representation_id=ANY(v_representation_ids)) AND owner_id IS DISTINCT FROM v_owner_id)
    OR EXISTS (SELECT 1 FROM public.voice_conversation_outputs WHERE (business_id=ANY(v_business_ids) OR business_representation_id=ANY(v_representation_ids)) AND tenant_user_id IS DISTINCT FROM v_owner_id)
    OR EXISTS (SELECT 1 FROM public.voice_representation_lineage WHERE (business_id=ANY(v_business_ids) OR business_representation_id=ANY(v_representation_ids)) AND tenant_user_id IS DISTINCT FROM v_owner_id)
    OR EXISTS (SELECT 1 FROM public.public_experience_sessions WHERE (business_id=ANY(v_business_ids) OR business_representation_id=ANY(v_representation_ids)) AND tenant_user_id IS DISTINCT FROM v_owner_id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='Preview QA reset cross-owner lineage conflict';
  END IF;

  IF EXISTS (SELECT 1 FROM public.direct_hire_onboarding_sessions WHERE id=ANY(v_direct_hire_ids) AND (preparation_status='running' OR (preparation_lease_expires_at IS NOT NULL AND preparation_lease_expires_at>now())))
    OR EXISTS (SELECT 1 FROM public.public_experience_sessions WHERE id=ANY(v_experience_ids) AND state IN ('call_requested','call_correlation_pending','dispatch_resolution_pending','call_dispatched','call_active'))
    OR EXISTS (SELECT 1 FROM public.voice_provider_webhook_receipts WHERE public_experience_session_id=ANY(v_experience_ids) AND processing_state='processing')
    OR EXISTS (SELECT 1 FROM public.dispatches WHERE user_id=v_owner_id AND status IN ('queued','calling')) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='Preview QA reset blocked by active asynchronous work';
  END IF;

  PERFORM pg_catalog.set_config('zeya.controlled_purge','on',true);

  DELETE FROM public.conversation_candidate_canonicalizations WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.conversation_candidate_promotions WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.conversation_candidate_review_decisions WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.voice_conversation_candidates WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.public_experience_test_records WHERE tenant_user_id=v_owner_id OR public_experience_session_id=ANY(v_experience_ids);
  DELETE FROM public.public_experience_brief_responses WHERE public_experience_session_id=ANY(v_experience_ids);
  DELETE FROM public.public_experience_representation_briefs WHERE public_experience_session_id=ANY(v_experience_ids);
  DELETE FROM public.voice_provider_webhook_receipts WHERE public_experience_session_id=ANY(v_experience_ids);
  DELETE FROM public.dispatch_events WHERE dispatch_id=ANY(v_dispatch_ids);

  DELETE FROM public.proposal_elements WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.proposal_evidence WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.proposal_observations WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.approval_decisions WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.audit_events WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.confidence_assessments WHERE business_representation_id=ANY(v_representation_ids);

  -- Hypothesis governance descendants must be removed before correction Evidence.
  DELETE FROM public.hypothesis_owner_operations
  WHERE owner_id=v_owner_id
     OR business_representation_id=ANY(v_representation_ids)
     OR direct_hire_onboarding_session_id=ANY(v_direct_hire_ids);

  DELETE FROM public.hypothesis_verifications
  WHERE hypothesis_id IN (
    SELECT h.id
    FROM public.hypotheses h
    WHERE h.owner_id=v_owner_id
       OR h.business_representation_id=ANY(v_representation_ids)
       OR h.direct_hire_onboarding_session_id=ANY(v_direct_hire_ids)
  );

  DELETE FROM public.hypotheses
  WHERE owner_id=v_owner_id
     OR business_representation_id=ANY(v_representation_ids)
     OR direct_hire_onboarding_session_id=ANY(v_direct_hire_ids);

  DELETE FROM public.evidence WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.observations WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.public_experience_sessions WHERE id=ANY(v_experience_ids);
  DELETE FROM public.voice_conversation_outputs WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.voice_representation_lineage WHERE tenant_user_id=v_owner_id AND business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.direct_hire_onboarding_sessions WHERE id=ANY(v_direct_hire_ids);

  UPDATE public.business_representations SET current_version_id=NULL WHERE id=ANY(v_representation_ids) AND user_id=v_owner_id;
  UPDATE public.representation_elements SET current_value_version_id=NULL WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.representation_versions WHERE id=ANY(v_version_ids);
  DELETE FROM public.representation_proposals WHERE id=ANY(v_proposal_ids);
  DELETE FROM public.representation_formation_sessions WHERE id=ANY(v_formation_ids);
  DELETE FROM public.representation_elements WHERE business_representation_id=ANY(v_representation_ids);
  DELETE FROM public.representation_domains WHERE business_representation_id=ANY(v_representation_ids);

  DELETE FROM public.call_outcomes WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.memory_events WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.brief_conversation_mappings WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.worker_briefs WHERE business_id=ANY(v_business_ids);
  IF to_regclass('public.messages') IS NOT NULL AND to_regclass('public.sessions') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='optional messages table cannot be owner-scoped without sessions';
  END IF;
  IF to_regclass('public.sessions') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name='business_id') THEN
      RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='optional sessions table has unknown lineage contract';
    END IF;
    EXECUTE 'SELECT coalesce(array_agg(id::text ORDER BY id::text),ARRAY[]::text[]) FROM public.sessions WHERE business_id=ANY($1)'
      INTO v_legacy_session_ids USING v_business_ids;
    IF to_regclass('public.messages') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='session_id') THEN
        RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='optional messages table has unknown lineage contract';
      END IF;
      EXECUTE 'DELETE FROM public.messages WHERE session_id::text=ANY($1)' USING v_legacy_session_ids;
    END IF;
    EXECUTE 'DELETE FROM public.sessions WHERE business_id=ANY($1)' USING v_business_ids;
  END IF;
  DELETE FROM public.mission_assignments WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.mission_leads WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.sales_agents WHERE business_id=ANY(v_business_ids);
  DELETE FROM public.dispatches WHERE user_id=v_owner_id AND dispatch_id=ANY(v_dispatch_ids);
  IF to_regclass('public.knowledge_assets') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='knowledge_assets' AND column_name='business_id') THEN
      RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='optional knowledge_assets table has unknown lineage contract';
    END IF;
    EXECUTE 'DELETE FROM public.knowledge_assets WHERE business_id=ANY($1)' USING v_business_ids;
  END IF;
  DELETE FROM public.business_representations WHERE id=ANY(v_representation_ids) AND user_id=v_owner_id AND business_id=ANY(v_business_ids);
  DELETE FROM public.businesses WHERE id=ANY(v_business_ids) AND user_id=v_owner_id;

  SELECT
    (SELECT count(*) FROM public.businesses WHERE user_id=v_owner_id)
    +(SELECT count(*) FROM public.business_representations WHERE user_id=v_owner_id)
    +(SELECT count(*) FROM public.representation_formation_sessions WHERE owner_id=v_owner_id)
    +(SELECT count(*) FROM public.direct_hire_onboarding_sessions WHERE owner_id=v_owner_id)
    +(SELECT count(*) FROM public.public_experience_sessions WHERE tenant_user_id=v_owner_id)
    +(SELECT count(*) FROM public.voice_conversation_outputs WHERE tenant_user_id=v_owner_id)
    +(SELECT count(*) FROM public.voice_representation_lineage WHERE tenant_user_id=v_owner_id)
    +(SELECT count(*) FROM public.representation_versions WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.representation_proposals WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.evidence WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.observations WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.approval_decisions WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.confidence_assessments WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.audit_events WHERE business_representation_id=ANY(v_representation_ids))
    +(SELECT count(*) FROM public.public_experience_test_records WHERE public_experience_session_id=ANY(v_experience_ids) OR tenant_user_id=v_owner_id)
    +(SELECT count(*) FROM public.voice_provider_webhook_receipts WHERE public_experience_session_id=ANY(v_experience_ids))
    +(SELECT count(*) FROM public.dispatches WHERE user_id=v_owner_id)
    +(SELECT count(*) FROM public.dispatch_events WHERE dispatch_id=ANY(v_dispatch_ids))
    +(SELECT count(*) FROM public.memory_events WHERE business_id=ANY(v_business_ids))
    +(SELECT count(*) FROM public.worker_briefs WHERE business_id=ANY(v_business_ids))
  INTO v_remaining;
  IF to_regclass('public.sessions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.sessions WHERE business_id=ANY($1)' INTO v_missing_required USING v_business_ids;
    v_remaining:=v_remaining+v_missing_required;
  END IF;
  IF to_regclass('public.messages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.messages WHERE session_id::text=ANY($1)' INTO v_missing_required USING v_legacy_session_ids;
    v_remaining:=v_remaining+v_missing_required;
  END IF;
  IF to_regclass('public.knowledge_assets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.knowledge_assets WHERE business_id=ANY($1)' INTO v_missing_required USING v_business_ids;
    v_remaining:=v_remaining+v_missing_required;
  END IF;
  IF v_remaining<>0 THEN RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='Preview QA reset incomplete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner_id AND email=v_owner_email) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='Preview QA Auth identity was not preserved';
  END IF;
  PERFORM pg_catalog.set_config('zeya.controlled_purge','off',true);
END;
$reset$;

SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id,
  true AS application_data_removed,
  true AS auth_user_preserved,
  0::bigint AS remaining_business_count,
  0::bigint AS remaining_representation_count,
  true AS reset_complete;

COMMIT;
