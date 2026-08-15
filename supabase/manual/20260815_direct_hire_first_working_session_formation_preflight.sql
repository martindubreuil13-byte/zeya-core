-- P2.3A READ ONLY preflight. Run before the additive P2.3A migration.
WITH qa_identity AS (
  SELECT id AS owner_id FROM auth.users WHERE lower(email) = lower('mdubreu@gmail.com')
), candidates AS (
  SELECT working_session.*
  FROM qa_identity
  JOIN public.direct_hire_working_sessions AS working_session
    ON working_session.owner_id = qa_identity.owner_id
  WHERE working_session.status = 'scheduled'
    AND working_session.preparation_status = 'ready'
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v4'
), target AS (
  SELECT * FROM candidates WHERE (SELECT count(*) FROM candidates) = 1
), current_brief AS (
  SELECT brief.*
  FROM target JOIN public.direct_hire_first_working_session_briefs AS brief
    ON brief.direct_hire_working_session_id = target.id
   AND brief.current
   AND brief.preparation_contract_version = 'first-working-session-preparation-v4'
), current_hypotheses AS (
  SELECT hypothesis.*
  FROM target JOIN public.hypotheses AS hypothesis
    ON hypothesis.owner_id = target.owner_id
   AND hypothesis.business_id = target.business_id
   AND hypothesis.business_representation_id = target.business_representation_id
   AND hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id
  WHERE NOT EXISTS (SELECT 1 FROM public.hypotheses AS successor
                    WHERE successor.previous_hypothesis_id = hypothesis.id)
), hypothesis_trace AS (
  SELECT count(*) AS hypothesis_count,
    count(DISTINCT constitutional_domain) AS domain_count,
    encode(extensions.digest(coalesce(string_agg(
      id::text || ':' || hypothesis_version::text || ':' || coalesce(request_trace_id, ''),
      '|' ORDER BY id::text || ':' || hypothesis_version::text || ':' || coalesce(request_trace_id, '')
    ), ''), 'sha256'), 'hex') AS fingerprint
  FROM current_hypotheses
), eligibility AS (
  SELECT (SELECT count(*) FROM qa_identity) = 1
     AND (SELECT count(*) FROM target) = 1
     AND (SELECT count(*) FROM current_brief) = 1
     AND bool_and(target.preparation_snapshot_fingerprint = current_brief.source_snapshot_fingerprint)
     AND bool_and(current_brief.hypothesis_trace_fingerprint = hypothesis_trace.fingerprint)
     AND bool_and(hypothesis_trace.hypothesis_count = 7 AND hypothesis_trace.domain_count = 7)
     AND bool_and(onboarding.onboarding_state = 'employment_accepted')
     AND bool_and(onboarding.induction_state = 'preparation_pending')
     AND bool_and(onboarding.owner_id = target.owner_id)
     AND bool_and(onboarding.business_id = target.business_id)
     AND bool_and(onboarding.business_representation_id = target.business_representation_id)
     AND bool_and(representation.user_id = target.owner_id)
     AND bool_and(representation.business_id = target.business_id)
     AND bool_and(representation.current_version_id IS NULL)
     AND bool_and(target.formation_session_id IS NULL)
     AND bool_and(onboarding.formation_session_id IS NULL)
     AND count(formation.id) = 0 AS ok
  FROM target
  JOIN current_brief ON true
  CROSS JOIN hypothesis_trace
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = target.direct_hire_onboarding_session_id
  JOIN public.business_representations AS representation
    ON representation.id = target.business_representation_id
  LEFT JOIN public.representation_formation_sessions AS formation
    ON formation.business_representation_id = target.business_representation_id
), objects_absent AS (
  SELECT to_regclass('public.direct_hire_first_working_session_formation_handoffs') IS NULL
     AND to_regclass('public.direct_hire_first_working_session_formation_agenda_items') IS NULL
     AND to_regprocedure('public.zeya_initiate_direct_hire_first_working_session_formation(uuid,uuid,uuid,text,text,jsonb)') IS NULL AS ok
)
SELECT 'exact_ready_v4_lineage', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM eligibility
UNION ALL SELECT 'p2_3a_objects_absent', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM objects_absent;

-- Preservation baseline for comparison with the postcheck.
WITH target AS (
  SELECT working_session.*
  FROM auth.users AS owner
  JOIN public.direct_hire_working_sessions AS working_session ON working_session.owner_id = owner.id
  WHERE lower(owner.email) = lower('mdubreu@gmail.com')
    AND working_session.status = 'scheduled'
    AND working_session.preparation_status = 'ready'
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v4'
)
SELECT target.id AS working_session_id,
  target.preparation_snapshot_fingerprint,
  target.preparation_website_persisted_at,
  (SELECT count(*) FROM public.evidence AS evidence
   WHERE evidence.business_representation_id = target.business_representation_id
     AND evidence.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id) AS evidence_rows,
  (SELECT count(*) FROM public.observations AS observation
   WHERE observation.business_representation_id = target.business_representation_id) AS observation_rows,
  (SELECT count(*) FROM public.hypotheses AS hypothesis
   WHERE hypothesis.business_representation_id = target.business_representation_id
     AND hypothesis.direct_hire_onboarding_session_id = target.direct_hire_onboarding_session_id) AS hypothesis_rows,
  (SELECT count(*) FROM public.direct_hire_first_working_session_briefs AS brief
   WHERE brief.direct_hire_working_session_id = target.id) AS brief_rows,
  (SELECT count(*) FROM public.representation_proposals AS proposal
   WHERE proposal.business_representation_id = target.business_representation_id) AS proposal_rows,
  (SELECT count(*) FROM public.representation_versions AS version
   WHERE version.business_representation_id = target.business_representation_id) AS version_rows,
  (SELECT count(*) FROM public.voice_conversation_outputs AS output
   WHERE output.business_representation_id = target.business_representation_id) AS voice_output_rows
FROM target;
