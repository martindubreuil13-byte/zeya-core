-- READ ONLY. Run before 20260814010000_direct_hire_first_working_session_v4_alias_free_successor.sql.

WITH target AS (
  SELECT working_session.*
  FROM public.direct_hire_working_sessions AS working_session
  WHERE working_session.id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
), current_v3_brief AS (
  SELECT brief.*
  FROM target
  JOIN public.direct_hire_first_working_session_briefs AS brief
    ON brief.direct_hire_working_session_id = target.id
   AND brief.current
   AND brief.preparation_contract_version = 'first-working-session-preparation-v3'
), target_state AS (
  SELECT count(*) = 1
     AND bool_and(target.status = 'scheduled')
     AND bool_and(target.preparation_status = 'ready')
     AND bool_and(target.preparation_contract_version = 'first-working-session-preparation-v3')
     AND bool_and(target.preparation_lease_id IS NULL)
     AND bool_and(target.preparation_lease_expires_at IS NULL)
     AND bool_and(target.preparation_snapshot_fingerprint IS NOT NULL)
     AND bool_and(target.preparation_website_persisted_at IS NOT NULL) AS ok
  FROM target
), exact_brief AS (
  SELECT count(*) = 1
     AND bool_and(current_v3_brief.id = '48c5fb80-523b-4d7c-9a66-d103c37ead75'::uuid)
     AND bool_and(current_v3_brief.source_snapshot_fingerprint = target.preparation_snapshot_fingerprint)
     AS ok
  FROM target LEFT JOIN current_v3_brief ON true
), lineage AS (
  SELECT count(*) = 1
     AND bool_and(onboarding.owner_id = target.owner_id)
     AND bool_and(onboarding.business_id = target.business_id)
     AND bool_and(onboarding.business_representation_id = target.business_representation_id)
     AND bool_and(onboarding.onboarding_state = 'employment_accepted')
     AND bool_and(onboarding.induction_state = 'preparation_pending')
     AND bool_and(business.user_id = target.owner_id)
     AND bool_and(representation.business_id = target.business_id)
     AND bool_and(representation.user_id = target.owner_id)
     AND bool_and(representation.current_version_id IS NULL) AS ok
  FROM target
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = target.direct_hire_onboarding_session_id
  JOIN public.businesses AS business ON business.id = target.business_id
  JOIN public.business_representations AS representation
    ON representation.id = target.business_representation_id
), no_formation AS (
  SELECT count(formation.id) = 0 AS ok
  FROM target
  LEFT JOIN public.representation_formation_sessions AS formation
    ON formation.business_representation_id = target.business_representation_id
), upgrade_absent AS (
  SELECT to_regclass('public.direct_hire_first_working_session_preparation_regenerations') IS NULL
     AND to_regprocedure('public.zeya_transition_first_working_session_preparation_v3_to_v4(uuid,uuid,text)') IS NULL
     AND to_regprocedure('public.zeya_reject_v4_first_working_session_brief_aliases()') IS NULL AS ok
), prior_event_absent AS (
  SELECT CASE
    WHEN to_regclass('public.direct_hire_first_working_session_preparation_regenerations') IS NULL THEN true
    ELSE false
  END AS ok
)
SELECT 'exact_ready_v3_target', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM target_state
UNION ALL SELECT 'exactly_one_exact_current_v3_brief', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM exact_brief
UNION ALL SELECT 'exact_owner_business_representation_onboarding_lineage', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM lineage
UNION ALL SELECT 'canonical_representation_has_no_formation', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM no_formation
UNION ALL SELECT 'v4_upgrade_objects_absent', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM upgrade_absent
UNION ALL SELECT 'no_prior_v3_to_v4_event', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM prior_event_absent;

-- Preservation baseline: save this single row for comparison with both postcheck checkpoints.
WITH target AS (
  SELECT * FROM public.direct_hire_working_sessions
  WHERE id = '715f4971-4d3f-4f53-9b89-a9dd703349d8'::uuid
)
SELECT target.id AS working_session_id,
       target.preparation_attempt_count AS prior_attempt_count,
       target.preparation_snapshot_fingerprint AS prior_snapshot_fingerprint,
       target.preparation_website_persisted_at AS website_checkpoint_at,
       (SELECT count(*) FROM public.evidence AS evidence
         WHERE evidence.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
           AND evidence.business_representation_id = target.business_representation_id) AS evidence_rows,
       (SELECT count(*) FROM public.observations AS observation
         WHERE observation.business_representation_id = target.business_representation_id) AS observation_rows,
       (SELECT count(*) FROM public.hypotheses AS hypothesis
         WHERE hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
           AND hypothesis.business_representation_id = target.business_representation_id) AS hypothesis_rows,
       (SELECT count(*) FROM public.hypotheses AS hypothesis
         WHERE hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
           AND hypothesis.business_representation_id = target.business_representation_id
           AND NOT EXISTS (SELECT 1 FROM public.hypotheses AS successor
                           WHERE successor.previous_hypothesis_id = hypothesis.id)) AS current_hypothesis_rows,
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
