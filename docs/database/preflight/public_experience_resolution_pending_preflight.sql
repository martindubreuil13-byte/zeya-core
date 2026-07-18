-- Phase 4B.3 resolution-pending correction preflight.
-- Read only. Every returned row must have passed = true before deployment.
WITH
session_relation AS (
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relacl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'public_experience_sessions'
    AND c.relkind = 'r'
),
expected_columns(name, type_schema, type_name, not_null, identity_state, generated_state) AS (VALUES
  ('id','pg_catalog','uuid',true,'',''),
  ('token_hash','pg_catalog','text',true,'',''),
  ('tenant_user_id','pg_catalog','uuid',true,'',''),
  ('business_id','pg_catalog','uuid',true,'',''),
  ('business_representation_id','pg_catalog','uuid',true,'',''),
  ('canonical_version_id','pg_catalog','uuid',true,'',''),
  ('zeya_voice_context_id','pg_catalog','uuid',true,'',''),
  ('zeya_conversation_output_id','pg_catalog','uuid',false,'',''),
  ('veya_voice_context_id','pg_catalog','uuid',false,'',''),
  ('veya_conversation_output_id','pg_catalog','uuid',false,'',''),
  ('dispatch_id','pg_catalog','text',false,'',''),
  ('phone_hash','pg_catalog','text',false,'',''),
  ('provider_conversation_id','pg_catalog','text',false,'',''),
  ('provider_call_id','pg_catalog','text',false,'',''),
  ('state','pg_catalog','text',true,'',''),
  ('expires_at','pg_catalog','timestamptz',true,'',''),
  ('created_at','pg_catalog','timestamptz',true,'',''),
  ('zeya_finalized_at','pg_catalog','timestamptz',false,'',''),
  ('call_requested_at','pg_catalog','timestamptz',false,'',''),
  ('call_dispatched_at','pg_catalog','timestamptz',false,'',''),
  ('call_completed_at','pg_catalog','timestamptz',false,'',''),
  ('failed_at','pg_catalog','timestamptz',false,'',''),
  ('updated_at','pg_catalog','timestamptz',true,'','')
),
actual_columns AS (
  SELECT a.attname::text, tn.nspname::text, t.typname::text, a.attnotnull,
         a.attidentity::text, a.attgenerated::text
  FROM session_relation AS r
  JOIN pg_catalog.pg_attribute AS a ON a.attrelid = r.oid
  JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
  WHERE a.attnum > 0 AND NOT a.attisdropped
),
missing_columns AS (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns),
unexpected_columns AS (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns),
column_defaults AS (
  SELECT count(*) AS default_count,
         count(*) FILTER (WHERE a.attname = 'id'
           AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '\s', '', 'g') = 'gen_random_uuid()') AS id_default_count,
         count(*) FILTER (WHERE a.attname IN ('created_at','updated_at')
           AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '\s', '', 'g') = 'now()') AS timestamp_default_count
  FROM session_relation AS r
  JOIN pg_catalog.pg_attribute AS a ON a.attrelid = r.oid
  JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
),
expected_states(state) AS (VALUES
  ('call_active'),('call_completed_without_transcript'),('call_correlation_pending'),
  ('call_dispatched'),('call_failed'),('call_rejected'),('call_requested'),
  ('call_unanswered'),('completion_processing_failed'),('dispatch_resolution_pending'),
  ('expired'),('failed'),('reflection_ready'),('zeya_active'),('zeya_finalized')
),
state_constraint AS (
  SELECT c.conkey, pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
  FROM session_relation AS r
  JOIN pg_catalog.pg_constraint AS c ON c.conrelid = r.oid
  WHERE c.conname = 'public_experience_sessions_state_check' AND c.contype = 'c'
),
actual_states AS (
  SELECT DISTINCT match.value[1]::text AS state
  FROM state_constraint
  CROSS JOIN LATERAL pg_catalog.regexp_matches(definition, '''([^'']+)''::text', 'g') AS match(value)
),
missing_states AS (SELECT * FROM expected_states EXCEPT SELECT * FROM actual_states),
unexpected_states AS (SELECT * FROM actual_states EXCEPT SELECT * FROM expected_states),
state_summary AS (
  SELECT count(*) AS constraint_count,
         count(*) FILTER (WHERE conkey = ARRAY[(
           SELECT a.attnum FROM session_relation AS r
           JOIN pg_catalog.pg_attribute AS a ON a.attrelid = r.oid
           WHERE a.attname = 'state' AND NOT a.attisdropped
         )]::smallint[]) AS exact_column_count
  FROM state_constraint
),
expected_rpcs(name, oid, return_schema, return_name) AS (VALUES
  ('zeya_begin_voice_webhook_receipt', to_regprocedure('public.zeya_begin_voice_webhook_receipt(text,text,text,text,uuid)'), 'pg_catalog', 'jsonb'),
  ('zeya_finish_voice_webhook_receipt', to_regprocedure('public.zeya_finish_voice_webhook_receipt(text,integer,boolean)'), 'pg_catalog', 'text'),
  ('zeya_repair_public_experience_dispatch', to_regprocedure('public.zeya_repair_public_experience_dispatch(uuid,text,text)'), 'pg_catalog', 'text'),
  ('zeya_record_public_experience_call_failure', to_regprocedure('public.zeya_record_public_experience_call_failure(uuid,text,text,text)'), 'pg_catalog', 'text'),
  ('zeya_complete_public_experience_call', to_regprocedure('public.zeya_complete_public_experience_call(uuid,uuid)'), 'pg_catalog', 'text')
),
named_rpcs AS (
  SELECT p.oid, p.proname::text, p.proowner, p.prosecdef, p.proconfig, p.proacl,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         rn.nspname::text AS return_schema, rt.typname::text AS return_name
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_type AS rt ON rt.oid = p.prorettype
  JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rt.typnamespace
  WHERE n.nspname = 'public' AND p.proname IN (SELECT name FROM expected_rpcs)
),
rpc_contract AS (
  SELECT count(e.oid) AS exact_oid_count,
         count(*) FILTER (WHERE a.oid = e.oid
           AND a.owner = 'postgres' AND a.prosecdef
           AND a.proconfig = ARRAY['search_path=""']::text[]
           AND a.return_schema = e.return_schema AND a.return_name = e.return_name
           AND pg_catalog.has_function_privilege('service_role', a.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('anon', a.oid, 'EXECUTE')
           AND NOT pg_catalog.has_function_privilege('authenticated', a.oid, 'EXECUTE')
           AND (SELECT count(*) FROM pg_catalog.aclexplode(a.proacl) AS x WHERE x.privilege_type = 'EXECUTE') = 2
           AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.aclexplode(a.proacl) AS x
             WHERE x.privilege_type = 'EXECUTE'
               AND x.grantee NOT IN (a.proowner, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
           )) AS secure_count
  FROM expected_rpcs AS e LEFT JOIN named_rpcs AS a ON a.oid = e.oid
),
table_security AS (
  SELECT count(*) AS table_count,
         count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(relowner) = 'postgres'
           AND relrowsecurity
           AND pg_catalog.has_table_privilege('service_role', oid, 'SELECT')
           AND NOT pg_catalog.has_table_privilege('service_role', oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE')
           AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE')) AS exact_count,
         (SELECT count(*) FROM pg_catalog.pg_policy AS p WHERE p.polrelid = (SELECT oid FROM session_relation)) AS policy_count
  FROM session_relation
),
session_trigger AS (
  SELECT count(*) AS trigger_count,
         count(*) FILTER (WHERE NOT t.tgisinternal AND t.tgenabled::text = 'O'
           AND t.tgtype::int = 31
           AND t.tgfoid = to_regprocedure('public.zeya_enforce_public_experience_session_writes()')) AS exact_count
  FROM session_relation AS r
  LEFT JOIN pg_catalog.pg_trigger AS t
    ON t.tgrelid = r.oid AND t.tgname = 'zeya_public_experience_session_writes'
),
trigger_function AS (
  SELECT count(*) AS function_count,
         count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
           AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::text[]
           AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) AS x WHERE x.privilege_type = 'EXECUTE') = 1
           AND pg_catalog.regexp_replace(p.prosrc, '\s', '', 'g') LIKE '%zeya.public_experience_session_write%'
           AND pg_catalog.regexp_replace(p.prosrc, '\s', '', 'g') LIKE '%zeya.controlled_purge%') AS exact_count
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = to_regprocedure('public.zeya_enforce_public_experience_session_writes()')
),
collision AS (
  SELECT count(*) AS named_overload_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_mark_public_experience_dispatch_resolution_pending'
),
purge_named AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prosrc
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'zeya_purge_business_representation'
),
purge AS (
  SELECT
    (SELECT count(*) FROM purge_named) AS named_overload_count,
    count(*) AS exact_oid_count,
    count(*) FILTER (WHERE pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, auth, pg_temp']::text[]
      AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl) AS x WHERE x.privilege_type = 'EXECUTE') = 2
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) AS x
        WHERE x.privilege_type = 'EXECUTE'
          AND x.grantee NOT IN (
            p.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) AS x
        WHERE x.privilege_type = 'EXECUTE' AND x.grantee = 0
      )
      AND pg_catalog.regexp_replace(p.prosrc, '\s', '', 'g') LIKE '%set_config(''zeya.controlled_purge'',''on'',true)%'
      AND pg_catalog.regexp_replace(p.prosrc, '\s', '', 'g') LIKE '%set_config(''zeya.controlled_purge'',''off'',true)%'
    ) AS semantic_exact_count,
    pg_catalog.min(pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))) AS definition_md5
  FROM purge_named AS p
  WHERE p.oid = to_regprocedure('public.zeya_purge_business_representation(uuid,uuid)')
),
row_inventory AS (
  SELECT
    count(*) FILTER (WHERE state = 'call_requested') AS call_requested_count,
    count(*) FILTER (WHERE state = 'call_correlation_pending') AS call_correlation_pending_count,
    count(*) FILTER (WHERE state = 'dispatch_resolution_pending') AS dispatch_resolution_pending_count,
    count(*) FILTER (WHERE state = 'call_dispatched') AS call_dispatched_count,
    count(*) FILTER (WHERE state = 'call_active') AS call_active_count,
    count(*) FILTER (WHERE state IN ('call_failed','call_unanswered','call_rejected','call_completed_without_transcript','completion_processing_failed','failed','expired')) AS terminal_count,
    count(*) FILTER (WHERE state = 'reflection_ready') AS reflection_ready_count,
    count(*) FILTER (WHERE num_nonnulls(veya_voice_context_id, provider_conversation_id, provider_call_id) BETWEEN 1 AND 2) AS partial_provider_identity_count,
    count(*) FILTER (WHERE state IN ('call_requested','dispatch_resolution_pending')
      AND num_nonnulls(veya_voice_context_id, provider_conversation_id, provider_call_id) > 0) AS unresolved_state_with_provider_identity_count,
    count(*) FILTER (WHERE state IN ('call_correlation_pending','call_dispatched','call_active','reflection_ready')
      AND num_nonnulls(veya_voice_context_id, provider_conversation_id, provider_call_id) <> 3) AS required_identity_missing_count
  FROM public.public_experience_sessions
)
SELECT 'session_schema_exact' AS check_name,
       (SELECT count(*) FROM session_relation) = 1
       AND NOT EXISTS (SELECT 1 FROM missing_columns)
       AND NOT EXISTS (SELECT 1 FROM unexpected_columns)
       AND (SELECT default_count = 3 AND id_default_count = 1 AND timestamp_default_count = 2 FROM column_defaults) AS passed,
       jsonb_build_object('expected_count',23,'actual_count',(SELECT count(*) FROM actual_columns),'missing_count',(SELECT count(*) FROM missing_columns),'unexpected_count',(SELECT count(*) FROM unexpected_columns),'default_count',(SELECT default_count FROM column_defaults)) AS details
UNION ALL
SELECT 'fifteen_state_constraint_exact', constraint_count = 1 AND exact_column_count = 1
       AND NOT EXISTS (SELECT 1 FROM missing_states) AND NOT EXISTS (SELECT 1 FROM unexpected_states),
       jsonb_build_object('expected_count',15,'actual_count',(SELECT count(*) FROM actual_states),'missing_count',(SELECT count(*) FROM missing_states),'unexpected_count',(SELECT count(*) FROM unexpected_states))
FROM state_summary
UNION ALL
SELECT 'phase_4b3_completion_rpcs_exact', exact_oid_count = 5 AND secure_count = 5 AND (SELECT count(*) FROM named_rpcs) = 5,
       jsonb_build_object('expected_count',5,'exact_oid_count',exact_oid_count,'named_overload_count',(SELECT count(*) FROM named_rpcs),'secure_count',secure_count)
FROM rpc_contract
UNION ALL
SELECT 'session_table_security_exact', table_count = 1 AND exact_count = 1 AND policy_count = 0,
       jsonb_build_object('table_count',table_count,'exact_count',exact_count,'policy_count',policy_count)
FROM table_security
UNION ALL
SELECT 'session_mutation_trigger_exact', trigger_count = 1 AND exact_count = 1,
       jsonb_build_object('trigger_count',trigger_count,'exact_count',exact_count)
FROM session_trigger
UNION ALL
SELECT 'session_trigger_function_exact', function_count = 1 AND exact_count = 1,
       jsonb_build_object('function_count',function_count,'exact_count',exact_count)
FROM trigger_function
UNION ALL
SELECT 'controlled_purge_compatible', named_overload_count = 1 AND exact_oid_count = 1 AND semantic_exact_count = 1,
       jsonb_build_object(
         'named_overload_count',named_overload_count,
         'exact_oid_count',exact_oid_count,
         'semantic_exact_count',semantic_exact_count,
         'definition_md5',definition_md5,
         'expected_definition_md5','8fb71232dd96059d13bc8000586bebee')
FROM purge
UNION ALL
SELECT 'corrective_rpc_absent', named_overload_count = 0,
       jsonb_build_object('named_overload_count',named_overload_count)
FROM collision
UNION ALL
SELECT 'active_rows_compatible', partial_provider_identity_count = 0
       AND unresolved_state_with_provider_identity_count = 0
       AND required_identity_missing_count = 0,
       jsonb_build_object(
         'partial_provider_identity_count',partial_provider_identity_count,
         'unresolved_state_with_provider_identity_count',unresolved_state_with_provider_identity_count,
         'required_identity_missing_count',required_identity_missing_count)
FROM row_inventory
UNION ALL
SELECT 'session_state_inventory', true,
       jsonb_build_object(
         'call_requested_count',call_requested_count,
         'call_correlation_pending_count',call_correlation_pending_count,
         'dispatch_resolution_pending_count',dispatch_resolution_pending_count,
         'call_dispatched_count',call_dispatched_count,
         'call_active_count',call_active_count,
         'terminal_outcome_count',terminal_count,
         'reflection_ready_count',reflection_ready_count,
         'partial_provider_identity_count',partial_provider_identity_count)
FROM row_inventory;
