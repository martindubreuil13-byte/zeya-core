-- Formation P1 Preview fixture preflight (STRICTLY READ-ONLY).
-- Confirm project hdjojgvvlojbhgidirht before use.
WITH target AS (
  SELECT 'da53cf7f-beb1-4168-a0cb-015610f092fc'::uuid owner_id,
    'mdubreu@gmail.com'::text owner_email,
    'zeya:preview:formation_p1:20260806'::text fixture_key
), owned_businesses AS (
  SELECT business.id FROM public.businesses AS business CROSS JOIN target
  WHERE business.user_id=target.owner_id
), owned_representations AS (
  SELECT representation.id,representation.current_version_id
  FROM public.business_representations AS representation CROSS JOIN target
  WHERE representation.user_id=target.owner_id
), required_tables AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.'||required.name) IS NULL)::bigint missing_tables
  FROM (VALUES ('businesses'),('business_representations'),('representation_formation_sessions'),
    ('representation_versions'),('representation_proposals'),('evidence'),('observations'),
    ('approval_decisions'),('direct_hire_onboarding_sessions'),('public_experience_sessions'),
    ('dispatches')) required(name)
), required_enums AS (
  SELECT 5-count(*)::bigint missing_enum_values
  FROM pg_catalog.pg_enum AS enum_value
  JOIN pg_catalog.pg_type AS enum_type ON enum_type.oid=enum_value.enumtypid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=enum_type.typnamespace
  WHERE namespace.nspname='public' AND (
    (enum_type.typname='representation_phase' AND enum_value.enumlabel='surface') OR
    (enum_type.typname='formation_initiation_source' AND enum_value.enumlabel='owner_request') OR
    (enum_type.typname='formation_session_status' AND enum_value.enumlabel IN ('initiated','getting_familiar','working_conversation_pending'))
  )
), rpc_contracts AS (
  SELECT count(*) FILTER (WHERE NOT contract_ok)::bigint missing_rpc_contracts
  FROM (VALUES
    ('public.zeya_initiate_formation_session(uuid,uuid,uuid,public.formation_initiation_source,uuid)'::text),
    ('public.zeya_advance_formation_status(uuid,uuid,public.formation_session_status,public.formation_session_status,jsonb)'::text)
  ) expected(signature)
  CROSS JOIN LATERAL (
    SELECT expected.signature::regprocedure AS oid
  ) resolved
  CROSS JOIN LATERAL (
    SELECT procedure.prosecdef
      AND coalesce(procedure.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
      AND has_function_privilege('service_role',resolved.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',resolved.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',resolved.oid,'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ) AS contract_ok
    FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid=resolved.oid
  ) checked
), counts AS (
  SELECT
    (SELECT count(*) FROM auth.users AS auth_user CROSS JOIN target WHERE auth_user.id=target.owner_id AND auth_user.email=target.owner_email)::bigint auth_identity_count,
    (SELECT count(*) FROM owned_businesses)::bigint business_count,
    (SELECT count(*) FROM owned_representations)::bigint representation_count,
    (SELECT count(*) FROM public.representation_formation_sessions AS formation CROSS JOIN target WHERE formation.owner_id=target.owner_id)::bigint formation_count,
    (SELECT count(*) FROM public.representation_versions AS version WHERE version.business_representation_id IN (SELECT representation.id FROM owned_representations AS representation))::bigint version_count,
    (SELECT count(*) FROM owned_representations AS representation WHERE representation.current_version_id IS NOT NULL)::bigint canonical_pointer_count,
    (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target WHERE direct_hire.owner_id=target.owner_id)::bigint direct_hire_count,
    (SELECT count(*) FROM public.public_experience_sessions AS experience CROSS JOIN target WHERE experience.tenant_user_id=target.owner_id)::bigint public_experience_count,
    ((SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire CROSS JOIN target WHERE direct_hire.owner_id=target.owner_id AND (direct_hire.preparation_status='running' OR direct_hire.preparation_lease_expires_at>now()))
      +(SELECT count(*) FROM public.public_experience_sessions AS experience CROSS JOIN target WHERE experience.tenant_user_id=target.owner_id AND experience.state IN ('call_requested','call_correlation_pending','dispatch_resolution_pending','call_dispatched','call_active'))
      +(SELECT count(*) FROM public.dispatches AS dispatch CROSS JOIN target WHERE dispatch.user_id=target.owner_id AND dispatch.status IN ('queued','calling')))::bigint active_work_count,
    (SELECT count(*) FROM public.businesses AS business CROSS JOIN target WHERE business.business_profile->>'fixture_key'=target.fixture_key)::bigint fixture_marker_count
)
SELECT required_tables.missing_tables,required_enums.missing_enum_values,
  rpc_contracts.missing_rpc_contracts,counts.*,
  required_tables.missing_tables=0 AND required_enums.missing_enum_values=0
    AND rpc_contracts.missing_rpc_contracts=0 AND counts.auth_identity_count=1
    AND counts.business_count=0 AND counts.representation_count=0
    AND counts.formation_count=0 AND counts.version_count=0
    AND counts.canonical_pointer_count=0 AND counts.direct_hire_count=0
    AND counts.public_experience_count=0 AND counts.active_work_count=0
    AND counts.fixture_marker_count=0 AS fixture_ready
FROM required_tables CROSS JOIN required_enums CROSS JOIN rpc_contracts CROSS JOIN counts;
