-- Direct Hire Formation Handoff - Postcheck
-- Verify successful migration application after live Preview compilation and schema updates
-- Target owner: da53cf7f-beb1-4168-a0cb-015610f092fc (mdubreu@gmail.com, QA)
-- Strictly read-only inspection using catalogs. One row result.
-- Safe: no transcript/Evidence content, no phone, no secrets, no pending-object assumptions

WITH owner_context AS (
  SELECT
    'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid AS owner_id,
    'mdubreu@gmail.com'::text AS owner_email
),

-- Schema inspection
enum_check AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'direct_hire_onboarding'
        AND enumtypid = 'public.formation_initiation_source'::regtype
    ) AS direct_hire_enum_exists
),

column_check AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'direct_hire_onboarding_sessions'
        AND column_name = 'formation_session_id'
    ) AS formation_session_id_exists,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'direct_hire_onboarding_sessions'
        AND column_name = 'formation_initiated_at'
    ) AS formation_initiated_at_exists
),

index_check AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'direct_hire_onboarding_sessions'
        AND indexname = 'direct_hire_formation_session_idx'
    ) AS handoff_index_exists
),

rpc_lookup AS (
  SELECT
    to_regprocedure('public.zeya_initiate_direct_hire_formation(uuid,boolean)') AS rpc_regproc
),

rpc_function AS (
  SELECT p.*
  FROM rpc_lookup
  LEFT JOIN pg_proc p ON p.oid = rpc_lookup.rpc_regproc
),

rpc_check AS (
  SELECT
    p.oid IS NOT NULL AS rpc_exists,
    (p.provolatile IS NOT NULL AND p.prosecdef) AS rpc_is_security_definer,
    CASE
      WHEN p.oid IS NOT NULL THEN
        COALESCE(
          'search_path=""' = ANY(p.proconfig),
          false
        )
      ELSE false
    END AS rpc_has_empty_search_path
  FROM rpc_function p
),

rpc_acl_entries AS (
  SELECT
    acl.grantee,
    acl.privilege_type
  FROM rpc_function
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      rpc_function.proacl,
      pg_catalog.acldefault('f', rpc_function.proowner)
    )
  ) AS acl
  WHERE rpc_function.oid IS NOT NULL
),

rpc_acl_check AS (
  SELECT
    CASE
      WHEN (SELECT oid FROM rpc_function) IS NOT NULL THEN
        has_function_privilege('service_role'::text, (SELECT oid FROM rpc_function), 'EXECUTE')
      ELSE false
    END AS service_role_can_execute,
    NOT EXISTS (
      SELECT 1
      FROM rpc_acl_entries
      WHERE grantee = 0
        AND privilege_type = 'EXECUTE'
    ) AS public_cannot_execute,
    CASE
      WHEN (SELECT oid FROM rpc_function) IS NOT NULL THEN
        NOT has_function_privilege('anon'::text, (SELECT oid FROM rpc_function), 'EXECUTE')
      ELSE true
    END AS anon_cannot_execute,
    CASE
      WHEN (SELECT oid FROM rpc_function) IS NOT NULL THEN
        NOT has_function_privilege('authenticated'::text, (SELECT oid FROM rpc_function), 'EXECUTE')
      ELSE true
    END AS authenticated_cannot_execute
),

audit_check AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'zeya_audit_direct_hire_formation_initiation'
        AND pronamespace = 'public'::regnamespace
    ) AS audit_function_absent,
    NOT EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE trigger_name = 'trigger_audit_direct_hire_formation_initiation'
        AND event_object_schema = 'public'
        AND event_object_table = 'direct_hire_onboarding_sessions'
    ) AS audit_trigger_absent
),

-- Owner data verification
onboarding_session AS (
  SELECT
    id,
    business_representation_id,
    business_id,
    onboarding_state,
    preparation_status,
    formation_session_id
  FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = (SELECT owner_id FROM owner_context)
  LIMIT 1
),

business_repr AS (
  SELECT
    id,
    user_id,
    current_version_id
  FROM public.business_representations
  WHERE id = (SELECT business_representation_id FROM onboarding_session)
  LIMIT 1
),

owner_session_count AS (
  SELECT COUNT(*)::integer AS count
  FROM public.direct_hire_onboarding_sessions
  WHERE owner_id = (SELECT owner_id FROM owner_context)
),

owner_preparation_check AS (
  SELECT
    (SELECT preparation_status FROM onboarding_session)::text AS prep_status,
    (SELECT preparation_status FROM onboarding_session) = 'ready' AS prep_is_ready
),

formation_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.representation_formation_sessions
  WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
    AND owner_id = (SELECT owner_id FROM owner_context)
),

version_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.representation_versions
  WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
),

canonical_pointer_check AS (
  SELECT (SELECT current_version_id FROM business_repr) IS NULL AS canonical_pointer_null
),

proposal_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.representation_proposals
  WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
),

approval_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.approval_decisions
  WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
),

website_evidence_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.evidence
  WHERE business_representation_id = (SELECT business_representation_id FROM onboarding_session)
    AND source_type = 'public_website'
    AND direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
),

linked_observation_count_check AS (
  SELECT COUNT(*)::integer AS count
  FROM public.observations o
  INNER JOIN public.evidence e ON o.evidence_id = e.id
  WHERE e.business_representation_id = (SELECT business_representation_id FROM onboarding_session)
    AND e.source_type = 'public_website'
    AND e.direct_hire_onboarding_session_id = (SELECT id FROM onboarding_session)
)

SELECT
  -- Schema: Enum and columns
  (SELECT direct_hire_enum_exists FROM enum_check)::boolean AS direct_hire_enum_exists,
  (SELECT formation_session_id_exists FROM column_check)::boolean AS formation_session_id_exists,
  (SELECT formation_initiated_at_exists FROM column_check)::boolean AS formation_initiated_at_exists,

  -- Schema: Index
  (SELECT handoff_index_exists FROM index_check)::boolean AS handoff_index_exists,

  -- RPC: Existence and properties
  (SELECT rpc_exists FROM rpc_check)::boolean AS rpc_exists,
  (SELECT rpc_is_security_definer FROM rpc_check)::boolean AS rpc_is_security_definer,
  (SELECT rpc_has_empty_search_path FROM rpc_check)::boolean AS rpc_has_empty_search_path,

  -- RPC: ACL enforcement
  (SELECT service_role_can_execute FROM rpc_acl_check)::boolean AS service_role_can_execute,
  (SELECT public_cannot_execute FROM rpc_acl_check)::boolean AS public_cannot_execute,
  (SELECT anon_cannot_execute FROM rpc_acl_check)::boolean AS anon_cannot_execute,
  (SELECT authenticated_cannot_execute FROM rpc_acl_check)::boolean AS authenticated_cannot_execute,

  -- Audit artifacts (should be absent)
  (SELECT audit_function_absent FROM audit_check)::boolean AS audit_function_absent,
  (SELECT audit_trigger_absent FROM audit_check)::boolean AS audit_trigger_absent,

  -- Owner data: Session count and state
  (SELECT count FROM owner_session_count)::integer AS owner_session_count,
  (SELECT prep_is_ready FROM owner_preparation_check)::boolean AS preparation_status_is_ready,

  -- Formation/Version/Canonical state (pre-handoff verification)
  (SELECT count FROM formation_count_check)::integer AS formation_count,
  (SELECT count FROM version_count_check)::integer AS version_count,
  (SELECT canonical_pointer_null FROM canonical_pointer_check)::boolean AS canonical_pointer_null,
  (SELECT count FROM proposal_count_check)::integer AS proposal_count,
  (SELECT count FROM approval_count_check)::integer AS approval_decision_count,

  -- Evidence and Observations (should remain from preparation)
  (SELECT count FROM website_evidence_count_check)::integer AS website_evidence_count,
  (SELECT count FROM linked_observation_count_check)::integer AS linked_observation_count,

  -- Overall pass verdict
  (
    (SELECT direct_hire_enum_exists FROM enum_check)
    AND (SELECT formation_session_id_exists FROM column_check)
    AND (SELECT formation_initiated_at_exists FROM column_check)
    AND (SELECT handoff_index_exists FROM index_check)
    AND (SELECT rpc_exists FROM rpc_check)
    AND (SELECT rpc_is_security_definer FROM rpc_check)
    AND (SELECT rpc_has_empty_search_path FROM rpc_check)
    AND (SELECT service_role_can_execute FROM rpc_acl_check)
    AND (SELECT public_cannot_execute FROM rpc_acl_check)
    AND (SELECT anon_cannot_execute FROM rpc_acl_check)
    AND (SELECT authenticated_cannot_execute FROM rpc_acl_check)
    AND (SELECT audit_function_absent FROM audit_check)
    AND (SELECT audit_trigger_absent FROM audit_check)
    AND (SELECT count FROM owner_session_count) = 1
    AND (SELECT prep_is_ready FROM owner_preparation_check)
    AND (SELECT count FROM formation_count_check) = 0
    AND (SELECT count FROM version_count_check) = 0
    AND (SELECT canonical_pointer_null FROM canonical_pointer_check)
    AND (SELECT count FROM proposal_count_check) = 0
    AND (SELECT count FROM approval_count_check) = 0
    AND (SELECT count FROM website_evidence_count_check) = 4
    AND (SELECT count FROM linked_observation_count_check) = 1
  )::boolean AS handoff_postcheck_pass;
