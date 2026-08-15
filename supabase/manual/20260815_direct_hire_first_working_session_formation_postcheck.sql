-- P2.3A READ ONLY postcheck. Run after the migration and one exact handoff call.
WITH qa_identity AS (
  SELECT id AS owner_id FROM auth.users WHERE lower(email) = lower('mdubreu@gmail.com')
), target AS (
  SELECT working_session.*
  FROM qa_identity JOIN public.direct_hire_working_sessions AS working_session
    ON working_session.owner_id = qa_identity.owner_id
  WHERE working_session.status = 'scheduled'
    AND working_session.preparation_status = 'ready'
    AND working_session.preparation_contract_version = 'first-working-session-preparation-v4'
), handoff AS (
  SELECT handoff.*
  FROM target JOIN public.direct_hire_first_working_session_formation_handoffs AS handoff
    ON handoff.direct_hire_working_session_id = target.id
), formation AS (
  SELECT formation.*
  FROM handoff JOIN public.representation_formation_sessions AS formation
    ON formation.id = handoff.formation_session_id
), agenda AS (
  SELECT agenda.*
  FROM handoff JOIN public.direct_hire_first_working_session_formation_agenda_items AS agenda
    ON agenda.formation_handoff_id = handoff.id
), integrity AS (
  SELECT (SELECT count(*) FROM qa_identity) = 1
     AND (SELECT count(*) FROM target) = 1
     AND (SELECT count(*) FROM handoff) = 1
     AND (SELECT count(*) FROM formation) = 1
     AND bool_and(formation.status = 'initiated')
     AND bool_and(formation.initiated_from = 'direct_hire_onboarding')
     AND bool_and(formation.initiated_from_id = target.direct_hire_onboarding_session_id)
     AND bool_and(target.formation_session_id = formation.id)
     AND bool_and(onboarding.formation_session_id = formation.id)
     AND bool_and(handoff.direct_hire_onboarding_session_id = onboarding.id)
     AND bool_and(handoff.business_representation_id = target.business_representation_id)
     AND bool_and(handoff.preparation_snapshot_fingerprint = target.preparation_snapshot_fingerprint)
     AND bool_and(handoff.preparation_contract_version = 'first-working-session-preparation-v4') AS ok
  FROM target JOIN handoff ON true JOIN formation ON true
  JOIN public.direct_hire_onboarding_sessions AS onboarding
    ON onboarding.id = target.direct_hire_onboarding_session_id
), agenda_integrity AS (
  SELECT count(*) BETWEEN 1 AND 24
     AND min(rank) = 1 AND max(rank) = count(*)
     AND count(DISTINCT rank) = count(*)
     AND count(DISTINCT agenda_item_id) = count(*)
     AND bool_and(resolution_status = 'unresolved')
     AND bool_and(created_from_snapshot_fingerprint = handoff.preparation_snapshot_fingerprint)
     AND count(*) FILTER (WHERE category = 'authority' AND blocking) = 1 AS ok
  FROM agenda CROSS JOIN handoff
), immutable_objects AS (
  SELECT count(*) FILTER (WHERE trigger.tgname = 'direct_hire_formation_handoffs_immutable') = 1
     AND count(*) FILTER (WHERE trigger.tgname = 'direct_hire_formation_agenda_immutable') = 1 AS ok
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid IN (
    'public.direct_hire_first_working_session_formation_handoffs'::regclass,
    'public.direct_hire_first_working_session_formation_agenda_items'::regclass
  ) AND NOT trigger.tgisinternal
), untouched_boundaries AS (
  SELECT count(*) = 1
     AND bool_and(representation.current_version_id IS NULL)
     AND bool_and(formation.first_working_conversation_id IS NULL)
     AND bool_and(NOT EXISTS (
       SELECT 1 FROM public.representation_versions AS version
       WHERE version.business_representation_id = target.business_representation_id
         AND version.created_at >= handoff.handed_off_at
     ))
     AND bool_and(NOT EXISTS (
       SELECT 1 FROM public.representation_proposals AS proposal
       WHERE proposal.business_representation_id = target.business_representation_id
         AND proposal.created_at >= handoff.handed_off_at
     ))
     AND bool_and(NOT EXISTS (
       SELECT 1 FROM public.voice_conversation_outputs AS output
       WHERE output.business_representation_id = target.business_representation_id
         AND output.created_at >= handoff.handed_off_at
     )) AS ok
  FROM target JOIN handoff ON true JOIN formation ON true
  JOIN public.business_representations AS representation
    ON representation.id = target.business_representation_id
)
SELECT 'one_exact_linked_initiated_formation', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict FROM integrity
UNION ALL SELECT 'immutable_deterministic_agenda', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM agenda_integrity
UNION ALL SELECT 'handoff_and_agenda_update_delete_guarded', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM immutable_objects
UNION ALL SELECT 'no_canonical_proposal_or_voice_mutation', ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM untouched_boundaries;

-- Compare counts with the preflight baseline. Only Formation, handoff and agenda rows should be new.
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
