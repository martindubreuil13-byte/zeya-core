-- Deployed capture RPC summary (STRICTLY READ-ONLY).
WITH target_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proowner,procedure.prosecdef,procedure.proconfig,
    procedure.proacl,procedure.prosrc
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.prokind='f'
    AND procedure.proname='zeya_capture_voice_conversation_output'
), described_functions AS MATERIALIZED (
  SELECT function_row.*,
    pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(function_row.oid) AS result_type
  FROM target_functions AS function_row
), expected_function AS MATERIALIZED (
  SELECT function_row.*
  FROM described_functions AS function_row
  WHERE function_row.identity_arguments =
    'p_voice_context_id uuid, p_conversation_id text, p_provider_call_id text, p_provider text, p_channel text, p_capture_source text, p_transcript_trust_level text, p_provider_attested boolean, p_submitted_by uuid, p_started_at timestamp with time zone, p_completed_at timestamp with time zone, p_transcript jsonb, p_transcript_status text, p_transcript_schema_version text, p_conversation_status text, p_completion_reason text, p_extraction_schema_version text, p_safe_metadata jsonb'
    AND function_row.result_type='uuid'
), expected_contract AS (
  SELECT
    count(*)=1 AS expected_contract_found,
    coalesce(bool_and(function_row.prosecdef),false) AS security_definer,
    coalesce(bool_and(
      coalesce(function_row.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
    ),false) AS safe_search_path,
    coalesce(bool_and(
      has_function_privilege('service_role',function_row.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',function_row.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',function_row.oid,'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl
        WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
      )
    ),false) AS service_role_only,
    coalesce(bool_and(
      function_row.prosrc ILIKE '%representation_context_mode%'
    ),false) AS representation_context_mode_referenced,
    coalesce(bool_and(
      function_row.prosrc ILIKE '%v_lineage.representation_context_mode%'
      AND function_row.prosrc ILIKE '%v_lineage.canonical_version_id%'
      AND function_row.prosrc ILIKE '%INSERT INTO public.voice_conversation_outputs%'
    ),false) AS pre_canonical_supported
  FROM expected_function AS function_row
)
SELECT (SELECT count(*)>0 FROM target_functions) AS capture_rpc_exists,
  (SELECT count(*) FROM target_functions)::bigint AS overload_count,
  expected_contract.expected_contract_found,
  expected_contract.security_definer,
  expected_contract.safe_search_path,
  expected_contract.service_role_only,
  expected_contract.representation_context_mode_referenced,
  expected_contract.pre_canonical_supported,
  expected_contract.expected_contract_found
    AND expected_contract.security_definer
    AND expected_contract.safe_search_path
    AND expected_contract.service_role_only
    AND expected_contract.representation_context_mode_referenced
    AND expected_contract.pre_canonical_supported AS extraction_ready
FROM expected_contract;
