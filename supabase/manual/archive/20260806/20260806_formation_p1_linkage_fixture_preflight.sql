-- Formation P1 governed-linkage fixture preflight (STRICTLY READ-ONLY).
-- Confirm Preview project hdjojgvvlojbhgidirht before use.
WITH target AS (
  SELECT
    'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id,
    'mdubreu@gmail.com'::text AS owner_email,
    'bab67c0d-8027-4315-8086-60a49679939d'::uuid AS business_id,
    '6caa5310-61d7-46cf-99b7-b5d915f0293f'::uuid AS representation_id,
    'ba339a69-35cc-4e98-b03b-2a2d4f8717b2'::uuid AS formation_id,
    'f1060800-0000-4000-8000-000000000001'::uuid AS voice_context_id,
    'zeya-preview-fixture:formation-p1-linkage:20260806'::text AS conversation_id,
    'zeya:preview:formation_p1:linkage:20260806'::text AS linkage_fixture_key
), required_tables AS (
  SELECT count(*) FILTER (WHERE to_regclass(required_table.name) IS NULL)=0
    AS required_tables_present
  FROM (VALUES
    ('auth.users'),
    ('public.businesses'),
    ('public.business_representations'),
    ('public.representation_formation_sessions'),
    ('public.representation_versions'),
    ('public.representation_proposals'),
    ('public.evidence'),
    ('public.approval_decisions'),
    ('public.public_experience_sessions'),
    ('public.direct_hire_onboarding_sessions'),
    ('public.dispatches'),
    ('public.voice_representation_lineage'),
    ('public.voice_conversation_outputs')
  ) AS required_table(name)
), target_functions AS MATERIALIZED (
  SELECT procedure.oid,procedure.proname,procedure.proowner,procedure.prosecdef,
    procedure.proconfig,procedure.proacl,procedure.prosrc
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.prokind='f'
    AND procedure.proname IN (
      'zeya_create_pre_canonical_voice_representation_lineage',
      'zeya_capture_voice_conversation_output',
      'zeya_link_formation_conversation'
    )
), described_functions AS MATERIALIZED (
  SELECT function_row.*,
    pg_catalog.pg_get_function_identity_arguments(function_row.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(function_row.oid) AS result_type
  FROM target_functions AS function_row
), function_contracts AS (
  SELECT function_row.proname,
    function_row.prosecdef
      AND coalesce(function_row.proconfig,ARRAY[]::text[])
        @> ARRAY['search_path=""']::text[]
      AND has_function_privilege('service_role',function_row.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',function_row.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',function_row.oid,'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) AS public_acl
        WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
      ) AS governed,
    function_row.identity_arguments,function_row.result_type,function_row.prosrc
  FROM described_functions AS function_row
), contract_summary AS (
  SELECT
    count(*) FILTER (
      WHERE contract.proname='zeya_create_pre_canonical_voice_representation_lineage'
        AND contract.identity_arguments='p_voice_context_id uuid, p_worker_brief_id text, p_mission_id text, p_conversation_id text, p_tenant_user_id uuid, p_business_id uuid, p_business_representation_id uuid, p_canonical_version_id uuid, p_context_generated_at timestamp with time zone, p_authorized_element_keys text[], p_provisional_mode boolean, p_agent_id text, p_agent_type text, p_agent_role text, p_context_schema_version text, p_prompt_assembly_version text'
        AND contract.result_type='void' AND contract.governed
        AND contract.prosrc ILIKE '%representation_context_mode%'
        AND contract.prosrc ILIKE '%pre_canonical%'
    )=1 AS pre_canonical_rpc_valid,
    count(*) FILTER (
      WHERE contract.proname='zeya_capture_voice_conversation_output'
        AND contract.identity_arguments='p_voice_context_id uuid, p_conversation_id text, p_provider_call_id text, p_provider text, p_channel text, p_capture_source text, p_transcript_trust_level text, p_provider_attested boolean, p_submitted_by uuid, p_started_at timestamp with time zone, p_completed_at timestamp with time zone, p_transcript jsonb, p_transcript_status text, p_transcript_schema_version text, p_conversation_status text, p_completion_reason text, p_extraction_schema_version text, p_safe_metadata jsonb'
        AND contract.result_type='uuid' AND contract.governed
        AND contract.prosrc ILIKE '%v_lineage.representation_context_mode%'
        AND contract.prosrc ILIKE '%authenticated_client_relay%'
    )=1 AS capture_rpc_valid,
    count(*) FILTER (
      WHERE contract.proname='zeya_link_formation_conversation'
        AND contract.identity_arguments='p_session_id uuid, p_business_representation_id uuid, p_conversation_id uuid, p_conversation_type text'
        AND contract.result_type ~* '^TABLE\(session_id uuid, business_representation_id uuid, status (public\.)?formation_session_status, linked_at timestamp with time zone\)$'
        AND contract.governed
        AND contract.prosrc ILIKE '%voice_conversation_output%'
        AND contract.prosrc ILIKE '%working_conversation_linked%'
    )=1 AS linkage_rpc_valid
  FROM function_contracts AS contract
), state AS (
  SELECT
    (SELECT count(*)=1 FROM auth.users AS auth_user CROSS JOIN target
      WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)
      AND (SELECT count(*)=1 FROM public.businesses AS business CROSS JOIN target
        WHERE business.id=target.business_id AND business.user_id=target.owner_id
          AND business.business_profile->>'fixture_key'='zeya:preview:formation_p1:20260806')
      AND (SELECT count(*)=1 FROM public.business_representations AS representation CROSS JOIN target
        WHERE representation.id=target.representation_id
          AND representation.business_id=target.business_id
          AND representation.user_id=target.owner_id)
      AND (SELECT count(*)=1 FROM public.representation_formation_sessions AS formation CROSS JOIN target
        WHERE formation.id=target.formation_id
          AND formation.business_id=target.business_id
          AND formation.business_representation_id=target.representation_id
          AND formation.owner_id=target.owner_id) AS exact_identity_valid,
    (SELECT count(*)=1 FROM public.representation_formation_sessions AS formation CROSS JOIN target
      WHERE formation.id=target.formation_id
        AND formation.status='working_conversation_pending'
        AND formation.first_working_conversation_id IS NULL) AS formation_pending,
    (SELECT count(*)=0 FROM public.voice_conversation_outputs AS output CROSS JOIN target
      WHERE output.business_representation_id=target.representation_id)
      AND (SELECT count(*)=0 FROM public.voice_representation_lineage AS lineage CROSS JOIN target
        WHERE lineage.business_representation_id=target.representation_id) AS no_existing_linked_output,
    (SELECT count(*)=0 FROM public.representation_versions AS version CROSS JOIN target
      WHERE version.business_representation_id=target.representation_id) AS zero_versions,
    (SELECT count(*)=1 FROM public.business_representations AS representation CROSS JOIN target
      WHERE representation.id=target.representation_id AND representation.current_version_id IS NULL)
      AS canonical_pointer_null,
    NOT EXISTS (
      SELECT 1 FROM public.voice_representation_lineage AS lineage CROSS JOIN target
      WHERE lineage.voice_context_id=target.voice_context_id
        OR lineage.conversation_id=target.conversation_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.voice_conversation_outputs AS output CROSS JOIN target
      WHERE output.conversation_id=target.conversation_id
        OR output.safe_metadata->>'fixture_key'=target.linkage_fixture_key
    ) AS no_conflicting_fixture_marker,
    NOT EXISTS (SELECT 1 FROM public.representation_proposals AS proposal CROSS JOIN target
      WHERE proposal.business_representation_id=target.representation_id)
      AND NOT EXISTS (SELECT 1 FROM public.evidence AS evidence CROSS JOIN target
        WHERE evidence.business_representation_id=target.representation_id)
      AND NOT EXISTS (SELECT 1 FROM public.approval_decisions AS approval CROSS JOIN target
        WHERE approval.business_representation_id=target.representation_id)
      AND NOT EXISTS (SELECT 1 FROM public.public_experience_sessions AS experience CROSS JOIN target
        WHERE experience.business_representation_id=target.representation_id)
      AND NOT EXISTS (SELECT 1 FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target
        WHERE direct_hire.business_representation_id=target.representation_id)
      AND NOT EXISTS (SELECT 1 FROM public.dispatches AS dispatch CROSS JOIN target
        WHERE dispatch.user_id=target.owner_id) AS lifecycle_boundaries_clear
)
SELECT state.exact_identity_valid,state.formation_pending,
  state.no_existing_linked_output,state.zero_versions,state.canonical_pointer_null,
  contract_summary.pre_canonical_rpc_valid,contract_summary.capture_rpc_valid,
  contract_summary.linkage_rpc_valid,required_tables.required_tables_present,
  state.no_conflicting_fixture_marker,
  state.exact_identity_valid AND state.formation_pending
    AND state.no_existing_linked_output AND state.zero_versions
    AND state.canonical_pointer_null AND contract_summary.pre_canonical_rpc_valid
    AND contract_summary.capture_rpc_valid AND contract_summary.linkage_rpc_valid
    AND required_tables.required_tables_present
    AND state.no_conflicting_fixture_marker AND state.lifecycle_boundaries_clear
    AS linkage_fixture_ready
FROM state CROSS JOIN contract_summary CROSS JOIN required_tables;
