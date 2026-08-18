-- READ ONLY. Exact Preview target preflight; this file never approves or mutates.
WITH target AS (
  SELECT '667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid session_id,
         '132de1c1-b02d-4c04-80cd-336d4eb37667'::uuid proposal_id
), proposal AS (
  SELECT p.* FROM public.representation_proposals p JOIN target t ON t.proposal_id=p.id
)
SELECT p.id,p.status,p.proposal_contract_version,p.canonicalization_intent,
  p.base_representation_version_id,p.source_state_fingerprint,
  p.proposed_changes->'elementUpdates' AS element_updates,
  r.current_version_id,
  (SELECT count(*) FROM public.representation_versions v WHERE v.business_representation_id=r.id) AS version_count,
  (SELECT count(*) FROM public.approval_decisions a WHERE a.representation_proposal_id=p.id) AS approval_count,
  f.status AS formation_status,o.id AS outcome_id,o.noncanonical,
  public.zeya_direct_hire_formation_outcome_is_current(r.user_id,o.id) AS outcome_current,
  run.completion_readiness_result->>'ready' AS outcome_ready,
  (SELECT jsonb_agg(jsonb_build_object('id',old.id,'status',old.status,'contract',old.proposal_contract_version))
    FROM public.representation_proposals old WHERE old.source_formation_outcome_package_id=p.source_formation_outcome_package_id AND old.id<>p.id) AS predecessors,
  (SELECT count(*) FROM public.voice_conversation_outputs voice WHERE voice.business_representation_id=r.id) AS voice_output_count
FROM proposal p
JOIN public.business_representations r ON r.id=p.business_representation_id
JOIN public.representation_formation_sessions f ON f.id=p.formation_session_id
JOIN public.direct_hire_formation_outcome_packages o ON o.id=p.source_formation_outcome_package_id
JOIN public.direct_hire_formation_conversation_runs run ON run.id=o.conversation_run_id;
