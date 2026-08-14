-- READ ONLY. Run after the additive migration and one governed requeue RPC call.

WITH requeue_function AS (
  SELECT procedure.oid, procedure.proowner, procedure.proacl,
         pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
         lower(regexp_replace(pg_get_functiondef(procedure.oid), '\s+', ' ', 'g')) AS definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = to_regprocedure(
    'public.zeya_requeue_first_working_session_preparation_v3(uuid,text,text)'
  )
), function_acl AS (
  SELECT requeue_function.oid,
    coalesce(bool_or(expanded.grantee = 0 AND expanded.privilege_type = 'EXECUTE'), false) AS public_execute
  FROM requeue_function
  LEFT JOIN LATERAL aclexplode(
    coalesce(requeue_function.proacl, acldefault('f', requeue_function.proowner))
  ) AS expanded ON true
  GROUP BY requeue_function.oid
), definition_check AS (
  SELECT identity_arguments = 'p_working_session_id uuid, p_expected_failure_code text, p_requeue_reason_code text'
     AND definition LIKE '%security definer%'
     AND definition LIKE '%for update%'
     AND definition LIKE '%corrected_application_defect_requeue%'
     AND definition LIKE '%preparation_attempt_count <> 3%'
     AND definition LIKE '%preparation_contract_version is distinct from ''first-working-session-preparation-v3''%'
     AND definition LIKE '%representation.current_version_id is null%'
     AND definition LIKE '%insert into public.direct_hire_first_working_session_preparation_recoveries%'
     AND definition LIKE '%update public.direct_hire_working_sessions%'
     AND strpos(definition, 'insert into public.direct_hire_first_working_session_preparation_recoveries')
         < strpos(definition, 'update public.direct_hire_working_sessions')
     AND definition NOT LIKE '%update public.evidence%'
     AND definition NOT LIKE '%update public.observations%'
     AND definition NOT LIKE '%update public.hypotheses%'
     AND definition NOT LIKE '%update public.direct_hire_first_working_session_briefs%'
     AND definition NOT LIKE '%representation_formation_sessions%' AS ok
  FROM requeue_function
), acl_check AS (
  SELECT NOT function_acl.public_execute
     AND NOT coalesce(has_function_privilege(to_regrole('anon'), requeue_function.oid, 'EXECUTE'), false)
     AND NOT coalesce(has_function_privilege(to_regrole('authenticated'), requeue_function.oid, 'EXECUTE'), false)
     AND coalesce(has_function_privilege(to_regrole('service_role'), requeue_function.oid, 'EXECUTE'), false) AS ok
  FROM requeue_function JOIN function_acl USING (oid)
), ledger_constraints AS (
  SELECT count(*) FILTER (
      WHERE pg_get_constraintdef(constraint_row.oid, true) LIKE '%corrected_application_defect_requeue%'
    ) = 2
    AND count(*) FILTER (
      WHERE constraint_row.contype = 'u'
        AND array_length(constraint_row.conkey, 1) = 4
    ) = 1 AS ok
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
), target_state AS (
  SELECT count(*) = 1
     AND bool_and(working_session.status = 'scheduled')
     AND bool_and(working_session.preparation_status = 'pending')
     AND bool_and(working_session.preparation_attempt_count = 0)
     AND bool_and(working_session.preparation_contract_version = 'first-working-session-preparation-v3')
     AND bool_and(working_session.preparation_failure_code IS NULL)
     AND bool_and(working_session.preparation_lease_id IS NULL)
     AND bool_and(working_session.preparation_lease_expires_at IS NULL)
     AND bool_and(working_session.preparation_snapshot_fingerprint IS NULL)
     AND bool_and(working_session.preparation_website_persisted_at IS NOT NULL) AS ok
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), audit_event AS (
  SELECT count(*) = 1
     AND bool_and(recovery.previous_attempt_count = 3)
     AND bool_and(recovery.previous_failure_code = 'brief_provider_request_failed')
     AND bool_and(recovery.recovered_by_role IN ('service_role', 'postgres')) AS ok
  FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
  WHERE recovery.direct_hire_working_session_id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
    AND recovery.exhausted_contract_version = 'first-working-session-preparation-v3'
    AND recovery.recovery_contract_version = 'first-working-session-preparation-v3'
    AND recovery.recovery_reason_code = 'corrected_application_defect_requeue'
), lineage_still_safe AS (
  SELECT count(*) = 1
     AND bool_and(onboarding.owner_id = working_session.owner_id)
     AND bool_and(onboarding.business_id = working_session.business_id)
     AND bool_and(onboarding.business_representation_id = working_session.business_representation_id)
     AND bool_and(onboarding.onboarding_state = 'employment_accepted')
     AND bool_and(onboarding.induction_state = 'preparation_pending')
     AND bool_and(representation.current_version_id IS NULL) AS ok
  FROM public.direct_hire_working_sessions AS working_session
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = working_session.direct_hire_onboarding_session_id
  JOIN public.business_representations AS representation
    ON representation.id = working_session.business_representation_id
   AND representation.business_id = working_session.business_id
   AND representation.user_id = working_session.owner_id
  WHERE working_session.id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
)
SELECT 'same_contract_requeue_definition', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM definition_check
UNION ALL SELECT 'service_role_only_acl', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM acl_check
UNION ALL SELECT 'ledger_supports_narrow_same_contract_event', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM ledger_constraints
UNION ALL SELECT 'target_pending_with_fresh_budget', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM target_state
UNION ALL SELECT 'exactly_one_immutable_audit_event', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM audit_event
UNION ALL SELECT 'lineage_and_canonical_guard_preserved', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM lineage_still_safe;

-- Preserved artifacts for comparison with the preflight baseline.
WITH target AS (
  SELECT * FROM public.direct_hire_working_sessions
  WHERE id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
)
SELECT target.id AS working_session_id,
       target.preparation_website_persisted_at,
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
       (SELECT count(*) FROM public.representation_formation_sessions AS formation
         WHERE formation.initiated_from_id = target.direct_hire_onboarding_session_id) AS formation_rows
FROM target;
