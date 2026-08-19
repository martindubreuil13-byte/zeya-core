-- READ ONLY. Run after first preparation and again after exact operation replay.
WITH target AS (SELECT '42fd6467-ffe0-49e2-991a-fb503393b657'::uuid AS mission_id)
SELECT mission.id AS mission_id,mission.status AS mission_status,lead.status AS lead_status,
  dispatch.dispatch_id,dispatch.status AS dispatch_status,dispatch.execution_allowed,
  dispatch.execution_context_id,dispatch.representation_version_id,dispatch.mandate_outcome_package_id,dispatch.lead_id,
  dispatch.worker_role,dispatch.channel,brief.id AS worker_brief_id,brief.execution_allowed AS brief_execution_allowed,
  brief.brief_payload->'constraints' AS brief_constraints,
  (dispatch.source_fingerprint=brief.source_fingerprint) AS source_fingerprints_match,
  (SELECT count(*) FROM public.dispatches candidate WHERE candidate.mission_id=mission.id) AS dispatch_count,
  (SELECT count(*) FROM public.worker_briefs candidate WHERE candidate.operating_mission_id=mission.id) AS worker_brief_count,
  (SELECT count(*) FROM public.dispatch_events event WHERE event.dispatch_id=dispatch.dispatch_id) AS dispatch_event_count,
  (SELECT count(*) FROM public.voice_conversation_outputs output WHERE output.mission_id=mission.id::text) AS voice_output_count,
  (SELECT count(*) FROM public.mission_execution_outcomes outcome WHERE outcome.mission_id=mission.id) AS execution_outcome_count,
  dispatch.call_outcome_id
FROM target
JOIN public.operating_missions mission ON mission.id=target.mission_id
JOIN public.mission_leads lead ON lead.id=mission.lead_id
JOIN public.dispatches dispatch ON dispatch.mission_id=mission.id
JOIN public.worker_briefs brief ON brief.id=dispatch.worker_brief_id;
