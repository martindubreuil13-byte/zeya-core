-- P2.3B POSTCHECK — READ ONLY. No function invocation and no state mutation.
WITH tables AS (
  SELECT count(*)=4 AS ok FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('direct_hire_formation_conversation_runs','direct_hire_formation_conversation_turns','direct_hire_formation_agenda_resolution_events','direct_hire_formation_decisions') AND c.relkind='r'
), function_acl AS (
  SELECT p.oid,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('zeya_start_or_resume_direct_hire_formation_conversation','zeya_pause_direct_hire_formation_conversation','zeya_record_direct_hire_formation_answer')
), functions AS (
  SELECT count(*)=3 AND bool_and(NOT acl.public_execute) AND bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE'))
    AND bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
    AND bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) AS ok
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  JOIN function_acl acl ON acl.oid=p.oid
  WHERE n.nspname='public' AND p.proname IN ('zeya_start_or_resume_direct_hire_formation_conversation','zeya_pause_direct_hire_formation_conversation','zeya_record_direct_hire_formation_answer')
), qa AS (
  SELECT r.id,r.status,count(DISTINCT t.id) AS turns,count(DISTINCT e.id) AS resolutions,count(DISTINCT d.id) AS decisions,
    bool_and(d.noncanonical) FILTER(WHERE d.id IS NOT NULL) AS decisions_noncanonical
  FROM public.direct_hire_formation_conversation_runs r
  JOIN public.direct_hire_first_working_session_formation_handoffs h ON h.id=r.formation_handoff_id
  LEFT JOIN public.direct_hire_formation_conversation_turns t ON t.run_id=r.id
  LEFT JOIN public.direct_hire_formation_agenda_resolution_events e ON e.run_id=r.id
  LEFT JOIN public.direct_hire_formation_decisions d ON d.run_id=r.id
  WHERE h.preparation_contract_version='first-working-session-preparation-v4'
  GROUP BY r.id,r.status
), invariants AS (
  SELECT NOT EXISTS(SELECT 1 FROM public.representation_proposals p JOIN qa ON p.formation_session_id=(SELECT formation_session_id FROM public.direct_hire_formation_conversation_runs WHERE id=qa.id)) AS no_proposal,
    NOT EXISTS(SELECT 1 FROM public.business_representations br JOIN public.direct_hire_formation_conversation_runs r ON r.business_representation_id=br.id JOIN qa ON qa.id=r.id WHERE br.current_version_id IS NOT NULL) AS no_canonical,
    NOT EXISTS(SELECT 1 FROM public.representation_formation_sessions f JOIN qa ON qa.id=(SELECT id FROM public.direct_hire_formation_conversation_runs WHERE formation_session_id=f.id LIMIT 1) WHERE f.first_working_conversation_id IS NOT NULL) AS no_voice
)
SELECT 'schema objects and service-only RPCs' AS check_name,(tables.ok AND functions.ok)::text AS actual,'true' AS expected,tables.ok AND functions.ok AS pass FROM tables,functions
UNION ALL SELECT 'one QA conversation run',count(*)::text,'1',count(*)=1 FROM qa
UNION ALL SELECT 'QA durable effects',coalesce(jsonb_agg(jsonb_build_object('status',status,'turns',turns,'resolutions',resolutions,'decisions',decisions,'noncanonical',decisions_noncanonical))::text,'[]'),'review expected first controlled answer',count(*)=1 FROM qa
UNION ALL SELECT 'no proposal, Version, or voice',jsonb_build_object('noProposal',no_proposal,'noCanonical',no_canonical,'noVoice',no_voice)::text,'all true',no_proposal AND no_canonical AND no_voice FROM invariants;
