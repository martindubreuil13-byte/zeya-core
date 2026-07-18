-- Phase 4B.3 resolution-pending correction verification.
-- Read only. Every returned row must have passed = true.
WITH
named_functions AS (
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prosrc,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         rn.nspname::text AS return_schema, rt.typname::text AS return_name
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_type AS rt ON rt.oid = p.prorettype
  JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rt.typnamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'zeya_mark_public_experience_dispatch_resolution_pending'
),
exact_function AS (
  SELECT *, pg_catalog.regexp_replace(prosrc, '\s', '', 'g') AS normalized_source
  FROM named_functions
  WHERE oid = to_regprocedure('public.zeya_mark_public_experience_dispatch_resolution_pending(text,text,text,text)')
),
catalog_contract AS (
  SELECT
    (SELECT count(*) FROM named_functions) AS named_overload_count,
    count(*) AS exact_oid_count,
    count(*) FILTER (WHERE owner = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=""']::text[]
      AND return_schema = 'pg_catalog' AND return_name = 'text'
      AND pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proacl) AS x WHERE x.privilege_type = 'EXECUTE') = 2
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(proacl) AS x
        WHERE x.privilege_type = 'EXECUTE'
          AND x.grantee NOT IN (proowner, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
      )) AS secure_count
  FROM exact_function
),
body_contract AS (
  SELECT count(*) FILTER (WHERE
    normalized_source LIKE '%auth.role()<>''service_role''%'
    AND normalized_source LIKE '%p_token_hash!~''^[0-9a-f]{64}$''%'
    AND normalized_source LIKE '%length(p_dispatch_id)NOTBETWEEN1AND200%'
    AND normalized_source LIKE '%p_phone_hash!~''^[0-9a-f]{64}$''%'
    AND normalized_source LIKE '%p_expected_stateISDISTINCTFROM''call_requested''%'
    AND normalized_source LIKE '%WHEREtoken_hash=p_token_hashFORUPDATE%'
    AND normalized_source LIKE '%dispatch_idISDISTINCTFROMp_dispatch_id%'
    AND normalized_source LIKE '%phone_hashISDISTINCTFROMp_phone_hash%'
    AND normalized_source LIKE '%veya_voice_context_idISNOTNULL%'
    AND normalized_source LIKE '%provider_conversation_idISNOTNULL%'
    AND normalized_source LIKE '%provider_call_idISNOTNULL%'
    AND normalized_source LIKE '%state=''dispatch_resolution_pending''%RETURNsession_row.state%'
    AND normalized_source LIKE '%stateISDISTINCTFROMp_expected_state%'
    AND normalized_source LIKE '%set_config(''zeya.public_experience_session_write'',''on'',true)%'
    AND normalized_source LIKE '%SETstate=''dispatch_resolution_pending'',updated_at=now()%'
    AND normalized_source NOT LIKE '%EXECUTE%'
  ) AS exact_count
  FROM exact_function
),
table_security AS (
  SELECT count(*) AS table_count,
         count(*) FILTER (WHERE c.relrowsecurity
           AND pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')
           AND NOT pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
           AND NOT pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) AS exact_count
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'public_experience_sessions' AND c.relkind = 'r'
)
SELECT 'resolution_pending_rpc_catalog_exact' AS check_name,
       named_overload_count = 1 AND exact_oid_count = 1 AND secure_count = 1 AS passed,
       jsonb_build_object('named_overload_count',named_overload_count,'exact_oid_count',exact_oid_count,'secure_count',secure_count) AS details
FROM catalog_contract
UNION ALL
SELECT 'resolution_pending_rpc_body_exact', exact_count = 1,
       jsonb_build_object('exact_count',exact_count)
FROM body_contract
UNION ALL
SELECT 'session_table_privileges_unchanged', table_count = 1 AND exact_count = 1,
       jsonb_build_object('table_count',table_count,'exact_count',exact_count)
FROM table_security;
