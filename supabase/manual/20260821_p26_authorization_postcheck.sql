-- READ ONLY. Run after Stage A create and exact replay; must prove authorization-only state.
-- All counts must remain zero; authorization must be pristine; dispatch/mission/lead must be unchanged.
WITH target AS (SELECT 'p25_dispatch_4c1cb79b0e2644c8970192131646f4e0'::text dispatch_id)
SELECT a.id,a.dispatch_id,a.worker_brief_id,a.mission_id,a.status,a.consumed_at,
  (SELECT d.status FROM public.dispatches d WHERE d.dispatch_id=a.dispatch_id) dispatch_status,
  (SELECT d.execution_allowed FROM public.dispatches d WHERE d.dispatch_id=a.dispatch_id) dispatch_execution_allowed,
  (SELECT b.execution_allowed FROM public.worker_briefs b WHERE b.id=a.worker_brief_id) brief_execution_allowed,
  (SELECT m.status FROM public.operating_missions m WHERE m.id=a.mission_id) mission_status,
  (SELECT l.status FROM public.mission_leads l WHERE l.id=a.lead_id) lead_status,
  public.zeya_p26_dispatch_is_current(a.id::uuid,a.dispatch_id) AS INVALID_USAGE_ERROR,
  (SELECT count(*) FROM public.governed_execution_authorizations x WHERE x.dispatch_id=a.dispatch_id) authorization_count,
  (SELECT count(*) FROM public.governed_execution_attempts x WHERE x.authorization_id=a.id) attempt_count,
  (SELECT count(*) FROM public.dispatch_events x WHERE x.dispatch_id=a.dispatch_id) dispatch_event_count,
  (SELECT count(*) FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=a.worker_brief_id) mapping_count,
  (SELECT count(*) FROM public.voice_conversation_outputs x WHERE x.mission_id=a.mission_id::text) voice_output_count,
  (SELECT count(*) FROM public.mission_execution_outcomes x WHERE x.mission_id=a.mission_id) execution_outcome_count,
  (SELECT d.call_outcome_id FROM public.dispatches d WHERE d.dispatch_id=a.dispatch_id) call_outcome_id
FROM target
JOIN public.governed_execution_authorizations a ON a.dispatch_id=target.dispatch_id
WHERE a.status='authorized' AND a.consumed_at IS NULL;
