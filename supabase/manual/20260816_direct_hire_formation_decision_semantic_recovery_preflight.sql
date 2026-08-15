-- READ ONLY. Verify the exact live semantic-mapping defect before recovery.
WITH owner_row AS (SELECT id FROM auth.users WHERE lower(email)=lower('mdubreu@gmail.com')),
target AS (
  SELECT d.id,d.run_id,d.decision_scope,d.decision_key,d.source_agenda_item_id,d.source_owner_turn_id,d.source_owner_evidence_id,
    agenda.constitutional_domain,agenda.category agenda_category,run.status run_status,d.decision_value->>'statement' owner_statement
  FROM public.direct_hire_formation_decisions d
  JOIN public.direct_hire_formation_conversation_runs run ON run.id=d.run_id
  JOIN public.direct_hire_first_working_session_formation_agenda_items agenda ON agenda.id=d.source_agenda_item_id
  JOIN owner_row owner_identity ON owner_identity.id=run.owner_id
  WHERE d.id='342500ba-4015-4c0e-91b8-42d1a1de1b3d'::uuid
    AND d.source_agenda_item_id='d5c7a85e-138b-4fd9-8eec-2e04297f4d46'::uuid
), outcome AS (
  SELECT count(*) outcome_count
  FROM public.direct_hire_formation_outcome_packages package
  JOIN target ON target.run_id=package.conversation_run_id
), recovery_objects AS (
  SELECT
    to_regclass('public.direct_hire_formation_decision_supersessions') IS NULL AS supersession_table_absent,
    to_regprocedure('public.zeya_reclassify_direct_hire_formation_decision(uuid,uuid,uuid,text,text)') IS NULL AS recovery_rpc_absent,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid='public.direct_hire_formation_conversation_turns'::regclass
        AND attribute.attname='governed_semantic_key'
        AND NOT attribute.attisdropped
    ) AS governed_semantic_key_absent
)
SELECT 'exact erroneous decision' check_name,count(*)::text actual,'1' expected,count(*)=1 pass FROM target
UNION ALL SELECT 'semantic mismatch',jsonb_build_object('scope',decision_scope,'key',decision_key,'domain',constitutional_domain)::text,
  'commercial/immediate_bd_goal/whoItIsFor',decision_scope='commercial' AND decision_key='immediate_bd_goal' AND constitutional_domain='whoItIsFor' FROM target
UNION ALL SELECT 'exact target-answer lineage',jsonb_build_object('runStatus',run_status,'agendaCategory',agenda_category,'domain',constitutional_domain,'hasTurn',source_owner_turn_id IS NOT NULL,'hasEvidence',source_owner_evidence_id IS NOT NULL,'primaryTargetMeaning',owner_statement ILIKE '%primary target%' AND owner_statement ILIKE '%startups%' AND owner_statement ILIKE '%English-speaking Western developed countries%')::text,
  'paused/commercial/whoItIsFor with exact owner target meaning',run_status='paused' AND agenda_category='commercial' AND constitutional_domain='whoItIsFor'
    AND source_owner_turn_id IS NOT NULL AND source_owner_evidence_id IS NOT NULL
    AND owner_statement ILIKE '%primary target%' AND owner_statement ILIKE '%startups%' AND owner_statement ILIKE '%English-speaking Western developed countries%' FROM target
UNION ALL SELECT 'no finalized outcome package',outcome_count::text,'0',outcome_count=0 FROM outcome
UNION ALL SELECT 'semantic recovery objects absent',jsonb_build_object('supersessionTableAbsent',supersession_table_absent,'recoveryRpcAbsent',recovery_rpc_absent,'governedSemanticKeyAbsent',governed_semantic_key_absent)::text,
  'all true',supersession_table_absent AND recovery_rpc_absent AND governed_semantic_key_absent FROM recovery_objects;
