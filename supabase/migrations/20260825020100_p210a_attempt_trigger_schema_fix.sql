BEGIN;

-- governed_execution_attempts has claimed_at but no created_at. Replace the
-- transition guard without referring to a nonexistent record field.
CREATE OR REPLACE FUNCTION public.zeya_p26_preserve_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' AND current_setting('zeya.controlled_purge',true)='on' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.authorization_id<>OLD.authorization_id OR NEW.owner_id<>OLD.owner_id OR NEW.dispatch_id<>OLD.dispatch_id
    OR NEW.worker_brief_id<>OLD.worker_brief_id OR NEW.mission_id<>OLD.mission_id OR NEW.execution_context_id<>OLD.execution_context_id
    OR NEW.representation_version_id<>OLD.representation_version_id OR NEW.mandate_outcome_package_id<>OLD.mandate_outcome_package_id OR NEW.lead_id<>OLD.lead_id
    OR NEW.execution_operation_id<>OLD.execution_operation_id OR NEW.source_fingerprint<>OLD.source_fingerprint OR NEW.target_fingerprint<>OLD.target_fingerprint
    OR NEW.provider<>OLD.provider OR NEW.claimed_at<>OLD.claimed_at
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

COMMIT;
