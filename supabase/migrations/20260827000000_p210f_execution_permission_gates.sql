BEGIN;

/**
 * P2.10F EXECUTION PERMISSION GATES REPAIR
 *
 * Issue: P2.6 zeya_p26_dispatch_is_current() rejects executable dispatches
 * Root Cause: Validation hardcoded to require execution_allowed=false
 * Impact: P2.9D executable dispatch path (doNotExecute=false) cannot be authorized
 *
 * Correct Semantics:
 *   execution_allowed = false → mission/dispatch prohibits execution
 *     → Authorization must NOT succeed
 *     → Authorization rejected during creation
 *
 *   execution_allowed = true → mission/dispatch permits execution
 *     → Authorization CAN succeed
 *     → Execution requires BOTH execution_allowed=true AND valid authorization
 *     → Authorization does NOT change execution_allowed
 *
 * Two-Gate Model:
 *   GATE 1 (Mission/Dispatch): execution_allowed boolean
 *   GATE 2 (Owner): authorization status
 *   EXECUTION: Requires BOTH gates open
 */

-- Fix 1: Update zeya_p26_dispatch_is_current() to accept both true and false
-- But reject blocked dispatches at authorization time

DROP FUNCTION IF EXISTS public.zeya_p26_dispatch_is_current(uuid, text);

CREATE FUNCTION public.zeya_p26_dispatch_is_current(p_owner_id uuid, p_dispatch_id text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  d public.dispatches%ROWTYPE;
  b public.worker_briefs%ROWTYPE;
  m public.operating_missions%ROWTYPE;
  c public.mission_execution_contexts%ROWTYPE;
  r public.business_representations%ROWTYPE;
  l public.mission_leads%ROWTYPE;
  o public.direct_hire_formation_outcome_packages%ROWTYPE;
BEGIN
  SELECT x.* INTO d FROM public.dispatches x
  WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id;

  -- Basic dispatch validity
  IF d.id IS NULL OR d.execution_context_id IS NULL OR d.status<>'draft'
    OR d.execution_allowed IS NULL -- Accept both true and false
    OR d.worker_role<>'outbound_business_development_voice_worker'
    OR d.channel<>'phone'
  THEN RETURN false; END IF;

  -- Get related artifacts
  SELECT x.* INTO b FROM public.worker_briefs x
  WHERE x.id=d.worker_brief_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO m FROM public.operating_missions x
  WHERE x.id=d.mission_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO c FROM public.mission_execution_contexts x
  WHERE x.id=d.execution_context_id AND x.owner_id=p_owner_id;
  SELECT x.* INTO r FROM public.business_representations x
  WHERE x.id=d.business_representation_id AND x.user_id=p_owner_id;
  SELECT x.* INTO l FROM public.mission_leads x
  WHERE x.id=d.lead_id AND x.business_representation_id=d.business_representation_id;
  SELECT x.* INTO o FROM public.direct_hire_formation_outcome_packages x
  WHERE x.id=d.mandate_outcome_package_id AND x.owner_id=p_owner_id;

  -- Full lineage validation
  RETURN b.id IS NOT NULL
    AND b.execution_allowed IS NOT DISTINCT FROM d.execution_allowed  -- Match dispatch permission
    AND b.source_fingerprint=d.source_fingerprint
    AND b.operating_mission_id=d.mission_id
    AND b.execution_context_id=d.execution_context_id
    AND b.representation_version_id=d.representation_version_id
    AND b.mandate_outcome_package_id=d.mandate_outcome_package_id
    AND b.lead_id=d.lead_id
    AND m.id IS NOT NULL
    AND m.status='ready'
    AND m.representation_version_id=d.representation_version_id
    AND m.mandate_outcome_package_id=d.mandate_outcome_package_id
    AND m.lead_id=d.lead_id
    AND c.id IS NOT NULL
    AND c.context_contract_version IN ('operating-execution-context-v1', 'operating-execution-context-v2')
    AND c.context_fingerprint=encode(extensions.digest(convert_to(c.context::text,'UTF8'),'sha256'),'hex')
    AND r.id IS NOT NULL
    AND r.current_version_id=d.representation_version_id
    AND l.id IS NOT NULL
    AND m.lead_fingerprint=public.zeya_p24_lead_fingerprint(l)
    AND o.id IS NOT NULL
    AND o.outcome_fingerprint=m.mandate_fingerprint
    AND o.readiness_result->>'ready'='true'
    AND public.zeya_direct_hire_formation_outcome_is_current(p_owner_id, o.id);
END $$;

REVOKE ALL ON FUNCTION public.zeya_p26_dispatch_is_current(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_p26_dispatch_is_current(uuid, text)
TO service_role;

-- Fix 2: Add explicit validation in authorization creation
-- Reject blocked dispatches (execution_allowed=false) at authorization time

CREATE OR REPLACE FUNCTION public.zeya_authorize_governed_execution(
  p_owner_id uuid,
  p_dispatch_id text,
  p_operation_id uuid,
  p_purpose text
)
RETURNS TABLE(authorization_id uuid, replayed boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  d public.dispatches%ROWTYPE;
  a public.governed_execution_authorizations%ROWTYPE;
  fp text;
  aid uuid;
  astat text;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized';
  END IF;

  IF p_operation_id IS NULL OR p_purpose<>'controlled_preview_voice_qa' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid execution authorization';
  END IF;

  SELECT x.* INTO d FROM public.dispatches x
  WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id FOR UPDATE;

  IF d.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='dispatch not found';
  END IF;

  -- Compute authorization fingerprint
  fp := encode(extensions.digest(
    convert_to(d.source_fingerprint||'|'||p_purpose, 'UTF8'),
    'sha256'), 'hex');

  -- Check for replay BEFORE permission gate — exact replays return existing authorization
  SELECT x.* INTO a FROM public.governed_execution_authorizations x
  WHERE x.owner_id=p_owner_id AND x.authorization_operation_id=p_operation_id;

  IF a.id IS NOT NULL THEN
    IF a.dispatch_id<>p_dispatch_id OR a.purpose<>p_purpose OR a.source_fingerprint<>fp THEN
      RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='authorization operation conflicts';
    END IF;
    aid := a.id;
    astat := a.status;
    RETURN QUERY SELECT aid, true, astat;
    RETURN;
  END IF;

  -- CRITICAL: Only authorize NEW executable dispatches (execution_allowed=true)
  IF d.execution_allowed IS NOT true THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',
      MESSAGE='dispatch is blocked from execution (execution_allowed must be true)';
  END IF;

  -- Verify dispatch lineage is current
  IF NOT public.zeya_p26_dispatch_is_current(p_owner_id, p_dispatch_id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='governed dispatch lineage is stale';
  END IF;

  -- Verify no prior execution artifacts exist
  IF EXISTS(SELECT 1 FROM public.voice_conversation_outputs x WHERE x.mission_id=d.mission_id::text)
    OR EXISTS(SELECT 1 FROM public.mission_execution_outcomes x WHERE x.mission_id=d.mission_id)
    OR EXISTS(SELECT 1 FROM public.dispatch_events x WHERE x.dispatch_id=d.dispatch_id)
    OR EXISTS(SELECT 1 FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=d.worker_brief_id)
    OR d.call_outcome_id IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='dispatch already has execution artifacts';
  END IF;

  -- Create authorization
  INSERT INTO public.governed_execution_authorizations(
    owner_id, dispatch_id, worker_brief_id, mission_id, execution_context_id,
    representation_version_id, mandate_outcome_package_id, lead_id,
    authorization_operation_id, source_fingerprint, authorized_channel,
    authorized_worker_role, purpose
  )
  VALUES(
    p_owner_id, d.dispatch_id, d.worker_brief_id, d.mission_id, d.execution_context_id,
    d.representation_version_id, d.mandate_outcome_package_id, d.lead_id,
    p_operation_id, fp, d.channel, d.worker_role, p_purpose
  ) RETURNING id INTO aid;

  RETURN QUERY SELECT aid, false, 'authorized'::text;
END $$;

REVOKE ALL ON FUNCTION public.zeya_authorize_governed_execution(uuid, text, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_authorize_governed_execution(uuid, text, uuid, text)
TO service_role;

-- Fix 3: Add explicit check in claim function
CREATE OR REPLACE FUNCTION public.zeya_claim_governed_execution(
  p_owner_id uuid,
  p_dispatch_id text,
  p_authorization_id uuid,
  p_operation_id uuid,
  p_target_fingerprint text
)
RETURNS TABLE(attempt_id uuid, claimed boolean, replayed boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  d public.dispatches%ROWTYPE;
  a public.governed_execution_authorizations%ROWTYPE;
  e public.governed_execution_attempts%ROWTYPE;
  fp text;
  eid uuid;
  estat text;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='not authorized';
  END IF;

  IF p_operation_id IS NULL OR p_target_fingerprint!~'^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid execution';
  END IF;

  -- Get authorization
  SELECT x.* INTO a FROM public.governed_execution_authorizations x
  WHERE x.id=p_authorization_id AND x.owner_id=p_owner_id FOR UPDATE;

  IF a.id IS NULL OR a.dispatch_id<>p_dispatch_id THEN
    RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='authorization not found';
  END IF;

  -- Check for replay BEFORE dispatch load — exact replays return existing attempt
  SELECT x.* INTO e FROM public.governed_execution_attempts x
  WHERE x.owner_id=p_owner_id AND x.execution_operation_id=p_operation_id;

  IF e.id IS NOT NULL THEN
    IF e.authorization_id<>a.id OR e.dispatch_id<>p_dispatch_id
      OR e.target_fingerprint<>p_target_fingerprint
    THEN
      RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='execution operation conflicts';
    END IF;
    eid := e.id;
    estat := e.status;
    RETURN QUERY SELECT eid, false, true, estat;
    RETURN;
  END IF;

  -- Get dispatch and verify execution_allowed=true (ONLY for NEW attempts)
  SELECT x.* INTO d FROM public.dispatches x
  WHERE x.dispatch_id=p_dispatch_id AND x.owner_id=p_owner_id FOR UPDATE;

  IF d.id IS NULL OR d.execution_allowed IS NOT true THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',
      MESSAGE='dispatch is not permitted for execution';
  END IF;

  -- Verify authorization is usable
  IF a.status<>'authorized' OR NOT public.zeya_p26_dispatch_is_current(p_owner_id, p_dispatch_id) THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='execution authorization is not usable';
  END IF;

  -- Verify no prior execution artifacts
  IF EXISTS(SELECT 1 FROM public.voice_conversation_outputs x WHERE x.mission_id=d.mission_id::text)
    OR EXISTS(SELECT 1 FROM public.mission_execution_outcomes x WHERE x.mission_id=d.mission_id)
    OR EXISTS(SELECT 1 FROM public.dispatch_events x WHERE x.dispatch_id=d.dispatch_id)
    OR EXISTS(SELECT 1 FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=d.worker_brief_id)
    OR d.call_outcome_id IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE='PZ409', MESSAGE='dispatch already has execution artifacts';
  END IF;

  -- Create attempt and consume authorization atomically
  fp := encode(extensions.digest(
    convert_to(a.source_fingerprint||'|'||p_operation_id::text, 'UTF8'),
    'sha256'), 'hex');

  INSERT INTO public.governed_execution_attempts(
    authorization_id, owner_id, dispatch_id, worker_brief_id, mission_id,
    execution_context_id, representation_version_id, mandate_outcome_package_id,
    lead_id, execution_operation_id, source_fingerprint, target_fingerprint, provider
  )
  VALUES(
    a.id, p_owner_id, d.dispatch_id, d.worker_brief_id, d.mission_id,
    d.execution_context_id, d.representation_version_id, d.mandate_outcome_package_id,
    d.lead_id, p_operation_id, fp, p_target_fingerprint, 'elevenlabs'
  ) RETURNING id INTO eid;

  -- Mark authorization consumed (atomic CAS: must still be 'authorized')
  UPDATE public.governed_execution_authorizations x
  SET status='consumed',
      consumed_at=pg_catalog.now()
  WHERE x.id=a.id
    AND x.status='authorized';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='authorization changed concurrently';
  END IF;

  RETURN QUERY SELECT eid, true, false, 'claimed'::text;
END $$;

REVOKE ALL ON FUNCTION public.zeya_claim_governed_execution(
  uuid, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_claim_governed_execution(
  uuid, text, uuid, uuid, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
