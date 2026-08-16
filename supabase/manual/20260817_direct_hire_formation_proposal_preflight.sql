-- READ ONLY. P2.3D exact Preview lineage preflight; do not execute automatically.
WITH target AS (SELECT '667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid formation_id), state AS (
 SELECT f.id,r.current_version_id,run.status run_status,run.completion_readiness_result->>'ready' ready,w.status working_status,
  count(DISTINCT o.id) outcomes,count(DISTINCT p.id) proposals,count(DISTINCT v.id) versions,count(DISTINCT voice.id) voice_outputs,
  bool_and(o.noncanonical AND public.zeya_direct_hire_formation_outcome_is_current(f.owner_id,o.id)) current_outcome
 FROM target t JOIN public.representation_formation_sessions f ON f.id=t.formation_id
 JOIN public.business_representations r ON r.id=f.business_representation_id
 JOIN public.direct_hire_formation_conversation_runs run ON run.formation_session_id=f.id
 JOIN public.direct_hire_working_sessions w ON w.id=run.direct_hire_working_session_id
 LEFT JOIN public.direct_hire_formation_outcome_packages o ON o.conversation_run_id=run.id
 LEFT JOIN public.representation_proposals p ON p.formation_session_id=f.id
 LEFT JOIN public.representation_versions v ON v.business_representation_id=r.id
 LEFT JOIN public.voice_conversation_outputs voice ON voice.business_representation_id=r.id
 GROUP BY f.id,r.current_version_id,run.status,run.completion_readiness_result,w.status
) SELECT *,run_status='completed' AND working_status='completed' AND ready='true' AND outcomes=1 AND current_outcome
 AND proposals=0 AND versions=0 AND current_version_id IS NULL AND voice_outputs=0 AS pass FROM state;
