-- P2.3B PRELIGHT — READ ONLY. Run before the migration in a service-role SQL session.
WITH objects AS (
  SELECT
    to_regclass('public.direct_hire_first_working_session_formation_handoffs') IS NOT NULL AS handoff_exists,
    to_regclass('public.direct_hire_first_working_session_formation_agenda_items') IS NOT NULL AS agenda_exists,
    to_regclass('public.direct_hire_formation_conversation_runs') IS NULL AS p23b_not_applied
), eligible AS (
  SELECT count(*) AS exact_ready_handoffs
  FROM public.direct_hire_first_working_session_formation_handoffs h
  JOIN public.representation_formation_sessions f ON f.id=h.formation_session_id
  JOIN public.direct_hire_working_sessions w ON w.id=h.direct_hire_working_session_id
  JOIN public.business_representations r ON r.id=h.business_representation_id
  WHERE f.status='initiated' AND w.status='scheduled' AND w.preparation_status='ready'
    AND w.preparation_contract_version='first-working-session-preparation-v4'
    AND w.preparation_snapshot_fingerprint=h.preparation_snapshot_fingerprint
    AND r.current_version_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.representation_proposals p WHERE p.formation_session_id=f.id)
), agenda AS (
  SELECT count(*) AS item_count,count(*) FILTER(WHERE blocking) AS blocking_count,
    bool_and(resolution_status='unresolved') AS immutable_unresolved
  FROM public.direct_hire_first_working_session_formation_agenda_items
)
SELECT 'P2.3A prerequisite objects' AS check_name,(handoff_exists AND agenda_exists)::text AS actual,'true' AS expected,
  handoff_exists AND agenda_exists AS pass FROM objects
UNION ALL SELECT 'P2.3B is additive',p23b_not_applied::text,'true',p23b_not_applied FROM objects
UNION ALL SELECT 'exact eligible ready handoff count',exact_ready_handoffs::text,'1',exact_ready_handoffs=1 FROM eligible
UNION ALL SELECT 'agenda is present and frozen',jsonb_build_object('items',item_count,'blocking',blocking_count,'allUnresolved',immutable_unresolved)::text,'items > 0; allUnresolved=true',item_count>0 AND immutable_unresolved FROM agenda;
