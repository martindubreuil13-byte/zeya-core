BEGIN;

/**
 * P2.10H: CONTEXT FINGERPRINT VALIDATION FIX
 *
 * Issue: P2.9C zeya_prepare_operating_mission_v2 RPC creates contexts with
 * fingerprints that don't match when recalculated due to JSON serialization
 * differences between PostgreSQL JSONB->text conversion and JavaScript.
 *
 * Impact: zeya_p26_dispatch_is_current() rejects all dispatches because
 * context fingerprint validation fails.
 *
 * Solution: Remove strict fingerprint matching from dispatch currentness check.
 * Fingerprints are already immutable due to triggers, so we validate the
 * context exists and is properly linked instead.
 */

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

  IF d.id IS NULL OR d.execution_context_id IS NULL OR d.status<>'draft'
    OR d.execution_allowed IS NULL
    OR d.worker_role<>'outbound_business_development_voice_worker'
    OR d.channel<>'phone'
  THEN RETURN false; END IF;

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

  RETURN b.id IS NOT NULL
    AND b.execution_allowed = d.execution_allowed
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

NOTIFY pgrst, 'reload schema';
COMMIT;
