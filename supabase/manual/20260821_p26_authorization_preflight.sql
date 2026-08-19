-- READ ONLY. Stage A preflight; no provider execution.
WITH target AS (SELECT 'p25_dispatch_4c1cb79b0e2644c8970192131646f4e0'::text dispatch_id)
SELECT d.dispatch_id,d.status,d.execution_allowed,d.worker_brief_id,d.mission_id,d.execution_context_id,
  d.representation_version_id,d.mandate_outcome_package_id,d.lead_id,b.execution_allowed AS brief_execution_allowed,
  m.status AS mission_status,l.status AS lead_status,public.zeya_p26_dispatch_is_current(d.owner_id,d.dispatch_id) AS lineage_current,
  (SELECT count(*) FROM public.governed_execution_authorizations a WHERE a.dispatch_id=d.dispatch_id) authorization_count,
  (SELECT count(*) FROM public.governed_execution_attempts e WHERE e.dispatch_id=d.dispatch_id) attempt_count,
  (SELECT count(*) FROM public.dispatch_events e WHERE e.dispatch_id=d.dispatch_id) dispatch_event_count,
  (SELECT count(*) FROM public.brief_conversation_mappings x WHERE x.worker_brief_id=d.worker_brief_id) mapping_count,
  (SELECT count(*) FROM public.voice_conversation_outputs v WHERE v.mission_id=d.mission_id::text) voice_output_count,
  (SELECT count(*) FROM public.mission_execution_outcomes o WHERE o.mission_id=d.mission_id) execution_outcome_count,d.call_outcome_id
FROM target JOIN public.dispatches d ON d.dispatch_id=target.dispatch_id
JOIN public.worker_briefs b ON b.id=d.worker_brief_id JOIN public.operating_missions m ON m.id=d.mission_id JOIN public.mission_leads l ON l.id=d.lead_id;
