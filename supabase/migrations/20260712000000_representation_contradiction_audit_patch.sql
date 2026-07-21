-- Normalized migration version: 20260712000000.
-- Minimal patch for Canonical Representation State contradiction handling.
-- Allows immutable audit events to record deterministic contradiction handling.

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_event_type_check;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_event_type_check CHECK (
    event_type IN (
      'evidence_created',
      'observation_created',
      'proposal_created',
      'proposal_assessed',
      'proposal_approved',
      'proposal_rejected',
      'contradiction_detected',
      'version_created',
      'version_rolled_back',
      'confidence_calculated',
      'domain_maturity_updated'
    )
  );

DROP POLICY IF EXISTS "users_can_update_own_elements" ON representation_elements;
CREATE POLICY "users_can_update_own_elements"
  ON representation_elements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_representations
      WHERE id = business_representation_id AND auth.uid() = user_id
    )
  );

CREATE OR REPLACE FUNCTION evidence_prevent_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'postgres' AND current_setting('zeya.controlled_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Evidence records are immutable. Cannot % evidence %.', TG_OP, OLD.id;
END;
$$;

CREATE OR REPLACE FUNCTION representation_versions_prevent_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'postgres' AND current_setting('zeya.controlled_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Representation versions are immutable. Cannot % version %.', TG_OP, OLD.id;
END;
$$;

CREATE OR REPLACE FUNCTION audit_events_prevent_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'postgres' AND current_setting('zeya.controlled_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Audit events are immutable. Cannot % event %.', TG_OP, OLD.id;
END;
$$;

CREATE OR REPLACE FUNCTION zeya_purge_business_representation(
  p_business_representation_id UUID,
  p_expected_business_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actual UUID; c JSONB := '{}'::jsonb; n INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='purge not authorized'; END IF;
  SELECT business_id INTO actual FROM business_representations WHERE id=p_business_representation_id FOR UPDATE;
  IF actual IS NULL OR actual <> p_expected_business_id THEN RAISE EXCEPTION USING ERRCODE='PZ404', MESSAGE='representation not found'; END IF;
  PERFORM set_config('zeya.controlled_purge','on',true);
  DELETE FROM audit_events WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('audit_events',n);
  DELETE FROM confidence_assessments WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('confidence_assessments',n);
  UPDATE business_representations SET current_version_id=NULL WHERE id=p_business_representation_id;
  DELETE FROM representation_versions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('representation_versions',n);
  DELETE FROM approval_decisions WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('approval_decisions',n);
  DELETE FROM proposal_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('proposal_elements',n);
  DELETE FROM proposal_evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('proposal_evidence',n);
  DELETE FROM proposal_observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('proposal_observations',n);
  DELETE FROM representation_proposals WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('representation_proposals',n);
  DELETE FROM observations WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('observations',n);
  DELETE FROM evidence WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('evidence',n);
  DELETE FROM representation_elements WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('representation_elements',n);
  DELETE FROM representation_domains WHERE business_representation_id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('representation_domains',n);
  DELETE FROM business_representations WHERE id=p_business_representation_id; GET DIAGNOSTICS n=ROW_COUNT; c=c||jsonb_build_object('business_representations',n);
  RETURN jsonb_build_object('businessRepresentationId',p_business_representation_id,'businessId',p_expected_business_id,'deleted',c);
END;
$$;
REVOKE ALL ON FUNCTION zeya_purge_business_representation(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION zeya_purge_business_representation(UUID,UUID) TO service_role;
