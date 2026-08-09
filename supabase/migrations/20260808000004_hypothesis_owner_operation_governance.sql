BEGIN;

CREATE TABLE public.hypothesis_owner_operations (
  operation_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  business_representation_id UUID NOT NULL
    REFERENCES public.business_representations(id) ON DELETE RESTRICT,
  direct_hire_onboarding_session_id UUID NOT NULL
    REFERENCES public.direct_hire_onboarding_sessions(id) ON DELETE RESTRICT,
  hypothesis_id UUID NOT NULL REFERENCES public.hypotheses(id) ON DELETE RESTRICT,
  constitutional_domain VARCHAR(50) NOT NULL,
  decision public.approval_decision_type NOT NULL,
  request_hash TEXT NOT NULL,
  correction_evidence_id UUID REFERENCES public.evidence(id) ON DELETE RESTRICT,
  verification_id UUID NOT NULL UNIQUE
    REFERENCES public.hypothesis_verifications(id) ON DELETE RESTRICT,
  successor_request_trace_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT hypothesis_owner_operation_domain_valid CHECK (
    constitutional_domain IN (
      'whatYouSell', 'whoItIsFor', 'problemOrAspiration',
      'whyCustomersShouldCare', 'proposedDescription',
      'authorityBoundaries', 'clarificationsNeeded'
    )
  ),
  CONSTRAINT hypothesis_owner_operation_request_hash_valid CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT hypothesis_owner_operation_decision_shape CHECK (
    (
      decision = 'rejected'::public.approval_decision_type
      AND correction_evidence_id IS NOT NULL
      AND successor_request_trace_id IS NOT NULL
    )
    OR
    (
      decision IN (
        'approved'::public.approval_decision_type,
        'deferred'::public.approval_decision_type
      )
      AND correction_evidence_id IS NULL
      AND successor_request_trace_id IS NULL
    )
  )
);

CREATE INDEX hypothesis_owner_operations_owner_created_idx
  ON public.hypothesis_owner_operations(owner_id, created_at DESC);

CREATE INDEX hypothesis_owner_operations_session_domain_created_idx
  ON public.hypothesis_owner_operations(
    direct_hire_onboarding_session_id,
    constitutional_domain,
    created_at DESC
  );

CREATE INDEX hypothesis_owner_operations_hypothesis_created_idx
  ON public.hypothesis_owner_operations(hypothesis_id, created_at DESC);

CREATE UNIQUE INDEX hypothesis_owner_operations_correction_evidence_idx
  ON public.hypothesis_owner_operations(correction_evidence_id)
  WHERE correction_evidence_id IS NOT NULL;

CREATE UNIQUE INDEX hypothesis_owner_operations_one_rejection_idx
  ON public.hypothesis_owner_operations(hypothesis_id)
  WHERE decision = 'rejected'::public.approval_decision_type;

CREATE INDEX hypothesis_owner_operations_successor_trace_idx
  ON public.hypothesis_owner_operations(
    direct_hire_onboarding_session_id,
    constitutional_domain,
    successor_request_trace_id
  )
  WHERE successor_request_trace_id IS NOT NULL;

CREATE FUNCTION public.zeya_enforce_hypothesis_owner_operation_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND current_setting('zeya.controlled_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'hypothesis owner operations are immutable';
END;
$$;

CREATE TRIGGER zeya_hypothesis_owner_operation_immutability
  BEFORE UPDATE OR DELETE ON public.hypothesis_owner_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.zeya_enforce_hypothesis_owner_operation_immutability();

ALTER TABLE public.hypothesis_owner_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hypothesis_owner_operations_owner_select
  ON public.hypothesis_owner_operations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

REVOKE ALL ON TABLE public.hypothesis_owner_operations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.hypothesis_owner_operations
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.zeya_enforce_hypothesis_owner_operation_immutability()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_enforce_hypothesis_owner_operation_immutability()
  TO postgres;

CREATE FUNCTION public.zeya_apply_hypothesis_owner_action(
  p_owner_id UUID,
  p_hypothesis_id UUID,
  p_decision public.approval_decision_type,
  p_operation_id UUID,
  p_correction_text TEXT DEFAULT NULL
)
RETURNS TABLE (
  operation_id UUID,
  hypothesis_id UUID,
  hypothesis_version BIGINT,
  decision public.approval_decision_type,
  verification_id UUID,
  verification_sequence BIGINT,
  correction_evidence_id UUID,
  successor_request_trace_id VARCHAR(64),
  operation_state TEXT,
  replayed BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_initial_hypothesis public.hypotheses%ROWTYPE;
  v_hypothesis public.hypotheses%ROWTYPE;
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_existing_operation public.hypothesis_owner_operations%ROWTYPE;
  v_existing_verification public.hypothesis_verifications%ROWTYPE;
  v_current_hypothesis_id UUID;
  v_normalized_correction TEXT;
  v_transient_payload JSONB;
  v_request_hash TEXT;
  v_successor_trace TEXT;
  v_verification_sequence BIGINT;
  v_verification_id UUID;
  v_correction_evidence_id UUID;
  v_operation_created_at TIMESTAMPTZ;
  v_operation_state TEXT;
  v_successor_count BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_owner_id IS NULL
     OR p_hypothesis_id IS NULL
     OR p_decision IS NULL
     OR p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid owner action';
  END IF;

  IF p_decision = 'rejected'::public.approval_decision_type THEN
    v_normalized_correction := pg_catalog.btrim(p_correction_text);
    IF v_normalized_correction IS NULL
       OR pg_catalog.char_length(v_normalized_correction) NOT BETWEEN 1 AND 4000 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid correction';
    END IF;
  ELSE
    IF p_correction_text IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'correction is not allowed for this decision';
    END IF;
    v_normalized_correction := NULL;
  END IF;

  v_transient_payload := pg_catalog.jsonb_build_object(
    'hypothesisId', p_hypothesis_id,
    'decision', p_decision::TEXT,
    'correctionText', v_normalized_correction
  );
  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_transient_payload::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::TEXT, 0)
  );

  SELECT h.*
  INTO v_initial_hypothesis
  FROM public.hypotheses AS h
  WHERE h.id = p_hypothesis_id
    AND h.owner_id = p_owner_id;

  IF v_initial_hypothesis.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.direct_hire_onboarding_sessions AS s
  WHERE s.id = v_initial_hypothesis.direct_hire_onboarding_session_id
    AND s.owner_id = p_owner_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT h.*
  INTO v_hypothesis
  FROM public.hypotheses AS h
  WHERE h.id = p_hypothesis_id
    AND h.owner_id = p_owner_id
    AND h.business_id = v_session.business_id
    AND h.business_representation_id = v_session.business_representation_id
    AND h.direct_hire_onboarding_session_id = v_session.id
  FOR UPDATE;

  IF v_hypothesis.id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.businesses AS b
       WHERE b.id = v_hypothesis.business_id
         AND b.user_id = p_owner_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.business_representations AS br
       WHERE br.id = v_hypothesis.business_representation_id
         AND br.business_id = v_hypothesis.business_id
         AND br.user_id = p_owner_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'hypothesis not found';
  END IF;

  SELECT op.*
  INTO v_existing_operation
  FROM public.hypothesis_owner_operations AS op
  WHERE op.operation_id = p_operation_id;

  IF v_existing_operation.operation_id IS NOT NULL THEN
    IF v_existing_operation.owner_id IS DISTINCT FROM p_owner_id
       OR v_existing_operation.hypothesis_id IS DISTINCT FROM p_hypothesis_id
       OR v_existing_operation.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'operation_conflict';
    END IF;

    SELECT hv.*
    INTO v_existing_verification
    FROM public.hypothesis_verifications AS hv
    WHERE hv.id = v_existing_operation.verification_id
      AND hv.hypothesis_id = v_existing_operation.hypothesis_id
      AND hv.verifier_user_id = v_existing_operation.owner_id;

    IF v_existing_verification.id IS NULL
       OR v_existing_verification.decision IS DISTINCT FROM v_existing_operation.decision THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'operation lineage invalid';
    END IF;

    IF v_existing_operation.decision = 'rejected'::public.approval_decision_type THEN
      SELECT pg_catalog.count(*)
      INTO v_successor_count
      FROM public.hypotheses AS replay_successor
      WHERE replay_successor.request_trace_id = v_existing_operation.successor_request_trace_id;

      IF v_successor_count > 1 OR EXISTS (
        SELECT 1
        FROM public.hypotheses AS invalid_successor
        WHERE invalid_successor.request_trace_id = v_existing_operation.successor_request_trace_id
          AND (
            invalid_successor.owner_id IS DISTINCT FROM v_existing_operation.owner_id
            OR invalid_successor.business_id IS DISTINCT FROM v_existing_operation.business_id
            OR invalid_successor.business_representation_id IS DISTINCT FROM v_existing_operation.business_representation_id
            OR invalid_successor.direct_hire_onboarding_session_id IS DISTINCT FROM v_existing_operation.direct_hire_onboarding_session_id
            OR invalid_successor.constitutional_domain IS DISTINCT FROM v_existing_operation.constitutional_domain
            OR invalid_successor.previous_hypothesis_id IS DISTINCT FROM v_existing_operation.hypothesis_id
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor lineage invalid';
      END IF;
      v_operation_state := CASE WHEN v_successor_count = 1 THEN 'complete' ELSE 'reasoning_pending' END;
    ELSE
      v_operation_state := 'accepted';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_operation.operation_id AS operation_id,
      v_existing_operation.hypothesis_id AS hypothesis_id,
      v_hypothesis.hypothesis_version AS hypothesis_version,
      v_existing_operation.decision AS decision,
      v_existing_operation.verification_id AS verification_id,
      v_existing_verification.verification_sequence AS verification_sequence,
      v_existing_operation.correction_evidence_id AS correction_evidence_id,
      v_existing_operation.successor_request_trace_id AS successor_request_trace_id,
      v_operation_state AS operation_state,
      TRUE AS replayed,
      v_existing_operation.created_at AS created_at;
    RETURN;
  END IF;

  SELECT current_h.id
  INTO v_current_hypothesis_id
  FROM public.hypotheses AS current_h
  WHERE current_h.direct_hire_onboarding_session_id = v_session.id
    AND current_h.constitutional_domain = v_hypothesis.constitutional_domain
  ORDER BY current_h.hypothesis_version DESC
  LIMIT 1;

  IF v_current_hypothesis_id IS DISTINCT FROM v_hypothesis.id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'stale_hypothesis';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hypothesis_owner_operations AS pending_op
    WHERE pending_op.hypothesis_id = v_hypothesis.id
      AND pending_op.decision = 'rejected'::public.approval_decision_type
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'correction_pending';
  END IF;

  IF p_decision = 'rejected'::public.approval_decision_type THEN
    INSERT INTO public.evidence AS correction_evidence (
      business_representation_id,
      direct_hire_onboarding_session_id,
      source_type,
      source_description,
      raw_statement,
      affected_domains,
      captured_by_actor
    ) VALUES (
      v_hypothesis.business_representation_id,
      v_hypothesis.direct_hire_onboarding_session_id,
      'manual'::public.evidence_source_type,
      'Owner correction to hypothesis',
      v_normalized_correction,
      ARRAY[v_hypothesis.constitutional_domain]::TEXT[],
      'owner:' || p_owner_id::TEXT
    )
    RETURNING correction_evidence.id INTO v_correction_evidence_id;

    v_successor_trace := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'hypothesis-owner-correction-v1'
          || '|'
          || p_operation_id::TEXT
          || '|'
          || v_hypothesis.constitutional_domain,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  ELSE
    v_correction_evidence_id := NULL;
    v_successor_trace := NULL;
  END IF;

  SELECT pg_catalog.coalesce(pg_catalog.max(hv.verification_sequence), 0) + 1
  INTO v_verification_sequence
  FROM public.hypothesis_verifications AS hv
  WHERE hv.hypothesis_id = v_hypothesis.id;

  INSERT INTO public.hypothesis_verifications AS inserted_verification (
    hypothesis_id,
    verification_sequence,
    decision,
    verification_reasoning,
    verifier_user_id,
    created_at
  ) VALUES (
    v_hypothesis.id,
    v_verification_sequence,
    p_decision,
    NULL,
    p_owner_id,
    pg_catalog.now()
  )
  RETURNING inserted_verification.id INTO v_verification_id;

  INSERT INTO public.hypothesis_owner_operations AS inserted_operation (
    operation_id,
    owner_id,
    business_id,
    business_representation_id,
    direct_hire_onboarding_session_id,
    hypothesis_id,
    constitutional_domain,
    decision,
    request_hash,
    correction_evidence_id,
    verification_id,
    successor_request_trace_id
  ) VALUES (
    p_operation_id,
    p_owner_id,
    v_hypothesis.business_id,
    v_hypothesis.business_representation_id,
    v_hypothesis.direct_hire_onboarding_session_id,
    v_hypothesis.id,
    v_hypothesis.constitutional_domain,
    p_decision,
    v_request_hash,
    v_correction_evidence_id,
    v_verification_id,
    v_successor_trace
  )
  RETURNING inserted_operation.created_at INTO v_operation_created_at;

  RETURN QUERY
  SELECT
    p_operation_id AS operation_id,
    v_hypothesis.id AS hypothesis_id,
    v_hypothesis.hypothesis_version AS hypothesis_version,
    p_decision AS decision,
    v_verification_id AS verification_id,
    v_verification_sequence AS verification_sequence,
    v_correction_evidence_id AS correction_evidence_id,
    v_successor_trace::VARCHAR(64) AS successor_request_trace_id,
    CASE
      WHEN p_decision = 'rejected'::public.approval_decision_type
        THEN 'reasoning_pending'
      ELSE 'accepted'
    END AS operation_state,
    FALSE AS replayed,
    v_operation_created_at AS created_at;
END;
$$;

ALTER FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_apply_hypothesis_owner_action(
  UUID, UUID, public.approval_decision_type, UUID, TEXT
) TO service_role;

CREATE FUNCTION public.zeya_persist_hypothesis_owner_correction_successor(
  p_owner_id UUID,
  p_operation_id UUID,
  p_constitutional_domain VARCHAR(50),
  p_epistemic_state VARCHAR(20),
  p_current_belief TEXT,
  p_confidence VARCHAR(10),
  p_representation_risk VARCHAR(10),
  p_risk_reason TEXT,
  p_source_evidence_ids UUID[],
  p_evidence_cutoff_at TIMESTAMPTZ
)
RETURNS TABLE (
  operation_id UUID,
  successor_hypothesis_id UUID,
  successor_version BIGINT,
  is_idempotent_return BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation public.hypothesis_owner_operations%ROWTYPE;
  v_session public.direct_hire_onboarding_sessions%ROWTYPE;
  v_target public.hypotheses%ROWTYPE;
  v_existing_successor public.hypotheses%ROWTYPE;
  v_persisted RECORD;
  v_successor public.hypotheses%ROWTYPE;
  v_current_hypothesis_id UUID;
  v_trace_count BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not authorized';
  END IF;

  IF p_owner_id IS NULL
     OR p_operation_id IS NULL
     OR p_constitutional_domain IS NULL
     OR p_epistemic_state IS NULL
     OR p_confidence IS NULL
     OR p_representation_risk IS NULL
     OR p_source_evidence_ids IS NULL
     OR p_evidence_cutoff_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid successor parameters';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::TEXT, 0)
  );

  SELECT op.*
  INTO v_operation
  FROM public.hypothesis_owner_operations AS op
  WHERE op.operation_id = p_operation_id;

  IF v_operation.operation_id IS NULL
     OR v_operation.owner_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'operation not found';
  END IF;

  IF v_operation.decision IS DISTINCT FROM 'rejected'::public.approval_decision_type THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'operation does not require a successor';
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.direct_hire_onboarding_sessions AS s
  WHERE s.id = v_operation.direct_hire_onboarding_session_id
    AND s.owner_id = p_owner_id
    AND s.business_id = v_operation.business_id
    AND s.business_representation_id = v_operation.business_representation_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'operation not found';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_trace_count
  FROM public.hypotheses AS trace_h
  WHERE trace_h.request_trace_id = v_operation.successor_request_trace_id;

  IF v_trace_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor lineage invalid';
  ELSIF v_trace_count = 1 THEN
    SELECT trace_h.*
    INTO v_existing_successor
    FROM public.hypotheses AS trace_h
    WHERE trace_h.request_trace_id = v_operation.successor_request_trace_id;

    IF v_existing_successor.owner_id IS DISTINCT FROM v_operation.owner_id
       OR v_existing_successor.business_id IS DISTINCT FROM v_operation.business_id
       OR v_existing_successor.business_representation_id IS DISTINCT FROM v_operation.business_representation_id
       OR v_existing_successor.direct_hire_onboarding_session_id IS DISTINCT FROM v_operation.direct_hire_onboarding_session_id
       OR v_existing_successor.constitutional_domain IS DISTINCT FROM v_operation.constitutional_domain
       OR v_existing_successor.previous_hypothesis_id IS DISTINCT FROM v_operation.hypothesis_id THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor lineage invalid';
    END IF;

    RETURN QUERY
    SELECT
      v_operation.operation_id AS operation_id,
      v_existing_successor.id AS successor_hypothesis_id,
      v_existing_successor.hypothesis_version AS successor_version,
      TRUE AS is_idempotent_return,
      v_existing_successor.created_at AS created_at;
    RETURN;
  END IF;

  IF p_constitutional_domain IS DISTINCT FROM v_operation.constitutional_domain THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'successor domain mismatch';
  END IF;

  IF NOT (
    v_operation.correction_evidence_id = ANY(p_source_evidence_ids)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'correction Evidence is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_source_evidence_ids) AS supplied_evidence(evidence_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.evidence AS e
      WHERE e.id = supplied_evidence.evidence_id
        AND e.business_representation_id = v_operation.business_representation_id
        AND e.direct_hire_onboarding_session_id = v_operation.direct_hire_onboarding_session_id
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'successor Evidence scope mismatch';
  END IF;

  SELECT target_h.*
  INTO v_target
  FROM public.hypotheses AS target_h
  WHERE target_h.id = v_operation.hypothesis_id
    AND target_h.owner_id = v_operation.owner_id
    AND target_h.business_id = v_operation.business_id
    AND target_h.business_representation_id = v_operation.business_representation_id
    AND target_h.direct_hire_onboarding_session_id = v_operation.direct_hire_onboarding_session_id
    AND target_h.constitutional_domain = v_operation.constitutional_domain
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'operation lineage invalid';
  END IF;

  SELECT current_h.id
  INTO v_current_hypothesis_id
  FROM public.hypotheses AS current_h
  WHERE current_h.direct_hire_onboarding_session_id = v_operation.direct_hire_onboarding_session_id
    AND current_h.constitutional_domain = v_operation.constitutional_domain
  ORDER BY current_h.hypothesis_version DESC
  LIMIT 1;

  IF v_current_hypothesis_id IS DISTINCT FROM v_operation.hypothesis_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ409', MESSAGE = 'stale_hypothesis';
  END IF;

  SELECT persisted.*
  INTO v_persisted
  FROM public.zeya_persist_hypothesis(
    p_owner_id,
    v_operation.direct_hire_onboarding_session_id,
    v_operation.constitutional_domain,
    p_epistemic_state,
    p_current_belief,
    p_confidence,
    p_representation_risk,
    p_risk_reason,
    p_source_evidence_ids,
    p_evidence_cutoff_at,
    v_operation.successor_request_trace_id,
    'owner_correction'
  ) AS persisted;

  IF v_persisted.hypothesis_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor persistence returned no data';
  END IF;

  SELECT successor_h.*
  INTO v_successor
  FROM public.hypotheses AS successor_h
  WHERE successor_h.id = v_persisted.hypothesis_id;

  IF v_successor.id IS NULL
     OR v_successor.owner_id IS DISTINCT FROM v_operation.owner_id
     OR v_successor.business_id IS DISTINCT FROM v_operation.business_id
     OR v_successor.business_representation_id IS DISTINCT FROM v_operation.business_representation_id
     OR v_successor.direct_hire_onboarding_session_id IS DISTINCT FROM v_operation.direct_hire_onboarding_session_id
     OR v_successor.constitutional_domain IS DISTINCT FROM v_operation.constitutional_domain
     OR v_successor.request_trace_id IS DISTINCT FROM v_operation.successor_request_trace_id
     OR v_successor.previous_hypothesis_id IS DISTINCT FROM v_operation.hypothesis_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'successor lineage invalid';
  END IF;

  RETURN QUERY
  SELECT
    v_operation.operation_id AS operation_id,
    v_successor.id AS successor_hypothesis_id,
    v_successor.hypothesis_version AS successor_version,
    v_persisted.is_idempotent_return::BOOLEAN AS is_idempotent_return,
    v_successor.created_at AS created_at;
END;
$$;

ALTER FUNCTION public.zeya_persist_hypothesis_owner_correction_successor(
  UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMPTZ
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_persist_hypothesis_owner_correction_successor(
  UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_persist_hypothesis_owner_correction_successor(
  UUID, UUID, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, UUID[], TIMESTAMPTZ
) TO service_role;

-- Preserve the complete RF-A purge inventory while adding hypothesis governance
-- and moving Formation deletion after its RESTRICT-linked correction Evidence.
CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation(
  p_business_representation_id UUID,
  p_expected_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actual_business_id UUID;
  v_deleted JSONB := '{}'::JSONB;
  v_count INTEGER;
  v_hypothesis_count INTEGER := 0;
  v_leaf_count INTEGER;
  v_remaining_hypotheses INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'purge not authorized';
  END IF;

  SELECT br.business_id
  INTO v_actual_business_id
  FROM public.business_representations AS br
  WHERE br.id = p_business_representation_id
  FOR UPDATE;

  IF v_actual_business_id IS NULL OR v_actual_business_id <> p_expected_business_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ404', MESSAGE = 'representation not found';
  END IF;

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'on', true);

  DELETE FROM public.conversation_candidate_canonicalizations AS canonicalization
  WHERE canonicalization.business_representation_id = p_business_representation_id
    AND canonicalization.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_canonicalizations', v_count);

  DELETE FROM public.audit_events AS audit_event
  WHERE audit_event.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('audit_events', v_count);

  DELETE FROM public.confidence_assessments AS confidence_assessment
  WHERE confidence_assessment.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('confidence_assessments', v_count);

  DELETE FROM public.conversation_candidate_promotions AS promotion
  WHERE promotion.business_representation_id = p_business_representation_id
    AND promotion.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_promotions', v_count);

  DELETE FROM public.conversation_candidate_review_decisions AS review_decision
  WHERE review_decision.business_representation_id = p_business_representation_id
    AND review_decision.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('conversation_candidate_review_decisions', v_count);

  DELETE FROM public.voice_conversation_candidates AS candidate
  WHERE candidate.business_representation_id = p_business_representation_id
    AND candidate.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_conversation_candidates', v_count);

  DELETE FROM public.voice_conversation_outputs AS output
  WHERE output.business_representation_id = p_business_representation_id
    AND output.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_conversation_outputs', v_count);

  DELETE FROM public.voice_representation_lineage AS lineage
  WHERE lineage.business_representation_id = p_business_representation_id
    AND lineage.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('voice_representation_lineage', v_count);

  UPDATE public.business_representations AS representation
  SET current_version_id = NULL
  WHERE representation.id = p_business_representation_id
    AND representation.business_id = p_expected_business_id;

  UPDATE public.representation_elements AS element
  SET current_value_version_id = NULL
  WHERE element.business_representation_id = p_business_representation_id;

  DELETE FROM public.representation_versions AS version
  WHERE version.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_versions', v_count);

  DELETE FROM public.approval_decisions AS approval
  WHERE approval.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('approval_decisions', v_count);

  DELETE FROM public.proposal_elements AS proposal_element
  WHERE proposal_element.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_elements', v_count);

  DELETE FROM public.proposal_evidence AS proposal_evidence_row
  WHERE proposal_evidence_row.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_evidence', v_count);

  DELETE FROM public.proposal_observations AS proposal_observation
  WHERE proposal_observation.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('proposal_observations', v_count);

  DELETE FROM public.hypothesis_owner_operations AS owner_operation
  WHERE owner_operation.business_representation_id = p_business_representation_id
    AND owner_operation.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('hypothesis_owner_operations', v_count);

  DELETE FROM public.hypothesis_verifications AS verification
  WHERE EXISTS (
    SELECT 1
    FROM public.hypotheses AS verification_hypothesis
    WHERE verification_hypothesis.id = verification.hypothesis_id
      AND verification_hypothesis.business_representation_id = p_business_representation_id
      AND verification_hypothesis.business_id = p_expected_business_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('hypothesis_verifications', v_count);

  LOOP
    DELETE FROM public.hypotheses AS leaf_hypothesis
    WHERE leaf_hypothesis.business_representation_id = p_business_representation_id
      AND leaf_hypothesis.business_id = p_expected_business_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.hypotheses AS child_hypothesis
        WHERE child_hypothesis.previous_hypothesis_id = leaf_hypothesis.id
      );
    GET DIAGNOSTICS v_leaf_count = ROW_COUNT;
    v_hypothesis_count := v_hypothesis_count + v_leaf_count;
    EXIT WHEN v_leaf_count = 0;
  END LOOP;

  SELECT pg_catalog.count(*)
  INTO v_remaining_hypotheses
  FROM public.hypotheses AS remaining_hypothesis
  WHERE remaining_hypothesis.business_representation_id = p_business_representation_id
    AND remaining_hypothesis.business_id = p_expected_business_id;

  IF v_remaining_hypotheses <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'hypothesis purge lineage invalid';
  END IF;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('hypotheses', v_hypothesis_count);

  DELETE FROM public.observations AS observation
  WHERE observation.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('observations', v_count);

  DELETE FROM public.evidence AS evidence_row
  WHERE evidence_row.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('evidence', v_count);

  DELETE FROM public.representation_proposals AS proposal
  WHERE proposal.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_proposals', v_count);

  DELETE FROM public.representation_formation_sessions AS formation_session
  WHERE formation_session.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_formation_sessions', v_count);

  DELETE FROM public.representation_elements AS representation_element
  WHERE representation_element.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_elements', v_count);

  DELETE FROM public.representation_domains AS representation_domain
  WHERE representation_domain.business_representation_id = p_business_representation_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('representation_domains', v_count);

  DELETE FROM public.business_representations AS business_representation
  WHERE business_representation.id = p_business_representation_id
    AND business_representation.business_id = p_expected_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || pg_catalog.jsonb_build_object('business_representations', v_count);

  PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);

  RETURN pg_catalog.jsonb_build_object(
    'businessRepresentationId', p_business_representation_id,
    'businessId', p_expected_business_id,
    'deleted', v_deleted
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('zeya.controlled_purge', 'off', true);
    RAISE;
END;
$$;

ALTER FUNCTION public.zeya_purge_business_representation(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
