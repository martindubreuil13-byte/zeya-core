-- READ ONLY. Run only after a separately authorized Preview approval.
WITH target AS (SELECT '132de1c1-b02d-4c04-80cd-336d4eb37667'::uuid proposal_id), proposal AS (
  SELECT p.* FROM public.representation_proposals p JOIN target t ON t.proposal_id=p.id
)
SELECT p.id,p.status,r.current_version_id,v.id AS version_id,v.version_number,v.previous_version_id,
  v.source_proposal_id,v.source_approval_id,v.element_values,
  (SELECT count(*) FROM public.representation_versions x WHERE x.business_representation_id=r.id) AS version_count,
  (SELECT count(*) FROM public.approval_decisions a WHERE a.representation_proposal_id=p.id) AS approval_count,
  (SELECT jsonb_agg(jsonb_build_object('id',old.id,'status',old.status,'contract',old.proposal_contract_version))
   FROM public.representation_proposals old WHERE old.source_formation_outcome_package_id=p.source_formation_outcome_package_id AND old.id<>p.id) AS predecessors,
  (SELECT count(*) FROM public.voice_conversation_outputs voice WHERE voice.business_representation_id=r.id) AS voice_output_count
FROM proposal p JOIN public.business_representations r ON r.id=p.business_representation_id
LEFT JOIN public.representation_versions v ON v.id=r.current_version_id;
