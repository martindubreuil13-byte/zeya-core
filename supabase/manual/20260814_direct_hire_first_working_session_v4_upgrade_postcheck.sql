-- READ ONLY. Run once after the governed transition and again after one successful v4 worker run.

WITH transition_function AS (
  SELECT procedure.oid, procedure.proowner, procedure.proacl,
    pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
    lower(regexp_replace(pg_get_functiondef(procedure.oid), '\s+', ' ', 'g')) AS definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = to_regprocedure(
    'public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text)'
  )
), public_acl AS (
  SELECT transition_function.oid,
    coalesce(bool_or(expanded.grantee = 0 AND expanded.privilege_type = 'EXECUTE'), false) AS public_execute
  FROM transition_function
  LEFT JOIN LATERAL aclexplode(
    coalesce(transition_function.proacl, acldefault('f', transition_function.proowner))
  ) AS expanded ON true
  GROUP BY transition_function.oid
), object_check AS (
  SELECT to_regclass('public.direct_hire_first_working_session_preparation_regenerations') IS NOT NULL
     AND to_regprocedure('public.zeya_reject_v4_first_working_session_brief_aliases()') IS NOT NULL
     AND to_regprocedure('public.zeya_prevent_first_working_session_preparation_regeneration_modification()') IS NOT NULL
     AND count(*) = 1
     AND bool_and(identity_arguments = 'p_working_session_id uuid, p_expected_current_v3_brief_id uuid, p_regeneration_reason_code text')
     AND bool_and(definition LIKE '%security definer%')
     AND bool_and(definition LIKE '%for update%') AS ok
  FROM transition_function
), acl_check AS (
  SELECT NOT public_acl.public_execute
     AND NOT coalesce(has_function_privilege(to_regrole('anon'), transition_function.oid, 'EXECUTE'), false)
     AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), transition_function.oid, 'EXECUTE'), false)
     AND coalesce(has_function_privilege(to_regrole('service_role'), transition_function.oid, 'EXECUTE'), false) AS ok
  FROM transition_function JOIN public_acl USING (oid)
)
SELECT 'migration_objects_present', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM object_check
UNION ALL SELECT 'transition_rpc_service_role_only', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM acl_check;

WITH target AS (
  SELECT * FROM public.direct_hire_working_sessions
  WHERE id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), regeneration AS (
  SELECT * FROM public.direct_hire_first_working_session_preparation_regenerations
  WHERE direct_hire_working_session_id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
    AND prior_current_brief_id = '48c5fb80-523b-4d7c-9a66-d103c37ead75'::uuid
    AND prior_contract_version = 'first-working-session-preparation-v3'
    AND new_contract_version = 'first-working-session-preparation-v4'
    AND regeneration_reason_code = 'persisted_alias_invariant_upgrade'
), transition_checkpoint AS (
  SELECT count(*) = 1
     AND bool_and(target.status = 'scheduled')
     AND bool_and(target.preparation_status = 'pending')
     AND bool_and(target.preparation_contract_version = 'first-working-session-preparation-v4')
     AND bool_and(target.preparation_attempt_count = 0)
     AND bool_and(target.preparation_started_at IS NULL)
     AND bool_and(target.preparation_completed_at IS NULL)
     AND bool_and(target.preparation_failure_code IS NULL)
     AND bool_and(target.preparation_lease_id IS NULL)
     AND bool_and(target.preparation_lease_expires_at IS NULL)
     AND bool_and(target.preparation_snapshot_fingerprint IS NULL)
     AND bool_and(target.preparation_website_persisted_at = regeneration.website_checkpoint_at)
     AND bool_and(regeneration.prior_preparation_status = 'ready')
     AND bool_and(regeneration.prior_snapshot_fingerprint IS NOT NULL)
     AND bool_and(regeneration.regenerated_by_role IN ('service_role', 'postgres')) AS ok
  FROM target JOIN regeneration ON true
), v3_still_current AS (
  SELECT count(*) = 1 AS ok
  FROM public.direct_hire_first_working_session_briefs AS brief
  WHERE brief.id = '48c5fb80-523b-4d7c-9a66-d103c37ead75'::uuid
    AND brief.direct_hire_working_session_id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
    AND brief.preparation_contract_version = 'first-working-session-preparation-v3'
    AND brief.current
), one_ledger_row AS (
  SELECT count(*) = 1 AS ok FROM regeneration
)
SELECT 'A_transition_pending_v4_checkpoint_preserved', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM transition_checkpoint
UNION ALL SELECT 'A_v3_brief_remains_current', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM v3_still_current
UNION ALL SELECT 'A_exactly_one_transition_ledger_row', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM one_ledger_row;

-- Checkpoint B is expected to PASS only after successful v4 finalization.
WITH target AS (
  SELECT * FROM public.direct_hire_working_sessions
  WHERE id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), current_v4 AS (
  SELECT brief.*
  FROM target JOIN public.direct_hire_first_working_session_briefs AS brief
    ON brief.direct_hire_working_session_id = target.id
   AND brief.current
   AND brief.preparation_contract_version = 'first-working-session-preparation-v4'
), statements AS (
  SELECT statement_value #>> '{}' AS statement_text
  FROM current_v4
  CROSS JOIN LATERAL jsonb_path_query(current_v4.brief, 'strict $.**.statement') AS item(statement_value)
), current_hypotheses AS (
  SELECT hypothesis.*
  FROM target JOIN public.hypotheses AS hypothesis
    ON hypothesis.owner_id = target.owner_id
   AND hypothesis.business_id = target.business_id
   AND hypothesis.business_representation_id = target.business_representation_id
   AND hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
  WHERE NOT EXISTS (SELECT 1 FROM public.hypotheses AS successor
                    WHERE successor.previous_hypothesis_id = hypothesis.id)
), current_hypothesis_status AS (
  SELECT hypothesis.*,
    latest_verification.decision AS owner_decision
  FROM current_hypotheses AS hypothesis
  LEFT JOIN LATERAL (
    SELECT verification.decision
    FROM public.hypothesis_verifications AS verification
    WHERE verification.hypothesis_id = hypothesis.id
    ORDER BY verification.verification_sequence DESC
    LIMIT 1
  ) AS latest_verification ON true
), hypothesis_fingerprint AS (
  SELECT encode(extensions.digest(coalesce(string_agg(
    hypothesis.id::text || ':' || hypothesis.hypothesis_version::text || ':'
      || coalesce(hypothesis.request_trace_id, ''),
    '|' ORDER BY hypothesis.id::text || ':' || hypothesis.hypothesis_version::text
      || ':' || coalesce(hypothesis.request_trace_id, '')
  ), ''), 'sha256'), 'hex') AS fingerprint
  FROM current_hypotheses AS hypothesis
), scoped_evidence AS (
  SELECT evidence.*
  FROM target JOIN public.evidence AS evidence
    ON evidence.business_representation_id = target.business_representation_id
   AND evidence.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
), latest_website_page AS (
  SELECT DISTINCT ON (logical_page_key)
    logical_page_key, source_content_hash, extraction_method_version,
    source_retrieved_at, created_at
  FROM (
    SELECT evidence.*,
      CASE WHEN evidence.registered_public_source_id IS NOT NULL
        THEN 'registered:' || evidence.registered_public_source_id::text
        ELSE 'website:' || coalesce(evidence.canonical_source_url,
          evidence.requested_source_url, evidence.source_authority_key, evidence.id::text)
      END AS logical_page_key
    FROM scoped_evidence AS evidence
    WHERE evidence.source_type = 'public_website'
      AND evidence.source_content_hash IS NOT NULL
  ) AS website_history
  ORDER BY logical_page_key, coalesce(source_retrieved_at, created_at) DESC,
    created_at DESC, source_content_hash DESC
), effective_website_evidence AS (
  SELECT evidence.*
  FROM scoped_evidence AS evidence
  JOIN latest_website_page AS latest
    ON latest.logical_page_key = CASE WHEN evidence.registered_public_source_id IS NOT NULL
      THEN 'registered:' || evidence.registered_public_source_id::text
      ELSE 'website:' || coalesce(evidence.canonical_source_url,
        evidence.requested_source_url, evidence.source_authority_key, evidence.id::text)
    END
   AND latest.source_content_hash = evidence.source_content_hash
   AND latest.extraction_method_version IS NOT DISTINCT FROM evidence.extraction_method_version
   AND latest.source_retrieved_at IS NOT DISTINCT FROM evidence.source_retrieved_at
  WHERE evidence.source_type = 'public_website'
), latest_fixed_induction AS (
  SELECT DISTINCT ON (evidence.direct_hire_onboarding_session_id,
    coalesce(evidence.captured_by_actor, ''), evidence.induction_material_type,
    evidence.induction_material_label) evidence.*
  FROM scoped_evidence AS evidence
  WHERE evidence.source_type = 'direct_hire_induction'
    AND evidence.induction_material_type = 'description'
    AND evidence.induction_material_label IN ('What the business sells', 'Target customer')
  ORDER BY evidence.direct_hire_onboarding_session_id,
    coalesce(evidence.captured_by_actor, ''), evidence.induction_material_type,
    evidence.induction_material_label, evidence.created_at DESC, evidence.id DESC
), effective_evidence AS (
  SELECT website.id FROM effective_website_evidence AS website
  UNION ALL
  SELECT evidence.id
  FROM scoped_evidence AS evidence
  WHERE evidence.source_type <> 'public_website'
    AND NOT (evidence.source_type = 'direct_hire_induction' AND evidence.induction_material_type = 'link')
    AND NOT (evidence.source_type = 'direct_hire_induction'
      AND evidence.induction_material_type = 'description'
      AND evidence.induction_material_label IN ('What the business sells', 'Target customer'))
  UNION ALL
  SELECT fixed.id FROM latest_fixed_induction AS fixed
), final_state AS (
  SELECT count(*) = 1
     AND bool_and(target.status = 'scheduled')
     AND bool_and(target.preparation_status = 'ready')
     AND bool_and(target.preparation_contract_version = 'first-working-session-preparation-v4')
     AND bool_and(target.preparation_snapshot_fingerprint = current_v4.source_snapshot_fingerprint)
     AND bool_and(current_v4.brief->'governance'->>'canonical' = 'false')
     AND bool_and(current_v4.brief->'governance'->>'containsChainOfThought' = 'false') AS ok
  FROM target JOIN current_v4 ON true
), history AS (
  SELECT count(*) FILTER (WHERE current) = 1
     AND count(*) FILTER (WHERE preparation_contract_version = 'first-working-session-preparation-v4' AND current) = 1
     AND count(*) FILTER (WHERE id = '48c5fb80-523b-4d7c-9a66-d103c37ead75'::uuid
                          AND preparation_contract_version = 'first-working-session-preparation-v3' AND NOT current) = 1
     AND count(*) FILTER (WHERE preparation_contract_version = 'first-working-session-preparation-v1' AND NOT current) >= 1 AS ok
  FROM public.direct_hire_first_working_session_briefs
  WHERE direct_hire_working_session_id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), citations AS (
  SELECT count(*) = 1
     AND bool_and(NOT EXISTS (
       SELECT 1 FROM unnest(current_v4.source_evidence_ids) AS supplied(id)
       WHERE NOT EXISTS (SELECT 1 FROM effective_evidence WHERE effective_evidence.id = supplied.id)
     ))
     AND bool_and(NOT EXISTS (
       SELECT 1 FROM unnest(current_v4.source_hypothesis_ids) AS supplied(id)
       WHERE NOT EXISTS (SELECT 1 FROM current_hypotheses WHERE current_hypotheses.id = supplied.id)
     )) AS ok
  FROM current_v4
), quality AS (
  SELECT NOT EXISTS (SELECT 1 FROM statements
                     WHERE statement_text ~ '(^|[^[:alnum:]_])[EH][1-9][0-9]*([^[:alnum:]_]|$)')
     AND (SELECT count(*) FROM current_hypotheses) = 7
     AND NOT EXISTS (
       SELECT 1 FROM current_hypotheses AS hypothesis
       WHERE hypothesis.constitutional_domain = 'authorityBoundaries'
         AND (hypothesis.epistemic_state = 'unknown' OR hypothesis.representation_risk = 'high')
         AND coalesce(jsonb_array_length(current_v4.brief->'authorityGaps'), 0) = 0
     )
     AND (NOT EXISTS (
       SELECT 1 FROM current_hypothesis_status AS hypothesis
       WHERE hypothesis.representation_risk IN ('medium', 'high')
         AND (hypothesis.epistemic_state <> 'supported' OR hypothesis.owner_decision IS DISTINCT FROM 'approved')
     ) OR coalesce(jsonb_array_length(current_v4.brief->'formationPriorities'), 0) BETWEEN 3 AND 7) AS ok
  FROM current_v4
), no_formation AS (
  SELECT count(*) = 1
     AND bool_and(representation.current_version_id IS NULL)
     AND count(formation.id) = 0 AS ok
  FROM target JOIN public.business_representations AS representation
    ON representation.id = target.business_representation_id
   AND representation.business_id = target.business_id
   AND representation.user_id = target.owner_id
  LEFT JOIN public.representation_formation_sessions AS formation
    ON formation.business_representation_id = target.business_representation_id
), fingerprint_trace AS (
  SELECT count(*) = 1
     AND bool_and(current_v4.hypothesis_trace_fingerprint = hypothesis_fingerprint.fingerprint) AS ok
  FROM current_v4 CROSS JOIN hypothesis_fingerprint
)
SELECT 'B_ready_v4_snapshot_and_governance', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM final_state
UNION ALL SELECT 'B_one_current_v4_with_v3_and_v1_history', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM history
UNION ALL SELECT 'B_citations_use_effective_current_lineage', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM citations
UNION ALL SELECT 'B_alias_authority_priority_and_seven_domain_quality', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM quality
UNION ALL SELECT 'B_hypothesis_trace_present', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM fingerprint_trace
UNION ALL SELECT 'B_no_formation_or_canonical_mutation', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM no_formation;

-- Compare these preservation counts and checkpoint to the preflight baseline.
WITH target AS (
  SELECT * FROM public.direct_hire_working_sessions
  WHERE id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
)
SELECT target.preparation_website_persisted_at AS website_checkpoint_at,
       (SELECT count(*) FROM public.evidence AS evidence
        WHERE evidence.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
          AND evidence.business_representation_id = target.business_representation_id) AS evidence_rows,
       (SELECT count(*) FROM public.observations AS observation
        WHERE observation.business_representation_id = target.business_representation_id) AS observation_rows,
       (SELECT count(*) FROM public.hypotheses AS hypothesis
        WHERE hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
          AND hypothesis.business_representation_id = target.business_representation_id) AS hypothesis_rows,
       (SELECT count(*) FROM public.direct_hire_first_working_session_briefs AS brief
        WHERE brief.direct_hire_working_session_id = target.id) AS brief_history_rows,
       (SELECT encode(extensions.digest(
          brief.brief::text || '|' || brief.source_snapshot_fingerprint || '|'
          || brief.hypothesis_trace_fingerprint || '|' || brief.source_evidence_ids::text
          || '|' || brief.source_hypothesis_ids::text,
          'sha256'), 'hex')
        FROM public.direct_hire_first_working_session_briefs AS brief
        WHERE brief.id = '48c5fb80-523b-4d7c-9a66-d103c37ead75'::uuid) AS immutable_v3_brief_digest,
       (SELECT count(*) FROM public.representation_formation_sessions AS formation
        WHERE formation.business_representation_id = target.business_representation_id) AS formation_rows
FROM target;
