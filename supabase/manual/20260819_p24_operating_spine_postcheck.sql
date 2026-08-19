-- READ ONLY. Substitute the controlled QA mission UUID after API creation/preparation.
WITH target AS (SELECT '42fd6467-ffe0-49e2-991a-fb503393b657'::uuid mission_id)
SELECT m.id,m.status,m.owner_id,m.business_representation_id,m.lead_id,m.representation_version_id,
  m.mandate_outcome_package_id,m.objective,m.qualification_goal,m.desired_next_step,m.allowed_channel,m.constraints,
  c.id AS context_id,c.context_contract_version,c.context_fingerprint,c.context,
  r.current_version_id,
  public.zeya_direct_hire_formation_outcome_is_current(m.owner_id,m.mandate_outcome_package_id) AS mandate_current,
  (SELECT count(*) FROM public.mission_execution_contexts x WHERE x.mission_id=m.id) AS context_count,
  (SELECT count(*) FROM public.dispatches) AS global_dispatch_count_observation,
  (SELECT count(*) FROM public.voice_conversation_outputs v WHERE v.business_representation_id=m.business_representation_id) AS representation_voice_output_count
FROM target t JOIN public.operating_missions m ON m.id=t.mission_id
JOIN public.business_representations r ON r.id=m.business_representation_id
LEFT JOIN public.mission_execution_contexts c ON c.mission_id=m.id;
