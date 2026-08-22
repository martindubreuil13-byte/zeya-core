BEGIN;

-- A provider-accepted attempt remains dispatched until durable provider truth
-- proves a terminal non-success. Preserve its accepted identity while allowing
-- that one monotonic transition.
CREATE OR REPLACE FUNCTION public.zeya_complete_governed_execution(
  p_owner_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_provider_call_id text,
  p_conversation_id text,
  p_error_code text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role()<>'service_role' OR p_status NOT IN ('dispatched','failed') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized';
  END IF;
  IF p_status='failed' AND p_error_code NOT IN ('provider_failed','provider_unanswered','provider_rejected')
    AND EXISTS(SELECT 1 FROM public.governed_execution_attempts x WHERE x.id=p_attempt_id AND x.owner_id=p_owner_id AND x.status='dispatched')
  THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid terminal provider outcome';
  END IF;

  UPDATE public.governed_execution_attempts x
  SET status=p_status,
      provider_call_id=nullif(p_provider_call_id,''),
      conversation_id=nullif(p_conversation_id,''),
      error_code=nullif(p_error_code,''),
      started_at=coalesce(x.started_at,pg_catalog.now()),
      completed_at=CASE WHEN p_status='failed' THEN pg_catalog.now() ELSE NULL END
  WHERE x.id=p_attempt_id AND x.owner_id=p_owner_id
    AND (
      x.status='claimed'
      OR (
        x.status='dispatched' AND p_status='failed'
        AND x.provider_call_id IS NOT DISTINCT FROM nullif(p_provider_call_id,'')
        AND x.conversation_id IS NOT DISTINCT FROM nullif(p_conversation_id,'')
        AND p_error_code IN ('provider_failed','provider_unanswered','provider_rejected')
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='execution attempt is not completable';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.zeya_p26_preserve_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.authorization_id<>OLD.authorization_id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id
    OR NEW.worker_brief_id<>OLD.worker_brief_id OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id
    OR NEW.representation_version_id<>OLD.representation_version_id OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id
    OR NEW.execution_operation_id<>OLD.execution_operation_id OR NEW.source_fingerprint<>OLD.source_fingerprint OR NEW.target_fingerprint<>OLD.target_fingerprint
    OR NEW.provider<>OLD.provider OR NEW.claimed_at<>OLD.claimed_at OR NEW.created_at<>OLD.created_at
    OR OLD.status='failed'
    OR (OLD.status='claimed' AND NEW.status NOT IN ('dispatched','failed'))
    OR (OLD.status='dispatched' AND (
      NEW.status<>'failed'
      OR NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id
      OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR NEW.error_code NOT IN ('provider_failed','provider_unanswered','provider_rejected')
      OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
    ))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='execution attempt is immutable'; END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_complete_governed_execution(uuid,uuid,text,text,text,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
