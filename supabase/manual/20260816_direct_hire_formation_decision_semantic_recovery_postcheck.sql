-- READ ONLY. The bad row must remain historical and cease to affect readiness.
WITH bad AS (
  SELECT * FROM public.direct_hire_formation_decisions WHERE id='342500ba-4015-4c0e-91b8-42d1a1de1b3d'::uuid
), recovery AS (
  SELECT s.*,replacement.decision_key replacement_key,replacement.source_owner_turn_id replacement_turn,
    replacement.source_owner_evidence_id replacement_evidence
  FROM public.direct_hire_formation_decision_supersessions s
  JOIN public.direct_hire_formation_decisions replacement ON replacement.id=s.replacement_decision_id
  WHERE s.erroneous_decision_id='342500ba-4015-4c0e-91b8-42d1a1de1b3d'::uuid
), readiness AS (
  SELECT public.zeya_direct_hire_formation_readiness(bad.run_id) result FROM bad
)
SELECT 'historical bad row preserved' check_name,count(*)::text actual,'1' expected,count(*)=1 pass FROM bad
UNION ALL SELECT 'one governed supersession',count(*)::text,'1',count(*)=1 FROM recovery
UNION ALL SELECT 'replacement reuses exact lineage',jsonb_build_object('key',replacement_key,'sameTurn',replacement_turn=bad.source_owner_turn_id,'sameEvidence',replacement_evidence=bad.source_owner_evidence_id)::text,
  'primary_target_segment; sameTurn/sameEvidence true',replacement_key='primary_target_segment' AND replacement_turn=bad.source_owner_turn_id AND replacement_evidence=bad.source_owner_evidence_id FROM recovery,bad
UNION ALL SELECT 'readiness contamination removed',jsonb_build_object('target',result#>>'{categories,target,state}','immediateObjective',result#>>'{categories,immediate_bd_objective,state}')::text,
  'target=satisfied; immediateObjective=unresolved',result#>>'{categories,target,state}'='satisfied' AND result#>>'{categories,immediate_bd_objective,state}'='unresolved' FROM readiness;
