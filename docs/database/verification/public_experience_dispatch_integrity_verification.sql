-- Phase 4B.2 read-only verification. Every row must return passed = true.
WITH
relation AS (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='public_experience_sessions' AND c.relkind='r'),
column_contract AS (
 SELECT count(*) AS actual_count,count(*) FILTER (WHERE tn.nspname='pg_catalog' AND t.typname='text' AND NOT a.attnotnull AND a.attidentity='' AND a.attgenerated='') AS exact_count
 FROM relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
 WHERE a.attname='provider_call_id' AND a.attnum>0 AND NOT a.attisdropped
),
index_contract AS (
 SELECT count(*) AS actual_count,count(*) FILTER (WHERE i.indisunique AND i.indpred IS NOT NULL AND i.indkey::text=(SELECT a.attnum::text FROM relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='provider_call_id')
   AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(i.indpred,i.indrelid),'\s','','g')='(provider_call_idISNOTNULL)') AS exact_count
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='public_experience_sessions_provider_call_idx'
),
expected_states(state) AS (VALUES ('call_active'),('call_correlation_pending'),('call_dispatched'),('call_requested'),('dispatch_resolution_pending'),('expired'),('failed'),('reflection_ready'),('zeya_active'),('zeya_finalized')),
state_constraint AS (
 SELECT c.conkey,pg_catalog.pg_get_constraintdef(c.oid,true) AS definition FROM relation r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
 WHERE c.conname='public_experience_sessions_state_check' AND c.contype='c'
),
actual_states AS (
 SELECT DISTINCT extracted.value[1]::text AS state FROM state_constraint
 CROSS JOIN LATERAL pg_catalog.regexp_matches(definition,'''([^'']+)''::text','g') AS extracted(value)
),
missing_states AS (SELECT * FROM expected_states EXCEPT SELECT * FROM actual_states),
unexpected_states AS (SELECT * FROM actual_states EXCEPT SELECT * FROM expected_states),
state_summary AS (
 SELECT count(*) AS constraint_count,count(*) FILTER (WHERE conkey=ARRAY[(SELECT a.attnum FROM relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='state' AND NOT a.attisdropped)]::smallint[]) AS state_column_count,
  (SELECT array_agg(state ORDER BY state) FROM expected_states) AS expected_state_array,
  (SELECT array_agg(state ORDER BY state) FROM actual_states) AS actual_state_array FROM state_constraint
),
expected_rpcs(name,oid) AS (VALUES
 ('zeya_request_public_experience_call',to_regprocedure('public.zeya_request_public_experience_call(text,text,text)')),
 ('zeya_record_public_experience_dispatch',to_regprocedure('public.zeya_record_public_experience_dispatch(text,text,uuid,text)')),
 ('zeya_reset_public_experience_call_request',to_regprocedure('public.zeya_reset_public_experience_call_request(text,text)')),
 ('zeya_record_public_experience_provider_acceptance',to_regprocedure('public.zeya_record_public_experience_provider_acceptance(text,text,uuid,text,text)'))
),
named_rpcs AS (
 SELECT p.oid,p.proname::text AS name,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.prosrc,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected_rpcs)
),
rpc_security AS (
 SELECT count(e.oid) AS rpc_count,count(*) FILTER (WHERE e.oid IS NOT NULL AND a.oid=e.oid AND a.owner='postgres' AND a.prosecdef AND a.proconfig=ARRAY['search_path=""']::text[]
   AND has_function_privilege('service_role',a.oid,'EXECUTE') AND NOT has_function_privilege('anon',a.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',a.oid,'EXECUTE')
   AND (SELECT count(*) FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE')=2
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee NOT IN (a.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))) AS secure_count
 FROM expected_rpcs e LEFT JOIN named_rpcs a ON a.oid=e.oid
),
transition_contract AS (
 SELECT count(*) FILTER (WHERE oid=to_regprocedure('public.zeya_record_public_experience_provider_acceptance(text,text,uuid,text,text)')
   AND regexp_replace(prosrc,'\s','','g') LIKE '%p_provider_call_idISNULLORbtrim(p_provider_call_id)=''''%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%p_provider_conversation_idISNULLORbtrim(p_provider_conversation_id)=''''%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%v.provider_call_id=p_provider_call_id%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%v.provider_conversation_id=p_provider_conversation_id%') AS acceptance_exact,
  count(*) FILTER (WHERE oid=to_regprocedure('public.zeya_record_public_experience_dispatch(text,text,uuid,text)')
   AND regexp_replace(prosrc,'\s','','g') LIKE '%v.provider_call_idISNULL%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%v.provider_conversation_idISNULL%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%l.provider_call_id=v.provider_call_id%'
   AND regexp_replace(prosrc,'\s','','g') LIKE '%l.conversation_id=v.provider_conversation_id%') AS correlation_exact
 FROM named_rpcs
),
trigger_contract AS (
 SELECT count(*) AS trigger_count,count(*) FILTER (WHERE NOT t.tgisinternal AND t.tgenabled::text='O' AND t.tgtype::int=31 AND t.tgfoid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')) AS exact_count
 FROM relation r LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND t.tgname='zeya_public_experience_session_writes'
),
trigger_function AS (
 SELECT count(*) AS function_count,count(*) FILTER (WHERE p.oid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()') AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
   AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE')=1
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee<>p.proowner)
   AND regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.public_experience_session_write%' AND regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.controlled_purge%') AS exact_count
 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')
),
table_security AS (
 SELECT count(*) AS table_count,bool_and(c.relrowsecurity AND has_table_privilege('service_role',c.oid,'SELECT') AND NOT has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) AS exact
 FROM relation r JOIN pg_catalog.pg_class c ON c.oid=r.oid
),
purge AS (
 SELECT count(*) AS function_count,count(*) FILTER (WHERE p.oid=to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)') AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
   AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, auth, pg_temp']::text[] AND has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE')=2
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))
   AND regexp_replace(p.prosrc,'\s','','g') LIKE '%set_config(''zeya.controlled_purge'',''on'',true)%'
   AND regexp_replace(p.prosrc,'\s','','g') LIKE '%set_config(''zeya.controlled_purge'',''off'',true)%') AS exact_count
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='zeya_purge_business_representation'
)
SELECT 'provider_identity_column_exact' AS check_name,actual_count=1 AND exact_count=1 AS passed,jsonb_build_object('actual_count',actual_count,'exact_count',exact_count) AS details FROM column_contract
UNION ALL SELECT 'provider_identity_index_exact',actual_count=1 AND exact_count=1,jsonb_build_object('actual_count',actual_count,'exact_count',exact_count) FROM index_contract
UNION ALL SELECT 'state_constraint_exact',constraint_count=1 AND state_column_count=1 AND expected_state_array=actual_state_array AND NOT EXISTS(SELECT 1 FROM missing_states) AND NOT EXISTS(SELECT 1 FROM unexpected_states),jsonb_build_object('constraint_count',constraint_count,'state_column_count',state_column_count,'expected_states',expected_state_array,'actual_states',actual_state_array,'missing_count',(SELECT count(*) FROM missing_states),'unexpected_count',(SELECT count(*) FROM unexpected_states)) FROM state_summary
UNION ALL SELECT 'mutation_rpcs_exact_and_secure',rpc_count=4 AND secure_count=4 AND (SELECT count(*) FROM named_rpcs)=4,jsonb_build_object('expected_count',4,'exact_oid_count',rpc_count,'named_overload_count',(SELECT count(*) FROM named_rpcs),'secure_count',secure_count) FROM rpc_security
UNION ALL SELECT 'provider_identity_transitions_exact',acceptance_exact=1 AND correlation_exact=1,jsonb_build_object('acceptance_exact',acceptance_exact,'correlation_exact',correlation_exact) FROM transition_contract
UNION ALL SELECT 'table_security_exact',table_count=1 AND exact,jsonb_build_object('table_count',table_count,'rls_and_acl_exact',exact) FROM table_security
UNION ALL SELECT 'mutation_trigger_exact',trigger_count=1 AND exact_count=1,jsonb_build_object('trigger_count',trigger_count,'exact_count',exact_count,'expected_tgtype',31) FROM trigger_contract
UNION ALL SELECT 'trigger_function_exact',function_count=1 AND exact_count=1,jsonb_build_object('function_count',function_count,'exact_count',exact_count) FROM trigger_function
UNION ALL SELECT 'controlled_purge_compatible',function_count=1 AND exact_count=1,jsonb_build_object('named_overload_count',function_count,'exact_count',exact_count) FROM purge;
