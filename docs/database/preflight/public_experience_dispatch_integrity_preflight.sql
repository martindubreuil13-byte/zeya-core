-- Phase 4B.2 read-only preflight. Every row must return passed = true.
WITH
relation AS (
  SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='public_experience_sessions' AND c.relkind='r'
),
expected_columns_base(name,type_schema,type_name,not_null) AS (VALUES
 ('id','pg_catalog','uuid',true),('token_hash','pg_catalog','text',true),('tenant_user_id','pg_catalog','uuid',true),
 ('business_id','pg_catalog','uuid',true),('business_representation_id','pg_catalog','uuid',true),('canonical_version_id','pg_catalog','uuid',true),
 ('zeya_voice_context_id','pg_catalog','uuid',true),('zeya_conversation_output_id','pg_catalog','uuid',false),('veya_voice_context_id','pg_catalog','uuid',false),
 ('veya_conversation_output_id','pg_catalog','uuid',false),('dispatch_id','pg_catalog','text',false),('phone_hash','pg_catalog','text',false),
 ('provider_conversation_id','pg_catalog','text',false),('state','pg_catalog','text',true),('expires_at','pg_catalog','timestamptz',true),
 ('created_at','pg_catalog','timestamptz',true),('zeya_finalized_at','pg_catalog','timestamptz',false),('call_requested_at','pg_catalog','timestamptz',false),
 ('call_dispatched_at','pg_catalog','timestamptz',false),('call_completed_at','pg_catalog','timestamptz',false),('failed_at','pg_catalog','timestamptz',false),
 ('updated_at','pg_catalog','timestamptz',true)
),
expected_columns AS (SELECT *,''::text AS identity_state,''::text AS generated_state FROM expected_columns_base),
actual_columns AS (
 SELECT a.attname::text AS name,tn.nspname::text AS type_schema,t.typname::text AS type_name,a.attnotnull AS not_null,
        a.attidentity::text AS identity_state,a.attgenerated::text AS generated_state
 FROM relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace WHERE a.attnum>0 AND NOT a.attisdropped
),
missing_columns AS (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns),
unexpected_columns AS (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns),
expected_states(state) AS (VALUES ('call_active'),('call_dispatched'),('call_requested'),('expired'),('failed'),('reflection_ready'),('zeya_active'),('zeya_finalized')),
state_constraint AS (
 SELECT c.oid,c.conkey,pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
 FROM relation r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
 WHERE c.conname='public_experience_sessions_state_check' AND c.contype='c'
),
actual_states AS (
 SELECT DISTINCT extracted.value[1]::text AS state FROM state_constraint
 CROSS JOIN LATERAL pg_catalog.regexp_matches(definition,'''([^'']+)''::text','g') AS extracted(value)
),
missing_states AS (SELECT * FROM expected_states EXCEPT SELECT * FROM actual_states),
unexpected_states AS (SELECT * FROM actual_states EXCEPT SELECT * FROM expected_states),
state_summary AS (
 SELECT count(*) AS constraint_count,
   count(*) FILTER (WHERE conkey=ARRAY[(SELECT a.attnum FROM relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='state' AND NOT a.attisdropped)]::smallint[]) AS state_column_count,
   (SELECT array_agg(state ORDER BY state) FROM expected_states) AS expected_state_array,
   (SELECT array_agg(state ORDER BY state) FROM actual_states) AS actual_state_array
 FROM state_constraint
),
expected_rpcs(name,oid) AS (VALUES
 ('zeya_request_public_experience_call',to_regprocedure('public.zeya_request_public_experience_call(text,text,text)')),
 ('zeya_record_public_experience_dispatch',to_regprocedure('public.zeya_record_public_experience_dispatch(text,text,uuid,text)'))
),
named_rpcs AS (
 SELECT p.oid,p.proname::text AS name,p.proowner,p.prosecdef,p.proconfig,p.proacl,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected_rpcs)
),
rpc_security AS (
 SELECT count(e.oid) AS rpc_count,count(*) FILTER (WHERE e.oid IS NOT NULL AND a.oid=e.oid AND a.owner='postgres' AND a.prosecdef
   AND a.proconfig=ARRAY['search_path=""']::text[]
   AND has_function_privilege('service_role',a.oid,'EXECUTE') AND NOT has_function_privilege('anon',a.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',a.oid,'EXECUTE')
   AND (SELECT count(*) FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE')=2
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee NOT IN (a.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))
 ) AS secure_count
 FROM expected_rpcs e LEFT JOIN named_rpcs a ON a.oid=e.oid
),
trigger_contract AS (
 SELECT count(*) AS trigger_count,count(*) FILTER (WHERE NOT t.tgisinternal AND t.tgenabled::text='O' AND t.tgtype::int=31
   AND t.tgfoid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')) AS exact_count
 FROM relation r LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND t.tgname='zeya_public_experience_session_writes'
),
trigger_function AS (
 SELECT count(*) AS function_count,count(*) FILTER (WHERE p.oid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')
   AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
   AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE')=1
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee<>p.proowner)
   AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.public_experience_session_write%'
   AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.controlled_purge%') AS exact_count
 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.zeya_enforce_public_experience_session_writes()')
),
table_security AS (
 SELECT count(*) AS table_count,bool_and(c.relrowsecurity AND has_table_privilege('service_role',c.oid,'SELECT')
   AND NOT has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) AS exact
 FROM relation r JOIN pg_catalog.pg_class c ON c.oid=r.oid
),
collisions AS (
 SELECT (SELECT count(*) FROM actual_columns WHERE name='provider_call_id') AS column_count,
  (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='public_experience_sessions_provider_call_idx') AS index_count,
  (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('zeya_reset_public_experience_call_request','zeya_record_public_experience_provider_acceptance')) AS function_count
),
active_rows AS (
 SELECT count(*) FILTER (WHERE state='zeya_active') AS zeya_active,count(*) FILTER (WHERE state='zeya_finalized') AS zeya_finalized,
  count(*) FILTER (WHERE state='call_requested') AS call_requested,count(*) FILTER (WHERE state='call_dispatched') AS call_dispatched,
  count(*) FILTER (WHERE state='call_active') AS call_active,count(*) FILTER (WHERE state='reflection_ready') AS incompatible_reflection_ready
 FROM public.public_experience_sessions
),
purge AS (
 SELECT count(*) AS function_count,count(*) FILTER (WHERE p.oid=to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)')
   AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, auth, pg_temp']::text[]
   AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE')=2
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee NOT IN (p.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))
   AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%set_config(''zeya.controlled_purge'',''on'',true)%'
   AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%set_config(''zeya.controlled_purge'',''off'',true)%') AS exact_count
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='zeya_purge_business_representation'
)
SELECT 'phase_4a_table_exact' AS check_name,(SELECT count(*) FROM relation)=1 AND NOT EXISTS(SELECT 1 FROM missing_columns) AND NOT EXISTS(SELECT 1 FROM unexpected_columns) AS passed,jsonb_build_object('expected_count',(SELECT count(*) FROM expected_columns),'actual_count',(SELECT count(*) FROM actual_columns),'missing_count',(SELECT count(*) FROM missing_columns),'unexpected_count',(SELECT count(*) FROM unexpected_columns)) AS details
UNION ALL SELECT 'phase_4a_state_constraint_exact',constraint_count=1 AND state_column_count=1 AND expected_state_array=actual_state_array AND NOT EXISTS(SELECT 1 FROM missing_states) AND NOT EXISTS(SELECT 1 FROM unexpected_states),jsonb_build_object('constraint_count',constraint_count,'state_column_count',state_column_count,'expected_states',expected_state_array,'actual_states',actual_state_array,'missing_count',(SELECT count(*) FROM missing_states),'unexpected_count',(SELECT count(*) FROM unexpected_states)) FROM state_summary
UNION ALL SELECT 'phase_4a_rpcs_exact_and_secure',rpc_count=2 AND secure_count=2 AND (SELECT count(*) FROM named_rpcs)=2,jsonb_build_object('expected_count',2,'exact_oid_count',rpc_count,'named_overload_count',(SELECT count(*) FROM named_rpcs),'secure_count',secure_count) FROM rpc_security
UNION ALL SELECT 'phase_4a_table_security',table_count=1 AND exact,jsonb_build_object('table_count',table_count,'rls_and_acl_exact',exact) FROM table_security
UNION ALL SELECT 'phase_4a_mutation_trigger',trigger_count=1 AND exact_count=1,jsonb_build_object('trigger_count',trigger_count,'exact_count',exact_count,'expected_tgtype',31) FROM trigger_contract
UNION ALL SELECT 'phase_4a_trigger_function',function_count=1 AND exact_count=1,jsonb_build_object('function_count',function_count,'exact_count',exact_count) FROM trigger_function
UNION ALL SELECT 'phase_4b2_no_collisions',column_count=0 AND index_count=0 AND function_count=0,jsonb_build_object('column_count',column_count,'index_count',index_count,'function_count',function_count) FROM collisions
UNION ALL SELECT 'no_incompatible_active_rows',zeya_active=0 AND zeya_finalized=0 AND call_requested=0 AND call_dispatched=0 AND call_active=0,jsonb_build_object('zeya_active',zeya_active,'zeya_finalized',zeya_finalized,'call_requested',call_requested,'call_dispatched',call_dispatched,'call_active',call_active) FROM active_rows
UNION ALL SELECT 'no_incompatible_terminal_dispatch_rows',incompatible_reflection_ready=0,jsonb_build_object('reflection_ready_without_phase_4b2_provider_call_identity',incompatible_reflection_ready) FROM active_rows
UNION ALL SELECT 'controlled_purge_compatible',function_count=1 AND exact_count=1,jsonb_build_object('named_overload_count',function_count,'exact_count',exact_count) FROM purge;
