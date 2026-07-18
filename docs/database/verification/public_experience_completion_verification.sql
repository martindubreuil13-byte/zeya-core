-- Phase 4B.3 read-only verification. Every row must return passed = true.
WITH
receipt_relation AS (
 SELECT c.oid,c.relowner,c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='voice_provider_webhook_receipts' AND c.relkind='r'
),
expected_columns(name,type_schema,type_name,not_null,has_default) AS (VALUES
 ('id','pg_catalog','uuid',true,true),('provider','pg_catalog','text',true,false),('event_key','pg_catalog','text',true,false),
 ('event_type','pg_catalog','text',true,false),('provider_conversation_id','pg_catalog','text',true,false),('payload_hash','pg_catalog','text',true,false),
 ('public_experience_session_id','pg_catalog','uuid',true,false),('processing_state','pg_catalog','text',true,false),('attempt_count','pg_catalog','int4',true,true),
 ('first_received_at','pg_catalog','timestamptz',true,true),('last_attempt_at','pg_catalog','timestamptz',true,true),('completed_at','pg_catalog','timestamptz',false,false)
),
actual_columns AS (
 SELECT a.attname::text,tn.nspname::text,t.typname::text,a.attnotnull,(d.adbin IS NOT NULL) AS has_default
 FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped
),
missing_columns AS (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns),
unexpected_columns AS (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns),
default_contract AS (
 SELECT count(*) FILTER(WHERE a.attname='id' AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'\s','','g')='gen_random_uuid()') AS id_default,
  count(*) FILTER(WHERE a.attname='attempt_count' AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'\s','','g')='1') AS attempt_default,
  count(*) FILTER(WHERE a.attname IN('first_received_at','last_attempt_at') AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'\s','','g')='now()') AS timestamp_defaults
 FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
),
constraint_inventory AS (
 SELECT c.oid,c.conname::text,c.contype::text,c.conkey,c.confkey,c.confrelid,c.confdeltype::text,pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid,true),'\s','','g') AS definition
 FROM receipt_relation r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
),
key_contract AS (
 SELECT count(*) FILTER(WHERE contype='p' AND conkey=ARRAY[(SELECT a.attnum FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='id')]::smallint[]) AS primary_key_count,
  count(*) FILTER(WHERE contype='u' AND conkey=ARRAY[(SELECT a.attnum FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='provider'),(SELECT a.attnum FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='event_key')]::smallint[]) AS event_unique_count,
  count(*) FILTER(WHERE contype='f' AND confrelid=to_regclass('public.public_experience_sessions') AND confdeltype='c'
   AND conkey=ARRAY[(SELECT a.attnum FROM receipt_relation r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid WHERE a.attname='public_experience_session_id')]::smallint[]
   AND confkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.public_experience_sessions') AND a.attname='id')]::smallint[]) AS foreign_key_count
 FROM constraint_inventory
),
check_contract AS (
 SELECT count(*) FILTER(WHERE contype='c') AS check_count,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%provider=''elevenlabs''::text%') AS provider_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%length(event_key)%1%600%') AS event_key_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%length(event_type)%1%100%') AS event_type_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%length(provider_conversation_id)%1%255%') AS conversation_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%payload_hash~''^[0-9a-f]{64}$''::text%') AS hash_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%processing_state=ANY(ARRAY[''processing''::text,''completed''::text,''failed''::text])%') AS processing_check,
  count(*) FILTER(WHERE contype='c' AND definition LIKE '%attempt_count>0%') AS attempt_check
 FROM constraint_inventory
),
index_contract AS (
 SELECT count(*) AS index_count,count(*) FILTER(WHERE NOT i.indisunique AND i.indpred IS NULL AND i.indkey::text=(
  SELECT string_agg(a.attnum::text,' ' ORDER BY wanted.ordinality) FROM unnest(ARRAY['provider','provider_conversation_id']) WITH ORDINALITY wanted(name,ordinality)
  JOIN receipt_relation r ON true JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attname=wanted.name
 )) AS exact_count
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='voice_provider_webhook_receipts_conversation_idx'
),
table_security AS (
 SELECT count(*) AS table_count,count(*) FILTER(WHERE pg_catalog.pg_get_userbyid(relowner)='postgres' AND relrowsecurity
  AND has_table_privilege('service_role',oid,'SELECT') AND NOT has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) AS exact_count,
  (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=(SELECT oid FROM receipt_relation)) AS policy_count
 FROM receipt_relation
),
receipt_trigger AS (
 SELECT count(*) AS trigger_count,count(*) FILTER(WHERE NOT t.tgisinternal AND t.tgenabled::text='O' AND t.tgtype::int=31 AND t.tgfoid=to_regprocedure('public.zeya_enforce_voice_webhook_receipt_writes()')) AS exact_count
 FROM receipt_relation r LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND t.tgname='zeya_voice_webhook_receipt_writes'
),
receipt_trigger_function AS (
 SELECT count(*) AS function_count,count(*) FILTER(WHERE pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
  AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE')=1
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee<>p.proowner)
  AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.voice_webhook_write%'
  AND pg_catalog.regexp_replace(p.prosrc,'\s','','g') LIKE '%zeya.controlled_purge%') AS exact_count
 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.zeya_enforce_voice_webhook_receipt_writes()')
),
expected_states(state) AS (VALUES ('call_active'),('call_completed_without_transcript'),('call_correlation_pending'),('call_dispatched'),('call_failed'),('call_rejected'),('call_requested'),('call_unanswered'),('completion_processing_failed'),('dispatch_resolution_pending'),('expired'),('failed'),('reflection_ready'),('zeya_active'),('zeya_finalized')),
state_constraint AS (
 SELECT c.conkey,pg_catalog.pg_get_constraintdef(c.oid,true) AS definition FROM pg_catalog.pg_constraint c
 WHERE c.conrelid=to_regclass('public.public_experience_sessions') AND c.conname='public_experience_sessions_state_check' AND c.contype='c'
),
actual_states AS (
 SELECT DISTINCT extracted.value[1]::text AS state FROM state_constraint CROSS JOIN LATERAL pg_catalog.regexp_matches(definition,'''([^'']+)''::text','g') extracted(value)
),
missing_states AS (SELECT * FROM expected_states EXCEPT SELECT * FROM actual_states),
unexpected_states AS (SELECT * FROM actual_states EXCEPT SELECT * FROM expected_states),
state_summary AS (
 SELECT count(*) AS constraint_count,count(*) FILTER(WHERE conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.public_experience_sessions') AND a.attname='state' AND NOT a.attisdropped)]::smallint[]) AS state_column_count,
  (SELECT array_agg(state ORDER BY state) FROM expected_states) AS expected_state_array,(SELECT array_agg(state ORDER BY state) FROM actual_states) AS actual_state_array FROM state_constraint
),
expected_rpcs(name,oid,return_schema,return_name) AS (VALUES
 ('zeya_begin_voice_webhook_receipt',to_regprocedure('public.zeya_begin_voice_webhook_receipt(text,text,text,text,uuid)'),'pg_catalog','jsonb'),
 ('zeya_finish_voice_webhook_receipt',to_regprocedure('public.zeya_finish_voice_webhook_receipt(text,integer,boolean)'),'pg_catalog','text'),
 ('zeya_repair_public_experience_dispatch',to_regprocedure('public.zeya_repair_public_experience_dispatch(uuid,text,text)'),'pg_catalog','text'),
 ('zeya_record_public_experience_call_failure',to_regprocedure('public.zeya_record_public_experience_call_failure(uuid,text,text,text)'),'pg_catalog','text'),
 ('zeya_complete_public_experience_call',to_regprocedure('public.zeya_complete_public_experience_call(uuid,uuid)'),'pg_catalog','text')
),
named_rpcs AS (
 SELECT p.oid,p.proname::text,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.prosrc,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,rn.nspname::text AS return_schema,rt.typname::text AS return_name
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_type rt ON rt.oid=p.prorettype JOIN pg_catalog.pg_namespace rn ON rn.oid=rt.typnamespace WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected_rpcs)
),
rpc_security AS (
 SELECT count(e.oid) AS exact_oid_count,count(*) FILTER(WHERE e.oid IS NOT NULL AND a.oid=e.oid AND a.return_schema=e.return_schema AND a.return_name=e.return_name AND a.owner='postgres' AND a.prosecdef AND a.proconfig=ARRAY['search_path=""']::text[]
  AND has_function_privilege('service_role',a.oid,'EXECUTE') AND NOT has_function_privilege('anon',a.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',a.oid,'EXECUTE')
  AND (SELECT count(*) FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE')=2
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(a.proacl) x WHERE x.privilege_type='EXECUTE' AND x.grantee NOT IN(a.proowner,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')))) AS secure_count
 FROM expected_rpcs e LEFT JOIN named_rpcs a ON a.oid=e.oid
),
rpc_definition AS (
 SELECT count(*) FILTER(WHERE oid=to_regprocedure('public.zeya_begin_voice_webhook_receipt(text,text,text,text,uuid)')
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%attempt_count=attempt_count+1%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%event_typeISDISTINCTFROMp_event_type%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%jsonb_build_object(''status'',''acquired'',''attempt'',r.attempt_count)%') AS begin_fenced,
 count(*) FILTER(WHERE oid=to_regprocedure('public.zeya_finish_voice_webhook_receipt(text,integer,boolean)')
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%p_succeededISNULL%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%attempt_countISDISTINCTFROMp_expected_attempt%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%processing_state=''processing''ANDattempt_count=p_expected_attempt%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%RETURN''stale_attempt''%') AS finish_fenced,
 count(*) FILTER(WHERE oid=to_regprocedure('public.zeya_repair_public_experience_dispatch(uuid,text,text)')
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%dispatch_resolution_pending%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%ISDISTINCTFROMp_provider_conversation_id%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%cardinality(matching_ids)ISDISTINCTFROM1%') AS repair_exact,
 count(*) FILTER(WHERE oid=to_regprocedure('public.zeya_complete_public_experience_call(uuid,uuid)')
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%o.business_id=s.business_id%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%o.business_representation_id=s.business_representation_id%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%o.canonical_version_id=s.canonical_version_id%'
  AND pg_catalog.regexp_replace(prosrc,'\s','','g') LIKE '%l.created_at<=s.expires_at%') AS completion_exact
 FROM named_rpcs
)
SELECT 'receipt_columns_exact' AS check_name,(SELECT count(*) FROM receipt_relation)=1 AND NOT EXISTS(SELECT 1 FROM missing_columns) AND NOT EXISTS(SELECT 1 FROM unexpected_columns) AS passed,jsonb_build_object('expected_count',(SELECT count(*) FROM expected_columns),'actual_count',(SELECT count(*) FROM actual_columns),'missing_count',(SELECT count(*) FROM missing_columns),'unexpected_count',(SELECT count(*) FROM unexpected_columns)) AS details
UNION ALL SELECT 'receipt_defaults_exact',id_default=1 AND attempt_default=1 AND timestamp_defaults=2,jsonb_build_object('id_default',id_default,'attempt_default',attempt_default,'timestamp_defaults',timestamp_defaults) FROM default_contract
UNION ALL SELECT 'receipt_keys_exact',primary_key_count=1 AND event_unique_count=1 AND foreign_key_count=1,jsonb_build_object('primary_key_count',primary_key_count,'event_unique_count',event_unique_count,'foreign_key_count',foreign_key_count) FROM key_contract
UNION ALL SELECT 'receipt_checks_exact',check_count=7 AND provider_check=1 AND event_key_check=1 AND event_type_check=1 AND conversation_check=1 AND hash_check=1 AND processing_check=1 AND attempt_check=1,jsonb_build_object('check_count',check_count,'provider_check',provider_check,'event_key_check',event_key_check,'event_type_check',event_type_check,'conversation_check',conversation_check,'hash_check',hash_check,'processing_check',processing_check,'attempt_check',attempt_check) FROM check_contract
UNION ALL SELECT 'receipt_index_exact',index_count=1 AND exact_count=1,jsonb_build_object('index_count',index_count,'exact_count',exact_count) FROM index_contract
UNION ALL SELECT 'receipt_security_exact',table_count=1 AND exact_count=1 AND policy_count=0,jsonb_build_object('table_count',table_count,'exact_count',exact_count,'policy_count',policy_count) FROM table_security
UNION ALL SELECT 'receipt_trigger_exact',trigger_count=1 AND exact_count=1,jsonb_build_object('trigger_count',trigger_count,'exact_count',exact_count) FROM receipt_trigger
UNION ALL SELECT 'receipt_trigger_function_exact',function_count=1 AND exact_count=1,jsonb_build_object('function_count',function_count,'exact_count',exact_count) FROM receipt_trigger_function
UNION ALL SELECT 'state_constraint_exact',constraint_count=1 AND state_column_count=1 AND expected_state_array=actual_state_array AND NOT EXISTS(SELECT 1 FROM missing_states) AND NOT EXISTS(SELECT 1 FROM unexpected_states),jsonb_build_object('constraint_count',constraint_count,'state_column_count',state_column_count,'expected_states',expected_state_array,'actual_states',actual_state_array,'missing_count',(SELECT count(*) FROM missing_states),'unexpected_count',(SELECT count(*) FROM unexpected_states)) FROM state_summary
UNION ALL SELECT 'completion_rpcs_exact_and_secure',exact_oid_count=5 AND secure_count=5 AND (SELECT count(*) FROM named_rpcs)=5,jsonb_build_object('expected_count',5,'exact_oid_count',exact_oid_count,'named_overload_count',(SELECT count(*) FROM named_rpcs),'secure_count',secure_count) FROM rpc_security
UNION ALL SELECT 'attempt_fencing_and_identity_exact',begin_fenced=1 AND finish_fenced=1 AND repair_exact=1 AND completion_exact=1,jsonb_build_object('begin_fenced',begin_fenced,'finish_fenced',finish_fenced,'repair_exact',repair_exact,'completion_exact',completion_exact) FROM rpc_definition;
