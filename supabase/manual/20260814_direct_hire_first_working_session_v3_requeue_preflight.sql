-- READ ONLY. Run before 20260814000000_direct_hire_first_working_session_v3_requeue.sql.

SELECT session_user::text AS database_session_role,
       auth.role() AS jwt_role,
       CASE WHEN auth.role() = 'service_role'
                  OR session_user::text IN ('postgres', 'service_role')
            THEN 'PASS' ELSE 'FAIL' END AS privileged_execution_context;

WITH target AS (
  SELECT working_session.*
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), eligibility AS (
  SELECT count(*) = 1
     AND bool_and(target.status = 'scheduled')
     AND bool_and(target.preparation_status = 'failed')
     AND bool_and(target.preparation_attempt_count = 3)
     AND bool_and(target.preparation_contract_version = 'first-working-session-preparation-v3')
     AND bool_and(target.preparation_failure_code = 'brief_provider_request_failed')
     AND bool_and(target.preparation_lease_id IS NULL)
     AND bool_and(target.preparation_lease_expires_at IS NULL)
     AND bool_and(target.preparation_snapshot_fingerprint IS NULL)
     AND bool_and(target.preparation_website_persisted_at IS NOT NULL) AS ok
  FROM target
), lineage AS (
  SELECT count(*) = 1
     AND bool_and(onboarding.owner_id = target.owner_id)
     AND bool_and(onboarding.business_id = target.business_id)
     AND bool_and(onboarding.business_representation_id = target.business_representation_id)
     AND bool_and(onboarding.onboarding_state = 'employment_accepted')
     AND bool_and(onboarding.induction_state = 'preparation_pending')
     AND bool_and(representation.business_id = target.business_id)
     AND bool_and(representation.user_id = target.owner_id)
     AND bool_and(representation.current_version_id IS NULL) AS ok
  FROM target
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = target.direct_hire_onboarding_session_id
  JOIN public.business_representations AS representation
    ON representation.id = target.business_representation_id
), predecessor_ledger AS (
  SELECT to_regclass('public.direct_hire_first_working_session_preparation_recoveries') IS NOT NULL
     AND to_regprocedure('public.zeya_recover_first_working_session_preparation(uuid,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.zeya_prevent_first_working_session_preparation_recovery_modification()') IS NOT NULL
     AND to_regprocedure('public.zeya_requeue_first_working_session_preparation_v3(uuid,text,text)') IS NULL AS ok
), ledger_shape AS (
  SELECT count(*) FILTER (
      WHERE constraint_row.contype = 'c'
        AND pg_get_constraintdef(constraint_row.oid, true) LIKE '%recovery_contract_version%exhausted_contract_version%'
    ) = 1
    AND count(*) FILTER (
      WHERE constraint_row.contype = 'u'
    ) = 1 AS ok
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.direct_hire_first_working_session_preparation_recoveries'::regclass
), prior_event AS (
  SELECT count(*) = 0 AS ok
  FROM public.direct_hire_first_working_session_preparation_recoveries AS recovery
  WHERE recovery.direct_hire_working_session_id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
    AND recovery.exhausted_contract_version = 'first-working-session-preparation-v3'
    AND recovery.recovery_contract_version = 'first-working-session-preparation-v3'
    AND recovery.recovery_reason_code = 'corrected_application_defect_requeue'
)
SELECT 'exact_exhausted_v3_target', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM eligibility
UNION ALL SELECT 'exact_owner_business_representation_lineage', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM lineage
UNION ALL SELECT 'recovery_predecessor_present', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM predecessor_ledger
UNION ALL SELECT 'ledger_requires_narrow_generalization', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM ledger_shape
UNION ALL SELECT 'same_contract_requeue_not_previously_recorded', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM prior_event;

-- Preservation baseline for human comparison with the postcheck.
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
