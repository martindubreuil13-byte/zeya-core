-- READ ONLY. Run after the P2.5 migration and before controlled Preview dispatch preparation.
WITH target AS (
  SELECT '42fd6467-ffe0-49e2-991a-fb503393b657'::uuid AS mission_id,
    '2b0f1bee-c7d9-449d-aad8-e64ebc4f6eae'::uuid AS execution_context_id
)
SELECT mission.id AS mission_id,mission.status,mission.lead_id,mission.representation_version_id,
  mission.mandate_outcome_package_id,mission.constraints,context.id AS execution_context_id,
  context.context_contract_version,context.context_fingerprint,
  representation.current_version_id,
  public.zeya_direct_hire_formation_outcome_is_current(mission.owner_id,mission.mandate_outcome_package_id) AS mandate_current,
  (SELECT count(*) FROM public.dispatches dispatch WHERE dispatch.mission_id=mission.id) AS dispatch_count,
  (SELECT count(*) FROM public.worker_briefs brief WHERE brief.operating_mission_id=mission.id) AS worker_brief_count,
  (SELECT count(*) FROM public.voice_conversation_outputs output WHERE output.mission_id=mission.id::text) AS voice_output_count,
  (SELECT count(*) FROM public.mission_execution_outcomes outcome WHERE outcome.mission_id=mission.id) AS execution_outcome_count
FROM target
JOIN public.operating_missions mission ON mission.id=target.mission_id
JOIN public.mission_execution_contexts context ON context.id=target.execution_context_id AND context.mission_id=mission.id
JOIN public.business_representations representation ON representation.id=mission.business_representation_id;

-- Catalog evidence: review every non-internal dispatch trigger and rule before live preparation.
SELECT trigger.tgname,pg_get_triggerdef(trigger.oid) AS trigger_definition
FROM pg_trigger trigger
WHERE trigger.tgrelid='public.dispatches'::regclass AND NOT trigger.tgisinternal
ORDER BY trigger.tgname;

SELECT rule.rulename,rule.definition
FROM pg_rules rule
WHERE rule.schemaname='public' AND rule.tablename='dispatches'
ORDER BY rule.rulename;
