-- P2.3C PREFLIGHT — READ ONLY. Does not resume or mutate the paused conversation.
WITH qa_owner AS (
  SELECT id FROM auth.users WHERE lower(email)=lower('mdubreu@gmail.com')
), lineage AS (
  SELECT f.id formation_session_id,h.id handoff_id,r.id run_id,r.status run_status,w.status working_session_status,
    w.preparation_contract_version,br.current_version_id,
    (SELECT count(*) FROM public.representation_proposals p WHERE p.formation_session_id=f.id) proposal_count,
    (SELECT count(*) FROM public.direct_hire_formation_conversation_turns t WHERE t.run_id=r.id) turn_count,
    (SELECT count(*) FROM public.direct_hire_formation_agenda_resolution_events e WHERE e.run_id=r.id) resolution_count,
    (SELECT count(*) FROM public.direct_hire_formation_decisions d WHERE d.run_id=r.id) decision_count
  FROM qa_owner owner_row
  JOIN public.representation_formation_sessions f ON f.owner_id=owner_row.id
  JOIN public.direct_hire_first_working_session_formation_handoffs h ON h.formation_session_id=f.id
  JOIN public.direct_hire_formation_conversation_runs r ON r.formation_session_id=f.id AND r.formation_handoff_id=h.id
  JOIN public.direct_hire_working_sessions w ON w.id=r.direct_hire_working_session_id
  JOIN public.business_representations br ON br.id=r.business_representation_id
  WHERE f.id='667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid
), objects AS (
  SELECT to_regclass('public.direct_hire_formation_outcome_packages') IS NULL AS migration_not_applied
)
SELECT 'exact QA Auth identity' check_name,(SELECT count(*) FROM qa_owner)::text actual,'1' expected,(SELECT count(*) FROM qa_owner)=1 pass
UNION ALL SELECT 'exact paused P2.3B lineage',count(*)::text,'1',count(*)=1 FROM lineage WHERE run_status='paused' AND preparation_contract_version='first-working-session-preparation-v4'
UNION ALL SELECT 'proven existing effects',jsonb_build_object('turns',turn_count,'resolutions',resolution_count,'decisions',decision_count)::text,'turns=3, resolutions=1, decisions>=1',turn_count=3 AND resolution_count=1 AND decision_count>=1 FROM lineage
UNION ALL SELECT 'no proposal or canonical Version',jsonb_build_object('proposals',proposal_count,'currentVersionId',current_version_id)::text,'proposals=0, currentVersionId=null',proposal_count=0 AND current_version_id IS NULL FROM lineage
UNION ALL SELECT 'P2.3C is not yet applied',migration_not_applied::text,'true',migration_not_applied FROM objects;
