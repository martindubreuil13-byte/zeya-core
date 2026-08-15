-- P2.3C POSTCHECK — READ ONLY. Safe both during controlled QA and after completion.
WITH qa_owner AS (SELECT id FROM auth.users WHERE lower(email)=lower('mdubreu@gmail.com')),
lineage AS (
  SELECT f.id formation_session_id,f.status formation_status,f.first_working_conversation_id,r.*,w.status working_session_status,
    br.current_version_id,h.preparation_brief_id
  FROM qa_owner owner_row JOIN public.representation_formation_sessions f ON f.owner_id=owner_row.id
  JOIN public.direct_hire_first_working_session_formation_handoffs h ON h.formation_session_id=f.id
  JOIN public.direct_hire_formation_conversation_runs r ON r.formation_session_id=f.id
  JOIN public.direct_hire_working_sessions w ON w.id=r.direct_hire_working_session_id
  JOIN public.business_representations br ON br.id=r.business_representation_id
  WHERE f.id='667dc7a0-c93a-477a-892a-2259b28dff3f'::uuid
), readiness AS (
  SELECT l.*,public.zeya_direct_hire_formation_readiness(l.id) result FROM lineage l
), package AS (
  SELECT o.*,public.zeya_direct_hire_formation_outcome_is_current(o.owner_id,o.id) source_state_current
  FROM public.direct_hire_formation_outcome_packages o JOIN lineage l ON l.id=o.conversation_run_id
), boundaries AS (
  SELECT NOT EXISTS(SELECT 1 FROM public.representation_proposals p JOIN lineage l ON p.formation_session_id=l.formation_session_id) no_proposal,
    NOT EXISTS(SELECT 1 FROM public.representation_versions v JOIN lineage l ON v.business_representation_id=l.business_representation_id) no_version,
    bool_and(current_version_id IS NULL) current_pointer_null,bool_and(first_working_conversation_id IS NULL) no_voice,
    bool_and(formation_status='working_conversation_pending') truthful_formation_status FROM lineage
)
SELECT 'readiness diagnostic' check_name,result::text actual,'inspect every category; ready only when all satisfied' expected,jsonb_typeof(result)='object' pass FROM readiness
UNION ALL SELECT 'completion and exactly one package',jsonb_build_object('run',r.status,'workingSession',r.working_session_status,'packages',(SELECT count(*) FROM package))::text,'completed/completed/1 when finished',CASE WHEN r.status='completed' THEN r.working_session_status='completed' AND (SELECT count(*) FROM package)=1 ELSE (SELECT count(*) FROM package)=0 END FROM readiness r
UNION ALL SELECT 'finalized package integrity',coalesce(jsonb_agg(jsonb_build_object('noncanonical',noncanonical,'current',source_state_current,'contract',completion_contract_version,'fingerprint',outcome_fingerprint))::text,'[]'),'one row: noncanonical/current true and readiness v1',coalesce(bool_and(noncanonical AND source_state_current AND completion_contract_version='direct-hire-telephone-bd-readiness-v1'),true) FROM package
UNION ALL SELECT 'proposal/Version/voice/canonical boundaries',jsonb_build_object('noProposal',no_proposal,'noVersion',no_version,'currentPointerNull',current_pointer_null,'noVoice',no_voice,'truthfulFormationStatus',truthful_formation_status)::text,'all true',no_proposal AND no_version AND current_pointer_null AND no_voice AND truthful_formation_status FROM boundaries;
